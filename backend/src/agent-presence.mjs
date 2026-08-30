import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteJson, pathExists, readJson } from './paths.mjs'

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,159}$/
const WAIT_TTL_MS = 5_000
const PULSE_TTL_MS = 30_000

function presenceDir(root) {
  return path.join(path.resolve(root), '.ggtree-air', 'agent-presence')
}

function presencePath(root, agentId) {
  if (!AGENT_ID.test(agentId) || agentId.includes('..') || agentId.includes('//')) {
    throw new Error(`Invalid external Agent id: ${agentId}`)
  }
  return path.join(presenceDir(root), `${Buffer.from(agentId).toString('base64url')}.json`)
}

async function writePresence(root, agentId, { token, state, ttlMs, pid = process.pid }) {
  const now = Date.now()
  const target = presencePath(root, agentId)
  await mkdir(path.dirname(target), { recursive: true })
  await atomicWriteJson(target, {
    schema_version: '1.0.0', agent_id: agentId, mode: 'external', state,
    token, pid, updated_at: new Date(now).toISOString(), expires_at: now + ttlMs,
  })
}

export async function beginAgentPresence(root, agentId, { state = 'waiting' } = {}) {
  root = path.resolve(root)
  const token = randomUUID()
  let closed = false
  const touch = () => writePresence(root, agentId, {
    token, state, ttlMs: WAIT_TTL_MS,
  })
  await touch()
  const timer = setInterval(() => { void touch() }, Math.floor(WAIT_TTL_MS / 3))
  timer.unref?.()
  return {
    token,
    async close() {
      if (closed) return
      closed = true
      clearInterval(timer)
      const target = presencePath(root, agentId)
      const current = await readJson(target).catch(() => null)
      if (current?.token === token) await rm(target, { force: true })
    },
  }
}

export async function pulseAgentPresence(root, agentId, { state = 'running' } = {}) {
  if (!agentId || String(agentId).startsWith('managed:')) return null
  const token = randomUUID()
  await writePresence(root, String(agentId), {
    token, state, ttlMs: PULSE_TTL_MS,
  })
  return token
}

export async function listAgentPresences(root) {
  root = path.resolve(root)
  const directory = presenceDir(root)
  if (!await pathExists(directory)) return []
  const now = Date.now()
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json'))
  const active = []
  for (const name of names) {
    const target = path.join(directory, name)
    const value = await readJson(target).catch(() => null)
    if (!value || !AGENT_ID.test(String(value.agent_id || '')) || Number(value.expires_at) <= now) {
      await rm(target, { force: true }).catch(() => undefined)
      continue
    }
    active.push({
      id: value.agent_id,
      mode: 'external',
      state: value.state || 'waiting',
      updated_at: value.updated_at,
      expires_at: value.expires_at,
    })
  }
  return active.sort((left, right) => left.id.localeCompare(right.id))
}
