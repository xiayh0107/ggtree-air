import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { importWorkspaceArtifact } from '../src/actions.mjs'
import { startWorkspaceServer } from '../src/server.mjs'
import { createArtifactWorkspace } from '../src/workspace.mjs'

test('posting a node Action launches the configured Agent CLI and materializes its output', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-http-agent-'))
  const root = path.join(parent, 'workspace')
  let service
  try {
    await createArtifactWorkspace({ root, title: 'HTTP Agent run' })
    const inputPath = path.join(parent, 'input.nwk')
    await writeFile(inputPath, '(a:1,b:1);\n')
    const input = await importWorkspaceArtifact(root, inputPath, { role: 'user-input' })
    const fakePi = path.join(parent, 'fake-pi.mjs')
    await writeFile(fakePi, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
const output = path.join(process.env.GGTREE_AIR_OUTPUT_DIR, 'result.txt')
console.log(JSON.stringify({ type: 'tool_execution_start', toolName: 'write', args: { path: output } }))
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, 'real child process output\\n')
console.log(JSON.stringify({ type: 'tool_execution_end', toolName: 'write', result: { content: [{ text: 'ok' }] } }))
const child = spawnSync(process.env.GGTREE_AIR_NODE, [process.env.GGTREE_AIR_CLI_PATH,
  'artifacts', 'commit', process.env.GGTREE_AIR_ACTION_ID,
  '--workspace', process.env.GGTREE_AIR_WORKSPACE,
  '--agent', process.env.GGTREE_AIR_AGENT_ID, '--file', output], { stdio: 'inherit' })
process.exit(child.status ?? 1)
`)
    await chmod(fakePi, 0o755)
    service = await startWorkspaceServer({
      root, port: 0, agentAdapter: 'pi', agentCommand: fakePi, onLog: () => undefined,
    })
    const createdResponse = await fetch(`${service.url}/api/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ggtree-air-token': service.token },
      body: JSON.stringify({
        sources: [{ kind: 'workspace-artifact', artifact_id: input.id }],
        instruction: 'Generate a verified file',
      }),
    })
    assert.equal(createdResponse.status, 201)
    const created = await createdResponse.json()
    let action = created
    for (let attempt = 0; attempt < 100 && action.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      action = await fetch(`${service.url}/api/actions/${created.id}`).then((response) => response.json())
    }
    assert.equal(action.status, 'completed')
    assert.equal(action.claim.agent_id, 'managed:pi')
    assert.equal(action.outputs.length, 1)
    const log = await fetch(`${service.url}/api/actions/${created.id}/log`).then((response) => response.json())
    assert.deepEqual(log.activity.map((entry) => entry.kind), ['tool-call', 'tool-result'])
    let active = [created.id]
    for (let attempt = 0; attempt < 200 && active.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      const agents = await fetch(`${service.url}/api/agents`).then((response) => response.json())
      active = agents.agents[0].active_actions
    }
    assert.deepEqual(active, [])
  } finally {
    if (service) await new Promise((resolve) => service.server.close(resolve))
    await rm(parent, { recursive: true, force: true })
  }
})
