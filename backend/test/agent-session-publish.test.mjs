import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { importWorkspaceArtifact, getAction } from '../src/actions.mjs'
import { PROJECT_ROOT } from '../src/paths.mjs'
import { startWorkspaceServer } from '../src/server.mjs'
import { createArtifactWorkspace } from '../src/workspace.mjs'

const CLI_PATH = path.join(PROJECT_ROOT, 'backend/bin/ggtree-air.mjs')

test('an Agent chat can publish a task that the workspace inbox dispatches into the same canvas lifecycle', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-session-publish-'))
  const root = path.join(parent, 'workspace')
  let service
  try {
    await createArtifactWorkspace({ root, title: 'session publish' })
    const inputPath = path.join(parent, 'input.txt')
    await writeFile(inputPath, 'real input\n')
    await importWorkspaceArtifact(root, inputPath, { role: 'user-input' })
    const fakePi = path.join(parent, 'fake-pi.mjs')
    await writeFile(fakePi, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
if (process.argv.includes('--version')) { console.log('pi 1.0.0'); process.exit(0) }
if (process.argv[2] === 'auth') { console.log(JSON.stringify({ status: 'ready' })); process.exit(0) }
const output = path.join(process.env.GGTREE_AIR_OUTPUT_DIR, 'published-output.txt')
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, 'published session output\\n')
const result = spawnSync(process.env.GGTREE_AIR_NODE, [
  process.env.GGTREE_AIR_CLI_PATH, 'artifacts', 'commit', process.env.GGTREE_AIR_ACTION_ID,
  '--workspace', process.env.GGTREE_AIR_WORKSPACE,
  '--agent', process.env.GGTREE_AIR_AGENT_ID, '--file', output,
], { stdio: 'inherit' })
process.exit(result.status ?? 1)
`)
    await chmod(fakePi, 0o755)
    service = await startWorkspaceServer({
      root, port: 0, agentAdapter: 'pi', piCommand: fakePi,
      codexCommand: path.join(parent, 'missing-codex'),
      claudeCommand: path.join(parent, 'missing-claude'),
      onLog: () => undefined,
    })
    const publish = spawnSync(process.execPath, [
      CLI_PATH, 'actions', 'publish', '--workspace', root,
      '--author', 'codex-desktop', '--instruction', 'Publish this exact chat task to the canvas',
    ], { encoding: 'utf8' })
    assert.equal(publish.status, 0, publish.stderr)
    const created = JSON.parse(publish.stdout)
    assert.equal(created.origin.kind, 'agent-session')
    assert.equal(created.origin.actor, 'codex-desktop')
    assert.equal(created.sources.length, 1)

    let action = created
    for (let attempt = 0; attempt < 200 && action.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      action = await getAction(root, created.id)
    }
    assert.equal(action.status, 'completed')
    assert.equal(action.claim.agent_id, 'managed:pi')
    assert.equal(action.outputs[0].label, 'published-output.txt')
  } finally {
    if (service) await new Promise((resolve) => service.server.close(resolve))
    await rm(parent, { recursive: true, force: true })
  }
})
