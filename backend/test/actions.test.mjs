import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeRunSpec } from '../src/contracts.mjs'
import { PROJECT_ROOT, pathExists } from '../src/paths.mjs'
import { createWorkspace } from '../src/workspace.mjs'
import {
  claimAction, commitActionArtifacts, createAction, getAction,
  importWorkspaceArtifact, listActions, markActionRunning, updateActionProgress,
  waitForAction,
} from '../src/actions.mjs'

const fixture = path.join(PROJECT_ROOT, 'renderer/r/fixtures/easy_input.dist.tsv')

test('agent-agnostic actions can be claimed and commit one or many real artifacts', { timeout: 120_000 }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-actions-'))
  const root = path.join(parent, 'workspace')
  try {
    const spec = await normalizeRunSpec({
      dist: fixture, layouts: ['rectangular'], intents: ['treescale'],
      render: { width: 4, height: 3, dpi: 60, formats: ['png'] },
    })
    await createWorkspace({ root, spec })
    const sourceImage = path.join(root, 'tree_rectangular_intents.png')
    const reference = await importWorkspaceArtifact(root, sourceImage, {
      label: 'Paper Figure reference', role: 'paper-reference',
    })
    const action = await createAction(root, {
      sources: [
        { kind: 'workspace-artifact', artifact_id: reference.id },
        { kind: 'revision-view', revision: 1, layout: 'rectangular' },
      ],
      instruction: 'Try two clearly different color schemes',
      selection: { kind: 'region', region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
    })
    assert.equal(action.status, 'pending')
    assert.equal(action.sources.length, 2)
    assert.equal((await listActions(root, { status: 'pending' })).length, 1)
    await claimAction(root, action.id, 'test-agent')
    await markActionRunning(root, action.id, 'test-agent')
    const progress = await updateActionProgress(root, action.id, {
      phase: 'preview', message: 'Rendered two candidates; checking labels',
      percent: 70, preview: sourceImage, agentId: 'test-agent',
    })
    assert.equal(progress.progress.percent, 70)
    assert.equal(progress.events.at(-1).type, 'progress')
    assert.equal(await pathExists(path.join(root, progress.progress.preview.path)), true)
    const committedSourceImage = path.join(root, 'tree_rectangular_intents.png')
    const completed = await commitActionArtifacts(root, action.id, [
      { path: committedSourceImage, label: 'Color scheme A' },
      { path: committedSourceImage, label: 'Color scheme B' },
    ], { agentId: 'test-agent' })
    assert.equal(completed.status, 'completed')
    assert.equal(completed.outputs.length, 2)
    assert.equal((await getAction(root, action.id)).claim.agent_id, 'test-agent')
    for (const output of completed.outputs) {
      assert.equal(await pathExists(path.join(root, output.path)), true)
    }

    const waiting = waitForAction(root, { timeoutMs: 5_000, agentId: 'waiting-agent' })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const second = await createAction(root, {
      source: { kind: 'revision-view', revision: 1, layout: 'rectangular' },
      instruction: 'Make one compact version',
    })
    const triggered = await waiting
    assert.equal(triggered.id, second.id)
    assert.equal(triggered.status, 'claimed')
    assert.equal(triggered.claim.agent_id, 'waiting-agent')
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
