import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { FRONTEND_ROOT, atomicWriteFile, pathExists, readJson } from './paths.mjs'
import { listActions } from './actions.mjs'

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character])
}

function jsonForScript(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
}

async function imageVariant(outputDir, filename) {
  const target = path.join(outputDir, filename)
  if (!await pathExists(target)) return null
  const base64 = (await readFile(target)).toString('base64')
  return { path: filename, data_uri: `data:image/png;base64,${base64}` }
}

function caveats(runMetadata) {
  const warnings = runMetadata.scientific_context?.warnings ?? []
  return [...new Set([
    runMetadata.scientific_context?.rooted
      ? 'The tree has an explicit root; interpretation still depends on the stated outgroup and model.'
      : 'NJ/unrooted output supports clustering claims, not ancestor-to-descendant direction.',
    ['dist', 'fasta'].includes(runMetadata.input?.route)
      ? 'Branch lengths inherit the input distance metric and are not automatically evolutionary time.'
      : null,
    'Group colors and clade labels are annotations, not independent statistical evidence.',
    'Display bootstrap/posterior support whenever available; unsupported splits remain hypotheses.',
    'Node ids are topology-specific and must be revalidated after every topology change.',
    ...warnings,
  ].filter(Boolean))]
}

function archivedRevisionDir(workspaceRoot, revision) {
  return path.join(workspaceRoot, '.ggtree-air', 'revisions', `r${String(revision).padStart(4, '0')}`)
}

async function readOptionalJson(target, fallback) {
  return await pathExists(target) ? readJson(target) : fallback
}

async function loadRevision({ directory, revision, current, record }) {
  if (!await pathExists(path.join(directory, 'scene.json'))) return null
  const [scene, runMetadata, feedbackStatus, annotations, appliedAnnotations, appliedPlan, revisionDiff, revisionScore] = await Promise.all([
    readJson(path.join(directory, 'scene.json')),
    readJson(path.join(directory, 'run_metadata.json')),
    readOptionalJson(path.join(directory, 'feedback_status.json'), { items: [] }),
    readOptionalJson(path.join(directory, 'annotations.json'), { annotations: [] }),
    readOptionalJson(path.join(directory, 'applied_annotations.json'), null),
    readOptionalJson(path.join(directory, 'applied_plan.json'), null),
    readOptionalJson(path.join(directory, 'revision_diff.json'), null),
    readOptionalJson(path.join(directory, 'revision_score.json'), null),
  ])
  const variants = {}
  for (const view of scene.views) {
    variants[view.layout] = {
      base: await imageVariant(directory, `tree_${view.layout}.png`),
      intents: await imageVariant(directory, `tree_${view.layout}_intents.png`),
      annotated: await imageVariant(directory, `tree_${view.layout}_annotated.png`),
    }
  }
  return {
    revision,
    current,
    branch: record?.branch || 'main',
    parents: record?.parents || [],
    scene,
    variants,
    run_metadata: runMetadata,
    feedback_status: feedbackStatus,
    annotations,
    applied_annotations: appliedAnnotations,
    applied_plan: appliedPlan,
    revision_diff: revisionDiff,
    revision_score: revisionScore,
  }
}

export async function buildReport({
  outputDir, workspaceRoot, workspace, annotations, pendingPlanOverride = undefined,
}) {
  const [template, styles, app] = await Promise.all([
    readFile(path.join(FRONTEND_ROOT, 'report.html'), 'utf8'),
    readFile(path.join(FRONTEND_ROOT, 'styles.css'), 'utf8'),
    readFile(path.join(FRONTEND_ROOT, 'app.js'), 'utf8'),
  ])
  const revisions = []
  const revisionIds = Object.keys(workspace.revisions || { [workspace.revision]: {} })
    .map(Number).filter(Number.isInteger).sort((a, b) => a - b)
  for (const revision of revisionIds) {
    const current = revision === workspace.revision
    const directory = current ? outputDir : archivedRevisionDir(workspaceRoot, revision)
    const value = await loadRevision({
      directory, revision, current, record: workspace.revisions?.[String(revision)],
    })
    if (value) revisions.push(value)
  }
  const currentRevision = revisions.find((revision) => revision.current)
  if (!currentRevision) throw new Error(`Current revision ${workspace.revision} artifacts are unavailable`)
  currentRevision.annotations = annotations
  const pendingPlan = pendingPlanOverride !== undefined
    ? pendingPlanOverride
    : await readOptionalJson(
      path.join(workspaceRoot, '.ggtree-air', 'pending_plan.json'), null,
    )

  const actions = await listActions(workspaceRoot)
  for (const action of actions) {
    for (const output of action.outputs || []) {
      if (!output.media_type?.startsWith('image/')) continue
      const target = path.join(workspaceRoot, output.path)
      if (!await pathExists(target)) continue
      output.data_uri = `data:${output.media_type.split(';')[0]};base64,${(await readFile(target)).toString('base64')}`
    }
  }

  const payload = {
    schema_version: '1.1.0',
    workspace: {
      id: workspace.id,
      title: workspace.spec.title,
      subtitle: workspace.spec.subtitle,
      revision: workspace.revision,
      activity_revision: Number(workspace.activity_revision || 0),
      current_branch: workspace.current_branch || 'main',
      branches: workspace.branches || {},
      input_source: (workspace.input_sources?.tree || workspace.input_sources?.dist || workspace.input_sources?.fasta)?.path || null,
      metadata_source: workspace.input_sources?.metadata?.path || workspace.input_sources?.groups?.path || null,
    },
    revisions,
    scene: currentRevision.scene,
    annotations,
    pending_plan: pendingPlan,
    actions,
    variants: currentRevision.variants,
    run_metadata: currentRevision.run_metadata,
    feedback_status: currentRevision.feedback_status,
    caveats: caveats(currentRevision.run_metadata),
  }
  const html = template
    .replaceAll('__TITLE__', htmlEscape(workspace.spec.title))
    .replace('__STYLE__', styles)
    .replace('__PAYLOAD__', jsonForScript(payload))
    .replace('__APP__', app)
  const reportPath = path.join(outputDir, 'report.html')
  await atomicWriteFile(reportPath, html)
  return { reportPath, payload }
}
