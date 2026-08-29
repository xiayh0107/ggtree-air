import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeRunSpec } from '../src/contracts.mjs'
import { PROJECT_ROOT, pathExists } from '../src/paths.mjs'
import {
  createWorkspace, createWorkspaceBranch, listWorkspaceBranches, loadWorkspace,
  mergeWorkspaceBranch, rerunWorkspace, saveWorkspacePlan, switchWorkspaceBranch,
} from '../src/workspace.mjs'

const fixture = path.join(PROJECT_ROOT, 'renderer/r/fixtures/easy_input.dist.tsv')

test('branches diverge and merge through a two-parent artifact revision', { timeout: 180_000 }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-branches-'))
  const root = path.join(parent, 'workspace')
  try {
    const spec = await normalizeRunSpec({
      dist: fixture, layouts: ['rectangular'], intents: ['treescale'],
      render: { width: 4, height: 3, dpi: 60, formats: ['png'] },
    })
    await createWorkspace({ root, spec })
    await createWorkspaceBranch(root, 'feature')
    await switchWorkspaceBranch(root, 'feature')
    await saveWorkspacePlan(root, {
      base_revision: 1,
      operations: [{ op: 'set-layouts', values: ['rectangular', 'circular'] }],
    })
    const featureHead = await rerunWorkspace(root)
    assert.equal(featureHead.revision, 2)

    await switchWorkspaceBranch(root, 'main')
    await saveWorkspacePlan(root, {
      base_revision: 1,
      operations: [{ op: 'set-tip-labels', value: 'hide' }],
    })
    const mainHead = await rerunWorkspace(root)
    assert.equal(mainHead.revision, 3)

    const merged = await mergeWorkspaceBranch(root, 'feature')
    assert.equal(merged.revision, 4)
    assert.deepEqual(merged.revisions['4'].parents, [3, 2])
    assert.deepEqual(merged.spec.layouts, ['rectangular', 'circular'])
    assert.equal(merged.spec.tip_labels, 'hide')
    assert.equal(merged.branches.main.head_revision, 4)
    assert.equal(merged.branches.feature.head_revision, 2)
    assert.equal(await pathExists(path.join(root, '.ggtree-air/revisions/r0002/scene.json')), true)
    assert.equal(await pathExists(path.join(root, '.ggtree-air/revisions/r0003/scene.json')), true)

    await createWorkspaceBranch(root, 'revisit-r2', 2)
    const revisited = await switchWorkspaceBranch(root, 'revisit-r2')
    assert.equal(revisited.revision, 2)
    assert.equal(revisited.current_branch, 'revisit-r2')
    const listed = await listWorkspaceBranches(root)
    assert.equal(listed.current_branch, 'revisit-r2')
    assert.equal(listed.branches.length, 3)
    const loaded = await loadWorkspace(root)
    assert.equal(loaded.workspace.next_revision, 5)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
