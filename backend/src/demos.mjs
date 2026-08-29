import os from 'node:os'
import path from 'node:path'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { PROJECT_ROOT, pathExists, readJson } from './paths.mjs'
import { runRecipe } from './recipes.mjs'
import {
  claimAction, commitActionArtifacts, createAction, importWorkspaceArtifact,
  markActionRunning, updateActionProgress,
} from './actions.mjs'
import { refreshWorkspacePresentation } from './workspace.mjs'
import { openWorkspaceService, readServiceState } from './service-manager.mjs'

const DEMO_CATALOG = path.join(PROJECT_ROOT, 'examples', 'paper-demos.json')

export function demoRoot(id) {
  const base = process.env.GGTREE_AIR_DEMOS_DIR
    ? path.resolve(process.env.GGTREE_AIR_DEMOS_DIR)
    : path.join(os.homedir(), '.ggtree-air', 'demos')
  return path.join(base, id)
}

async function catalog() {
  const value = await readJson(DEMO_CATALOG)
  if (value.schema_version !== '1.0.0' || !Array.isArray(value.demos)) {
    throw new Error('Unsupported paper demo catalog')
  }
  return value.demos
}

export async function listPaperDemos() {
  const demos = await catalog()
  return Promise.all(demos.filter((demo) => demo.status === 'verified').map(async (demo) => {
    const root = demoRoot(demo.id)
    const installed = await pathExists(path.join(root, 'workspace.json'))
    const service = installed ? await readServiceState(root) : null
    return {
      ...demo,
      root,
      installed,
      service: service?.status === 'running' ? { status: 'running', url: service.url } : { status: 'stopped' },
    }
  }))
}

export async function createPaperDemo(id, { force = false, onLog = () => undefined } = {}) {
  const demo = (await catalog()).find((candidate) => candidate.id === id && candidate.status === 'verified')
  if (!demo) throw new Error(`Unknown or unverified paper demo: ${id}`)
  const root = demoRoot(id)
  if (force) await rm(root, { recursive: true, force: true })
  if (!await pathExists(path.join(root, 'workspace.json'))) {
    await runRecipe({ id: demo.recipe, outputDir: root, force: true, onLog })
    const referenceArtifact = await importWorkspaceArtifact(
      root, path.join(PROJECT_ROOT, 'examples', demo.reference_asset), {
        label: `${demo.paper.authors} ${demo.paper.year} · 目标 Figure`,
        role: 'paper-reference',
        metadata: {
          paper: demo.paper,
          evidence: demo.evidence,
          benchmark: demo.benchmark || 'style-transfer',
          note: 'Verified target figure for a recorded user–Agent workflow; see DOI and provenance.',
        },
      },
    )
    for (let index = 0; index < (demo.actions || []).length; index += 1) {
      const scripted = demo.actions[index]
      const action = await createAction(root, {
        sources: [
          { kind: 'workspace-artifact', artifact_id: referenceArtifact.id },
          { kind: 'revision-view', revision: 1, layout: scripted.layout },
        ],
        instruction: scripted.instruction,
      })
      const agent = demo.recording?.agent || `recorded-demo:${demo.id}`
      await claimAction(root, action.id, agent)
      await markActionRunning(root, action.id, agent)
      let output = path.join(root, scripted.output)
      if (scripted.output_asset) {
        const stagedDir = path.join(root, '.ggtree-air', 'demo-artifacts')
        await mkdir(stagedDir, { recursive: true })
        output = path.join(stagedDir, `${index + 1}-${path.basename(scripted.output_asset)}`)
        await copyFile(path.join(PROJECT_ROOT, 'examples', scripted.output_asset), output)
      }
      await updateActionProgress(root, action.id, {
        phase: 'preview', percent: 80,
        message: '已生成论文场景候选，正在检查图例与布局',
        preview: output, agentId: agent,
      })
      await commitActionArtifacts(root, action.id, [
        { path: output, label: scripted.label },
      ], { agentId: agent })
    }
    await refreshWorkspacePresentation(root)
  }
  return { demo, root }
}

export async function openPaperDemo(id, options = {}) {
  const created = await createPaperDemo(id, options)
  const service = await openWorkspaceService(created.root, { browser: options.browser !== false })
  return { ...created, service }
}
