import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { importWorkspaceArtifact, listActions } from '../src/actions.mjs'
import { createArtifactWorkspace, refreshWorkspacePresentation, workspaceSummary } from '../src/workspace.mjs'

test('artifact-first workspace starts with real inputs and no pre-rendered tree outputs', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-inputs-'))
  const root = path.join(parent, 'workspace')
  try {
    await createArtifactWorkspace({ root, title: 'input-only task' })
    const source = path.join(parent, 'tree.nwk')
    await writeFile(source, '(a:1,b:1);\n')
    const artifact = await importWorkspaceArtifact(root, source, { role: 'user-input' })
    await refreshWorkspacePresentation(root)

    const summary = await workspaceSummary(root)
    assert.equal(summary.tips, 0)
    assert.deepEqual(summary.layouts, [])
    assert.deepEqual(await listActions(root), [])
    assert.match(artifact.media_type, /newick/)
    const topLevel = await readdir(root)
    assert.equal(topLevel.some((name) => /^tree_.*\.png$/.test(name)), false)
    assert.match(await readFile(path.join(root, 'report.html'), 'utf8'), /input-only task/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
