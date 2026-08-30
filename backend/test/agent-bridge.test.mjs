import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createAction, importWorkspaceArtifact } from '../src/actions.mjs'
import { LocalAgentRunner, readAgentRunActivity } from '../src/agent-runner.mjs'
import { AgentBridgeRegistry } from '../src/agent-bridge/registry.mjs'
import { createArtifactWorkspace, refreshWorkspacePresentation } from '../src/workspace.mjs'

test('Agent Bridge auto selection follows provider availability and preference', async () => {
  const adapter = (id, available) => ({
    id, label: id, probe: async () => ({ id, label: id, available }), invocation: () => ({}),
  })
  const registry = new AgentBridgeRegistry([
    adapter('pi', false), adapter('codex', true), adapter('claude', true),
  ], { preference: ['claude', 'codex', 'pi'] })
  assert.equal((await registry.select('auto')).descriptor.id, 'claude')
  assert.equal((await registry.select('codex')).descriptor.id, 'codex')
  assert.equal(await registry.select('pi'), null)
  assert.throws(() => new AgentBridgeRegistry([adapter('pi', true), adapter('pi', true)]), /Duplicate/)
})

for (const adapter of ['codex', 'claude']) {
  test(`managed ${adapter} adapter probes, runs, logs tools, and commits output`, async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), `ggtree-air-${adapter}-`))
    const root = path.join(parent, 'workspace')
    try {
      await createArtifactWorkspace({ root, title: `${adapter} bridge test` })
      const inputPath = path.join(parent, 'input.txt')
      await writeFile(inputPath, 'input\n')
      const input = await importWorkspaceArtifact(root, inputPath, { role: 'user-input' })
      const action = await createAction(root, {
        sources: [{ kind: 'workspace-artifact', artifact_id: input.id }],
        instruction: `Generate output with ${adapter}`,
      })
      const executable = path.join(parent, `fake-${adapter}.mjs`)
      await writeFile(executable, fakeAgentScript(adapter))
      await chmod(executable, 0o755)
      const missing = path.join(parent, 'missing-agent')
      const runner = new LocalAgentRunner({
        root, adapter,
        piCommand: missing,
        codexCommand: adapter === 'codex' ? executable : missing,
        claudeCommand: adapter === 'claude' ? executable : missing,
        onLog: () => undefined,
        onRefresh: () => refreshWorkspacePresentation(root),
      })
      const descriptor = await runner.inspect()
      assert.equal(descriptor.id, adapter)
      assert.equal(descriptor.available, true)
      assert.equal(descriptor.auth_status, 'authenticated')
      const completed = await runner.start(action.id)
      assert.equal(completed.status, 'completed')
      assert.equal(completed.claim.agent_id, `managed:${adapter}`)
      assert.equal(completed.outputs.length, 1)
      const activity = await readAgentRunActivity(root, action.id)
      assert.deepEqual(activity.map((entry) => entry.kind), ['tool-call', 'tool-result'])
      assert.equal(activity[0].name, activity[1].name)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
}

function fakeAgentScript(adapter) {
  return `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
const adapter = ${JSON.stringify(adapter)}
const args = process.argv.slice(2)
if (args.includes('--version')) { console.log(adapter + ' 1.0.0'); process.exit(0) }
if (adapter === 'codex' && args[0] === 'login') { console.log('Logged in'); process.exit(0) }
if (adapter === 'codex' && args[0] === 'exec' && args.includes('--help')) {
  console.log('--json --sandbox --cd --add-dir'); process.exit(0)
}
if (adapter === 'claude' && args[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: true })); process.exit(0)
}
if (adapter === 'claude' && args.includes('--help')) {
  console.log('--print --output-format --permission-mode'); process.exit(0)
}
const output = path.join(process.env.GGTREE_AIR_OUTPUT_DIR, adapter + '-output.txt')
mkdirSync(path.dirname(output), { recursive: true })
if (adapter === 'codex') {
  console.log(JSON.stringify({ type: 'item.started', item: { type: 'command_execution', command: 'write output' } }))
} else {
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'write-1', name: 'Write', input: { file_path: output } }] } }))
}
writeFileSync(output, 'created by ' + adapter + '\\n')
if (adapter === 'codex') {
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', status: 'completed', aggregated_output: 'ok' } }))
} else {
  console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'write-1', content: 'ok' }] } }))
}
const result = spawnSync(process.env.GGTREE_AIR_NODE, [
  process.env.GGTREE_AIR_CLI_PATH, 'artifacts', 'commit', process.env.GGTREE_AIR_ACTION_ID,
  '--workspace', process.env.GGTREE_AIR_WORKSPACE,
  '--agent', process.env.GGTREE_AIR_AGENT_ID,
  '--file', output,
], { stdio: 'inherit' })
process.exit(result.status ?? 1)
`
}
