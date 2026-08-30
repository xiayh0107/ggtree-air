import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createArtifactWorkspace, refreshWorkspacePresentation } from '../src/workspace.mjs'
import { createAction, getAction, importWorkspaceArtifact } from '../src/actions.mjs'
import { LocalAgentRunner, readAgentRunActivity } from '../src/agent-runner.mjs'

test('a node Action is completed only by a real external Agent process committing a file', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-agent-'))
  const root = path.join(parent, 'workspace')
  try {
    await createArtifactWorkspace({ root, title: 'real agent test' })
    const inputFile = path.join(parent, 'input.txt')
    await writeFile(inputFile, 'user input\n')
    const input = await importWorkspaceArtifact(root, inputFile, { role: 'user-input' })
    const action = await createAction(root, {
      sources: [{ kind: 'workspace-artifact', artifact_id: input.id }],
      instruction: 'Create a real output file',
    })
    assert.equal(action.status, 'pending')
    assert.deepEqual(action.outputs, [])

    const fakePi = path.join(parent, 'fake-pi.mjs')
    await writeFile(fakePi, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
if (process.argv.includes('--version')) { console.log('pi 1.0.0'); process.exit(0) }
if (process.argv[2] === 'auth') { console.log(JSON.stringify({ status: 'ready' })); process.exit(0) }
const output = path.join(process.env.GGTREE_AIR_OUTPUT_DIR, 'agent-output.txt')
console.log(JSON.stringify({ type: 'tool_execution_start', toolName: 'write', args: { path: output } }))
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, 'created by spawned agent process\\n')
console.log(JSON.stringify({ type: 'tool_execution_end', toolName: 'write', result: { content: [{ text: 'ok' }], isError: false } }))
const result = spawnSync(process.env.GGTREE_AIR_NODE, [
  process.env.GGTREE_AIR_CLI_PATH, 'artifacts', 'commit', process.env.GGTREE_AIR_ACTION_ID,
  '--workspace', process.env.GGTREE_AIR_WORKSPACE,
  '--agent', process.env.GGTREE_AIR_AGENT_ID,
  '--file', output,
], { stdio: 'inherit' })
process.exit(result.status ?? 1)
`)
    await chmod(fakePi, 0o755)

    const runner = new LocalAgentRunner({
      root, adapter: 'pi', piCommand: fakePi,
      codexCommand: path.join(parent, 'missing-codex'),
      claudeCommand: path.join(parent, 'missing-claude'),
      onLog: () => undefined,
      onRefresh: () => refreshWorkspacePresentation(root),
    })
    const completed = await runner.start(action.id)
    assert.equal(completed.status, 'completed')
    assert.equal(completed.claim.agent_id, 'managed:pi')
    assert.equal(completed.outputs.length, 1)
    assert.match(completed.outputs[0].label, /agent-output\.txt/)
    assert.equal((await getAction(root, action.id)).status, 'completed')
    const activity = await readAgentRunActivity(root, action.id)
    assert.deepEqual(activity.map((entry) => entry.kind), ['tool-call', 'tool-result'])
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
