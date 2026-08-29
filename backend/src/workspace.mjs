import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  artifactRecord, atomicWriteJson, copyFiles, isoNow, listTopLevelArtifacts, md5File, moveFiles,
  pathExists, readJson,
} from './paths.mjs'
import { createAnnotationEnvelope, normalizeAnnotationEnvelope, normalizeRunPlan, normalizeRunSpec } from './contracts.mjs'
import { callRWorker } from './r-worker.mjs'
import { buildReport } from './report-builder.mjs'
import { planNaturalLanguage } from './natural-planner.mjs'

const INTERNAL_DIR = '.ggtree-air'
const WORKSPACE_FILE = 'workspace.json'

async function upgradeWorkspace(root, workspace) {
  if (workspace.branches && workspace.revisions && workspace.current_branch) return workspace
  const revisions = {}
  for (let revision = 1; revision <= workspace.revision; revision += 1) {
    const archived = path.join(root, INTERNAL_DIR, 'revisions', `r${String(revision).padStart(4, '0')}`, WORKSPACE_FILE)
    const snapshot = await pathExists(archived) ? await readJson(archived) : workspace
    revisions[String(revision)] = {
      revision,
      parents: revision === 1 ? [] : [revision - 1],
      branch: 'main',
      created: snapshot.updated || snapshot.created || isoNow(),
      spec: snapshot.spec || workspace.spec,
      effective_feedback: snapshot.revisions?.[String(revision)]?.effective_feedback || [],
    }
  }
  return {
    ...workspace,
    current_branch: 'main',
    next_revision: workspace.revision + 1,
    branches: {
      main: { name: 'main', head_revision: workspace.revision, created: workspace.created || isoNow(), from_revision: 1 },
    },
    revisions,
  }
}

function artifactRole(filename) {
  if (filename === 'report.html') return 'human-report'
  if (filename === 'scene.json') return 'semantic-scene'
  if (filename === 'annotations.json') return 'visual-feedback'
  if (filename === 'applied_annotations.json') return 'applied-feedback'
  if (filename === 'applied_plan.json') return 'applied-run-plan'
  if (filename === 'feedback_status.json') return 'feedback-status'
  if (filename === 'revision_diff.json') return 'revision-diff'
  if (filename === 'revision_score.json') return 'revision-score'
  if (filename === 'run_metadata.json') return 'run-metadata'
  if (filename === 'render_metadata.json') return 'render-metadata'
  if (/^tree_.*\.(png|pdf|svg)$/.test(filename)) return 'rendered-view'
  if (filename === 'tree.rds') return 'tree-object'
  if (filename === 'newick.tree.txt') return 'newick-tree'
  if (filename === 'distance_matrix.tsv') return 'distance-matrix'
  if (filename === 'run_log.txt') return 'run-log'
  return 'artifact'
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function acquireLock(root) {
  const lockPath = path.join(root, INTERNAL_DIR, 'workspace.lock')
  await mkdir(path.dirname(lockPath), { recursive: true })
  let handle
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx')
      await handle.writeFile(JSON.stringify({ pid: process.pid, created: isoNow() }))
      break
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const lock = await readJson(lockPath).catch(() => null)
      if (lock && processIsAlive(Number(lock.pid))) {
        throw new Error(`Workspace is busy with process ${lock.pid}`)
      }
      await rm(lockPath, { force: true })
    }
  }
  if (!handle) throw new Error('Could not acquire workspace lock')
  return async () => {
    await handle.close().catch(() => undefined)
    await rm(lockPath, { force: true })
  }
}

async function cleanupOrphanBuilds(root) {
  const internal = path.join(root, INTERNAL_DIR)
  const entries = await readdir(internal, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('build-'))
    .map((entry) => rm(path.join(internal, entry.name), { recursive: true, force: true })))
}

async function snapshotRunInputs(root, sourceSpec) {
  const inputsDir = path.join(root, INTERNAL_DIR, 'inputs')
  await mkdir(inputsDir, { recursive: true })
  const spec = structuredClone(sourceSpec)
  const sources = {}
  for (const key of ['tree', 'dist', 'fasta', 'groups', 'metadata']) {
    const source = sourceSpec[key]
    if (!source) continue
    const md5 = await md5File(source)
    const extension = path.extname(source)
    const destination = path.join(inputsDir, `${key}-${md5}${extension}`)
    if (!await pathExists(destination)) await copyFile(source, destination)
    spec[key] = destination
    sources[key] = { path: source, md5, snapshot: path.relative(root, destination) }
  }
  return { spec, sources }
}

async function buildManifest(outputDir, workspace) {
  const files = (await readdir(outputDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== 'report_manifest.json')
    .map((entry) => path.join(outputDir, entry.name))
  const artifacts = await Promise.all(files.sort().map((target) =>
    artifactRecord(target, outputDir, artifactRole(path.basename(target)))))
  const runMetadata = await readJson(path.join(outputDir, 'run_metadata.json'))
  const scene = await readJson(path.join(outputDir, 'scene.json'))
  const manifest = {
    schema_version: '2.0.0',
    created: isoNow(),
    generator: { name: 'ggtree-air-node', version: '0.5.0' },
    workspace: {
      id: workspace.id,
      revision: workspace.revision,
      branch: workspace.current_branch,
      parents: workspace.revisions?.[String(workspace.revision)]?.parents || [],
    },
    title: workspace.spec.title,
    report: 'report.html',
    scene: 'scene.json',
    annotations: 'annotations.json',
    input: runMetadata.input,
    input_sources: workspace.input_sources,
    scientific_context: runMetadata.scientific_context,
    parameters: runMetadata.parameters,
    scene_id: scene.scene_id,
    artifacts,
  }
  await atomicWriteJson(path.join(outputDir, 'report_manifest.json'), manifest)
  return manifest
}

async function evaluateRevision(root, buildDir, workspace, feedback) {
  const currentScene = await readJson(path.join(buildDir, 'scene.json'))
  const feedbackStatus = await readJson(path.join(buildDir, 'feedback_status.json'))
  const parentRevision = workspace.revisions?.[String(workspace.revision)]?.parents?.[0] ?? null
  const parentDir = parentRevision == null
    ? null
    : path.join(root, INTERNAL_DIR, 'revisions', `r${String(parentRevision).padStart(4, '0')}`)
  const parentScene = parentDir && await pathExists(path.join(parentDir, 'scene.json'))
    ? await readJson(path.join(parentDir, 'scene.json'))
    : null
  const views = currentScene.views.map((view) => {
    const previous = parentScene?.views.find((candidate) => candidate.layout === view.layout)
    return {
      layout: view.layout,
      previous_md5: previous?.artifact?.md5 ?? null,
      current_md5: view.artifact?.md5 ?? null,
      changed: previous ? previous.artifact?.md5 !== view.artifact?.md5 : true,
    }
  })
  const currentFeedbackIds = new Set((feedback?.annotations || []).map((annotation) => annotation.id))
  const statuses = (feedbackStatus.items ?? []).filter((item) => currentFeedbackIds.has(item.id))
  const count = (status) => statuses.filter((item) => item.status === status).length
  const total = feedback?.annotations?.length ?? 0
  const applied = count('applied')
  const deferred = count('deferred')
  const skipped = count('skipped')
  const topologyPreserved = parentScene ? parentScene.tree.hash === currentScene.tree.hash : true
  const changedViews = views.filter((view) => view.changed).length
  const score = total === 0 ? 100 : Math.round(100 * (
    0.55 * (applied / total)
    + 0.15 * ((applied + deferred) / total)
    + 0.15 * (topologyPreserved ? 1 : 0)
    + 0.15 * (changedViews > 0 ? 1 : 0)
  ))
  const diff = {
    schema_version: '1.0.0',
    revision: workspace.revision,
    parent_revision: parentRevision,
    topology_preserved: topologyPreserved,
    feedback: { total, applied, deferred, skipped },
    views,
  }
  const scorecard = {
    schema_version: '1.0.0',
    revision: workspace.revision,
    score,
    metrics: {
      feedback_total: total,
      feedback_applied: applied,
      feedback_deferred: deferred,
      feedback_skipped: skipped,
      topology_preserved: topologyPreserved,
      changed_views: changedViews,
    },
    interpretation: 'Operational workflow score only; it is not a biological quality score.',
  }
  await atomicWriteJson(path.join(buildDir, 'revision_diff.json'), diff)
  await atomicWriteJson(path.join(buildDir, 'revision_score.json'), scorecard)
  return { diff, scorecard }
}

async function buildRevision(root, workspace, feedback, onLog, signal, progress = () => undefined, runPlan = null, renderFeedback = feedback) {
  const internal = path.join(root, INTERNAL_DIR)
  const buildDir = path.join(internal, `build-${workspace.revision}-${randomUUID()}`)
  await mkdir(buildDir, { recursive: true })
  try {
    progress('renderer-starting', { revision: workspace.revision })
    const worker = await callRWorker('render.run', {
      spec: workspace.spec,
      output_dir: buildDir,
      feedback: renderFeedback,
    }, { cwd: root, onLog, signal })
    if (signal?.aborted) throw Object.assign(new Error('Rerun cancelled'), { code: 'JOB_CANCELLED' })
    progress('packaging', { revision: workspace.revision })
    const scene = await readJson(path.join(buildDir, 'scene.json'))
    const annotations = createAnnotationEnvelope(scene)
    await atomicWriteJson(path.join(buildDir, 'annotations.json'), annotations)
    if (feedback?.annotations?.length) {
      await atomicWriteJson(path.join(buildDir, 'applied_annotations.json'), feedback)
    }
    if (runPlan) await atomicWriteJson(path.join(buildDir, 'applied_plan.json'), runPlan)
    const evaluation = await evaluateRevision(root, buildDir, workspace, feedback)
    await buildReport({ outputDir: buildDir, workspaceRoot: root, workspace, annotations })
    await buildManifest(buildDir, workspace)
    progress('packaged', { revision: workspace.revision })
    return { buildDir, worker, scene, evaluation }
  } catch (error) {
    await rm(buildDir, { recursive: true, force: true })
    throw error
  }
}

async function snapshotCurrentRevision(root, workspace) {
  const archiveDir = path.join(root, INTERNAL_DIR, 'revisions', `r${String(workspace.revision).padStart(4, '0')}`)
  await rm(archiveDir, { recursive: true, force: true })
  await copyFiles(await listTopLevelArtifacts(root), archiveDir)
  await atomicWriteJson(path.join(archiveDir, 'workspace.json'), workspace)
  return archiveDir
}

async function commitRevision(root, workspace, build, previousRevision = null, previousWorkspace = null) {
  if (previousRevision != null) {
    const archiveDir = path.join(root, INTERNAL_DIR, 'revisions', `r${String(previousRevision).padStart(4, '0')}`)
    const currentFiles = await listTopLevelArtifacts(root)
    await moveFiles(currentFiles, archiveDir)
    if (previousWorkspace) await atomicWriteJson(path.join(archiveDir, 'workspace.json'), previousWorkspace)
  }
  const builtFiles = await listTopLevelArtifacts(build.buildDir)
  await moveFiles(builtFiles, root)
  await rm(build.buildDir, { recursive: true, force: true })
  await atomicWriteJson(path.join(root, WORKSPACE_FILE), workspace)
}

export async function createWorkspace({ root, spec, force = false, onLog }) {
  root = path.resolve(root)
  if (await pathExists(root)) {
    const entries = await readdir(root)
    if (entries.length > 0) {
      if (!force) throw new Error(`Output directory is not empty: ${root}. Use --force to replace it.`)
      await rm(root, { recursive: true, force: true })
    }
  }
  await mkdir(root, { recursive: true })
  const release = await acquireLock(root)
  try {
    await cleanupOrphanBuilds(root)
    const now = isoNow()
    const snapshot = await snapshotRunInputs(root, spec)
    const workspace = {
      schema_version: '1.0.0',
      id: randomUUID(),
      created: now,
      updated: now,
      revision: 1,
      activity_revision: 0,
      next_revision: 2,
      current_branch: 'main',
      branches: {
        main: { name: 'main', head_revision: 1, created: now, from_revision: 1 },
      },
      revisions: {
        '1': { revision: 1, parents: [], branch: 'main', created: now, spec: snapshot.spec, effective_feedback: [] },
      },
      status: 'ready',
      spec: snapshot.spec,
      input_sources: snapshot.sources,
    }
    const build = await buildRevision(root, workspace, null, onLog)
    await commitRevision(root, workspace, build)
    return workspace
  } finally {
    await release()
  }
}

export async function loadWorkspace(root) {
  root = path.resolve(root)
  const workspacePath = path.join(root, WORKSPACE_FILE)
  if (!await pathExists(workspacePath)) throw new Error(`Not a ggtree-air workspace: ${root}`)
  const rawWorkspace = await readJson(workspacePath)
  if (rawWorkspace.schema_version !== '1.0.0') throw new Error('Unsupported workspace schema')
  const workspace = await upgradeWorkspace(root, rawWorkspace)
  return { root, workspace }
}

export async function readWorkspaceAnnotations(root) {
  const scene = await readJson(path.join(root, 'scene.json'))
  const annotations = await readJson(path.join(root, 'annotations.json'))
  return normalizeAnnotationEnvelope(annotations, scene)
}

export async function saveNaturalLanguagePlan(root, prompt, context = {}) {
  root = path.resolve(root)
  const { workspace } = await loadWorkspace(root)
  const [annotations, scene] = await Promise.all([
    readWorkspaceAnnotations(root),
    readJson(path.join(root, 'scene.json')),
  ])
  const plan = await planNaturalLanguage({
    prompt, workspace, annotations, scene, source_view_id: context.source_view_id,
  })
  const sourceView = scene.views.find((view) => view.id === context.source_view_id)
  if (sourceView) {
    plan.source_view_id = sourceView.id
    plan.source_revision = workspace.revision
  }
  await atomicWriteJson(path.join(root, INTERNAL_DIR, 'pending_plan.json'), plan)
  return plan
}

export async function saveWorkspacePlan(root, input) {
  root = path.resolve(root)
  const { workspace } = await loadWorkspace(root)
  const plan = await normalizeRunPlan(input, workspace)
  await atomicWriteJson(path.join(root, INTERNAL_DIR, 'pending_plan.json'), plan)
  return plan
}

export async function saveWorkspaceAnnotations(root, input) {
  const scene = await readJson(path.join(root, 'scene.json'))
  const annotations = normalizeAnnotationEnvelope(input, scene)
  await atomicWriteJson(path.join(root, 'annotations.json'), annotations)
  return annotations
}

export async function rerunWorkspace(root, { onLog, signal, progress = () => undefined } = {}) {
  root = path.resolve(root)
  const release = await acquireLock(root)
  try {
    progress('validating-feedback')
    await cleanupOrphanBuilds(root)
    const { workspace: current } = await loadWorkspace(root)
    const feedback = await readWorkspaceAnnotations(root)
    const pendingPlanPath = path.join(root, INTERNAL_DIR, 'pending_plan.json')
    const runPlan = await pathExists(pendingPlanPath) ? await readJson(pendingPlanPath) : null
    if (feedback.annotations.length === 0 && !runPlan) {
      throw new Error('No annotations or pending run plan are available to apply')
    }
    progress('snapshotting-revision', { revision: current.revision })
    await snapshotCurrentRevision(root, current)
    await atomicWriteJson(path.join(root, WORKSPACE_FILE), {
      ...current, status: 'running', updated: isoNow(), last_error: null,
    })
    const nextSpec = runPlan?.next_spec ?? current.spec
    const previousFeedback = current.revisions[String(current.revision)]?.effective_feedback || []
    const effectiveFeedback = [...previousFeedback]
    for (const annotation of feedback.annotations) {
      const existing = effectiveFeedback.findIndex((item) => item.id === annotation.id)
      if (existing >= 0) effectiveFeedback[existing] = annotation
      else effectiveFeedback.push(annotation)
    }
    const renderFeedback = { ...feedback, annotations: effectiveFeedback }
    const nextRevision = current.next_revision
    const currentBranch = current.current_branch
    const workspace = {
      ...current,
      spec: nextSpec,
      updated: isoNow(),
      revision: nextRevision,
      next_revision: nextRevision + 1,
      branches: {
        ...current.branches,
        [currentBranch]: {
          ...current.branches[currentBranch],
          head_revision: nextRevision,
        },
      },
      revisions: {
        ...current.revisions,
        [String(nextRevision)]: {
          revision: nextRevision,
          parents: [current.revision],
          branch: currentBranch,
          created: isoNow(),
          spec: nextSpec,
          effective_feedback: effectiveFeedback,
        },
      },
      status: 'ready',
      last_error: null,
    }
    try {
      const build = await buildRevision(
        root, workspace, feedback, onLog, signal, progress, runPlan, renderFeedback
      )
      if (build.evaluation.diff.views.every((view) => !view.changed)) {
        await rm(build.buildDir, { recursive: true, force: true })
        const error = new Error('The requested change produced no visible artifact difference')
        error.code = 'NO_VISIBLE_CHANGE'
        throw error
      }
      if (signal?.aborted) throw Object.assign(new Error('Rerun cancelled'), { code: 'JOB_CANCELLED' })
      progress('committing', { revision: workspace.revision })
      await commitRevision(root, workspace, build, current.revision, current)
      if (runPlan) await rm(pendingPlanPath, { force: true })
      await saveCurrentBranchState(root, workspace)
      progress('completed', { revision: workspace.revision })
      return workspace
    } catch (error) {
      await atomicWriteJson(path.join(root, WORKSPACE_FILE), {
        ...current,
        status: ['JOB_CANCELLED', 'NO_VISIBLE_CHANGE'].includes(error?.code) ? 'ready' : 'error',
        updated: isoNow(),
        last_error: ['JOB_CANCELLED', 'NO_VISIBLE_CHANGE'].includes(error?.code) ? null : error.message,
      })
      throw error
    }
  } finally {
    await release()
  }
}

function validBranchName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
}

function branchStateDir(root, branch) {
  return path.join(root, INTERNAL_DIR, 'branch-state', branch)
}

async function saveCurrentBranchState(root, workspace) {
  const stateDir = branchStateDir(root, workspace.current_branch)
  await mkdir(stateDir, { recursive: true })
  const annotationsPath = path.join(root, 'annotations.json')
  if (await pathExists(annotationsPath)) {
    await copyFile(annotationsPath, path.join(stateDir, 'annotations.json'))
  }
  const pendingPlan = path.join(root, INTERNAL_DIR, 'pending_plan.json')
  if (await pathExists(pendingPlan)) {
    await copyFile(pendingPlan, path.join(stateDir, 'pending_plan.json'))
  } else await rm(path.join(stateDir, 'pending_plan.json'), { force: true })
}

async function restoreBranchState(root, workspace, branch) {
  const stateDir = branchStateDir(root, branch)
  const scene = await readJson(path.join(root, 'scene.json'))
  const storedAnnotations = path.join(stateDir, 'annotations.json')
  let annotations = createAnnotationEnvelope(scene)
  if (await pathExists(storedAnnotations)) {
    const candidate = await readJson(storedAnnotations)
    try { annotations = normalizeAnnotationEnvelope(candidate, scene) }
    catch { annotations = createAnnotationEnvelope(scene) }
  }
  await atomicWriteJson(path.join(root, 'annotations.json'), annotations)
  const storedPlan = path.join(stateDir, 'pending_plan.json')
  const pendingPlan = path.join(root, INTERNAL_DIR, 'pending_plan.json')
  if (await pathExists(storedPlan)) {
    const plan = await readJson(storedPlan)
    if (Number(plan.base_revision) === workspace.branches[branch].head_revision) {
      await copyFile(storedPlan, pendingPlan)
    } else await rm(pendingPlan, { force: true })
  } else await rm(pendingPlan, { force: true })
}

async function materializeRevision(root, revision) {
  const archiveDir = path.join(root, INTERNAL_DIR, 'revisions', `r${String(revision).padStart(4, '0')}`)
  if (!await pathExists(path.join(archiveDir, 'scene.json'))) {
    throw new Error(`Revision ${revision} is not archived and cannot be materialized`)
  }
  const currentFiles = await listTopLevelArtifacts(root)
  await Promise.all(currentFiles.map((target) => rm(target, { force: true })))
  await copyFiles(await listTopLevelArtifacts(archiveDir), root)
}

export async function listWorkspaceBranches(root) {
  const { workspace } = await loadWorkspace(root)
  return {
    current_branch: workspace.current_branch,
    branches: Object.values(workspace.branches).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export async function createWorkspaceBranch(root, name, fromRevision = null) {
  root = path.resolve(root)
  if (!validBranchName(name)) throw new Error('Branch name must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}')
  const release = await acquireLock(root)
  try {
    const { workspace } = await loadWorkspace(root)
    if (workspace.branches[name]) throw new Error(`Branch already exists: ${name}`)
    const sourceRevision = fromRevision == null ? workspace.revision : Number(fromRevision)
    if (!Number.isInteger(sourceRevision) || !workspace.revisions[String(sourceRevision)]) {
      throw new Error(`Unknown source revision: ${fromRevision}`)
    }
    await snapshotCurrentRevision(root, workspace)
    await saveCurrentBranchState(root, workspace)
    const updated = {
      ...workspace,
      updated: isoNow(),
      branches: {
        ...workspace.branches,
        [name]: {
          name,
          head_revision: sourceRevision,
          created: isoNow(),
          from_revision: sourceRevision,
        },
      },
    }
    await atomicWriteJson(path.join(root, WORKSPACE_FILE), updated)
    await buildReport({ outputDir: root, workspaceRoot: root, workspace: updated,
                        annotations: await readWorkspaceAnnotations(root) })
    await buildManifest(root, updated)
    return updated.branches[name]
  } finally {
    await release()
  }
}

export async function switchWorkspaceBranch(root, name) {
  root = path.resolve(root)
  const release = await acquireLock(root)
  try {
    const { workspace } = await loadWorkspace(root)
    const target = workspace.branches[name]
    if (!target) throw new Error(`Unknown branch: ${name}`)
    if (workspace.current_branch === name) return workspace
    await snapshotCurrentRevision(root, workspace)
    await saveCurrentBranchState(root, workspace)
    if (target.head_revision !== workspace.revision) {
      await materializeRevision(root, target.head_revision)
    }
    const record = workspace.revisions[String(target.head_revision)]
    if (!record) throw new Error(`Missing revision record ${target.head_revision}`)
    const updated = {
      ...workspace,
      current_branch: name,
      revision: target.head_revision,
      spec: record.spec,
      updated: isoNow(),
      status: 'ready',
      last_error: null,
    }
    await atomicWriteJson(path.join(root, WORKSPACE_FILE), updated)
    await restoreBranchState(root, updated, name)
    await buildReport({ outputDir: root, workspaceRoot: root, workspace: updated,
                        annotations: await readWorkspaceAnnotations(root) })
    await buildManifest(root, updated)
    return updated
  } finally {
    await release()
  }
}

function ancestorDistances(workspace, start) {
  const distances = new Map([[start, 0]])
  const queue = [start]
  while (queue.length) {
    const revision = queue.shift()
    const distance = distances.get(revision)
    for (const parent of workspace.revisions[String(revision)]?.parents || []) {
      if (distances.has(parent)) continue
      distances.set(parent, distance + 1)
      queue.push(parent)
    }
  }
  return distances
}

function mergeBaseRevision(workspace, left, right) {
  const leftDistances = ancestorDistances(workspace, left)
  const rightDistances = ancestorDistances(workspace, right)
  const common = [...leftDistances.keys()].filter((revision) => rightDistances.has(revision))
  if (!common.length) throw new Error('Branches have no common ancestor')
  return common.sort((a, b) =>
    leftDistances.get(a) + rightDistances.get(a) - leftDistances.get(b) - rightDistances.get(b))[0]
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

async function mergeBranchSpecs(workspace, baseRevision, targetRevision, sourceRevision, strategy) {
  const base = workspace.revisions[String(baseRevision)].spec
  const target = workspace.revisions[String(targetRevision)].spec
  const source = workspace.revisions[String(sourceRevision)].spec
  const merged = {}
  const conflicts = []
  for (const key of new Set([...Object.keys(base), ...Object.keys(target), ...Object.keys(source)])) {
    if (sameValue(target[key], source[key])) merged[key] = structuredClone(target[key])
    else if (sameValue(target[key], base[key])) merged[key] = structuredClone(source[key])
    else if (sameValue(source[key], base[key])) merged[key] = structuredClone(target[key])
    else {
      conflicts.push(key)
      if (strategy === 'ours') merged[key] = structuredClone(target[key])
      else if (strategy === 'theirs') merged[key] = structuredClone(source[key])
    }
  }
  if (conflicts.length && strategy === 'auto') {
    const error = new Error(`Merge conflicts in visualization fields: ${conflicts.join(', ')}`)
    error.code = 'MERGE_CONFLICT'
    error.conflicts = conflicts
    throw error
  }
  return { spec: await normalizeRunSpec(merged), conflicts }
}

export async function mergeWorkspaceBranch(root, sourceName, {
  strategy = 'auto', onLog, signal, progress = () => undefined,
} = {}) {
  root = path.resolve(root)
  if (!['auto', 'ours', 'theirs'].includes(strategy)) throw new Error('strategy must be auto, ours, or theirs')
  const release = await acquireLock(root)
  try {
    const { workspace: current } = await loadWorkspace(root)
    const source = current.branches[sourceName]
    const pendingAnnotations = await readWorkspaceAnnotations(root)
    if (pendingAnnotations.annotations.length > 0
        || await pathExists(path.join(root, INTERNAL_DIR, 'pending_plan.json'))) {
      throw new Error('Commit or clear pending feedback/run plans before merging branches')
    }
    if (!source) throw new Error(`Unknown source branch: ${sourceName}`)
    if (sourceName === current.current_branch) throw new Error('Cannot merge a branch into itself')
    const targetHead = current.revision
    const sourceHead = source.head_revision
    const baseRevision = mergeBaseRevision(current, targetHead, sourceHead)
    const merged = await mergeBranchSpecs(current, baseRevision, targetHead, sourceHead, strategy)
    await snapshotCurrentRevision(root, current)
    const nextRevision = current.next_revision
    const mergePlan = {
      schema_version: '1.0.0',
      base_revision: targetHead,
      created: isoNow(),
      operations: [{ op: 'merge-branch', source: sourceName, target: current.current_branch,
                     strategy, conflicts: merged.conflicts }],
      rationale: `Merge ${sourceName} into ${current.current_branch}`,
      next_spec: merged.spec,
    }
    const mergedFeedback = []
    for (const annotation of [
      ...(current.revisions[String(targetHead)]?.effective_feedback || []),
      ...(current.revisions[String(sourceHead)]?.effective_feedback || []),
    ]) {
      if (!mergedFeedback.some((item) => item.id === annotation.id)) mergedFeedback.push(annotation)
    }
    const workspace = {
      ...current,
      revision: nextRevision,
      next_revision: nextRevision + 1,
      spec: merged.spec,
      updated: isoNow(),
      branches: {
        ...current.branches,
        [current.current_branch]: {
          ...current.branches[current.current_branch], head_revision: nextRevision,
        },
      },
      revisions: {
        ...current.revisions,
        [String(nextRevision)]: {
          revision: nextRevision,
          parents: [targetHead, sourceHead],
          branch: current.current_branch,
          created: isoNow(),
          spec: merged.spec,
          merge: { source: sourceName, base_revision: baseRevision, strategy,
                   conflicts: merged.conflicts },
          effective_feedback: mergedFeedback,
        },
      },
      status: 'ready',
      last_error: null,
    }
    const feedback = createAnnotationEnvelope(await readJson(path.join(root, 'scene.json')))
    const renderFeedback = { ...feedback, annotations: mergedFeedback }
    const build = await buildRevision(
      root, workspace, feedback, onLog, signal, progress, mergePlan, renderFeedback
    )
    if (signal?.aborted) throw Object.assign(new Error('Merge cancelled'), { code: 'JOB_CANCELLED' })
    await commitRevision(root, workspace, build, targetHead, current)
    await saveCurrentBranchState(root, workspace)
    return workspace
  } finally {
    await release()
  }
}

export async function refreshWorkspacePresentation(root) {
  root = path.resolve(root)
  const release = await acquireLock(root)
  try {
    const { workspace } = await loadWorkspace(root)
    const annotations = await readWorkspaceAnnotations(root)
    await buildReport({ outputDir: root, workspaceRoot: root, workspace, annotations })
    await buildManifest(root, workspace)
    return workspace
  } finally {
    await release()
  }
}

export async function workspaceSummary(root) {
  const { workspace } = await loadWorkspace(root)
  const [scene, annotations, feedbackStatus] = await Promise.all([
    readJson(path.join(root, 'scene.json')),
    readJson(path.join(root, 'annotations.json')),
    readJson(path.join(root, 'feedback_status.json')),
  ])
  return {
    schema_version: '1.0.0',
    id: workspace.id,
    revision: workspace.revision,
    activity_revision: Number(workspace.activity_revision || 0),
    current_branch: workspace.current_branch,
    branches: Object.values(workspace.branches || {}).map((branch) => ({
      name: branch.name,
      head_revision: branch.head_revision,
      from_revision: branch.from_revision,
    })),
    title: workspace.spec.title,
    scene_id: scene.scene_id,
    tips: scene.tree.tips,
    layouts: scene.views.map((view) => view.layout),
    annotation_count: annotations.annotations.length,
    feedback_status: feedbackStatus.items,
  }
}
