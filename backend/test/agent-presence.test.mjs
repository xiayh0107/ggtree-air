import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import {
  beginAgentPresence, listAgentPresences, pulseAgentPresence,
} from '../src/agent-presence.mjs'
import { createArtifactWorkspace } from '../src/workspace.mjs'
import { startWorkspaceServer } from '../src/server.mjs'

test('external Agent heartbeat is visible, renewed, and released without deleting newer pulses', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-presence-'))
  try {
    const lease = await beginAgentPresence(root, 'codex', { state: 'waiting' })
    assert.deepEqual((await listAgentPresences(root)).map((item) => [item.id, item.state]), [
      ['codex', 'waiting'],
    ])
    assert.equal(await pulseAgentPresence(root, 'managed:codex', { state: 'running' }), null)
    await pulseAgentPresence(root, 'codex', { state: 'running' })
    await lease.close()
    assert.deepEqual((await listAgentPresences(root)).map((item) => [item.id, item.state]), [
      ['codex', 'running'],
    ])
    await assert.rejects(() => beginAgentPresence(root, '../escape'), /Invalid external Agent id/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('external heartbeat makes an agent-none workspace report a connected Agent', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-presence-api-'))
  const root = path.join(parent, 'workspace')
  let service
  try {
    await createArtifactWorkspace({ root, title: 'presence API' })
    const lease = await beginAgentPresence(root, 'codex', { state: 'waiting' })
    service = await startWorkspaceServer({
      root, port: 0, agentAdapter: 'none',
      piCommand: path.join(parent, 'missing-pi'),
      codexCommand: path.join(parent, 'missing-codex'),
      claudeCommand: path.join(parent, 'missing-claude'),
      onLog: () => undefined,
    })
    const response = await fetch(`${service.url}/api/agents`).then((value) => value.json())
    assert.equal(response.selected_agent, 'codex')
    assert.equal(response.managed_agent, null)
    assert.equal(response.external_agents[0].state, 'waiting')
    assert.equal(response.agents.find((agent) => agent.id === 'codex').selected, true)
    await lease.close()
  } finally {
    if (service) await new Promise((resolve) => service.server.close(resolve))
    await rm(parent, { recursive: true, force: true })
  }
})
