import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteJson, isoNow, pathExists, readJson } from './paths.mjs'

const CLI_PATH = fileURLToPath(new URL('../bin/ggtree-air.mjs', import.meta.url))

function statePath(root) {
  return path.join(root, '.ggtree-air', 'service.json')
}

function processAlive(pid) {
  try {
    process.kill(Number(pid), 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function healthy(state) {
  if (!state?.url || !processAlive(state.pid)) return false
  try {
    const response = await fetch(`${state.url}/api/health`, { signal: AbortSignal.timeout(1_500) })
    return response.ok
  } catch { return false }
}

export async function readServiceState(root) {
  const target = statePath(path.resolve(root))
  if (!await pathExists(target)) return null
  const state = await readJson(target).catch(() => null)
  return state && await healthy(state) ? { ...state, status: 'running' } : { ...state, status: 'stale' }
}

export async function registerService(root, service) {
  const target = statePath(path.resolve(root))
  await atomicWriteJson(target, {
    schema_version: '1.0.0',
    pid: process.pid,
    url: service.url,
    host: service.host,
    port: service.port,
    started: isoNow(),
    version: '0.5.0',
  })
  return target
}

export async function unregisterService(root) {
  const target = statePath(path.resolve(root))
  const state = await readJson(target).catch(() => null)
  if (!state || Number(state.pid) === process.pid || !processAlive(state.pid)) {
    await rm(target, { force: true })
  }
}

function launchBrowser(url) {
  const command = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.unref()
}

export async function openWorkspaceService(root, { browser = true } = {}) {
  root = path.resolve(root)
  const current = await readServiceState(root)
  if (current?.status === 'running') {
    if (browser) launchBrowser(current.url)
    return current
  }
  await mkdir(path.join(root, '.ggtree-air'), { recursive: true })
  await rm(statePath(root), { force: true })
  const logPath = path.join(root, '.ggtree-air', 'service.log')
  const log = openSync(logPath, 'a')
  const child = spawn(process.execPath, [CLI_PATH, 'serve', '--workspace', root, '--port', '0'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, GGTREE_AIR_DETACHED_SERVICE: '1' },
  })
  child.unref()
  closeSync(log)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const state = await readServiceState(root)
    if (state?.status === 'running') {
      if (browser) launchBrowser(state.url)
      return state
    }
    if (!processAlive(child.pid)) break
  }
  throw new Error(`Workspace service did not start; inspect ${logPath}`)
}

export async function stopWorkspaceService(root) {
  root = path.resolve(root)
  const state = await readServiceState(root)
  if (!state || state.status !== 'running') {
    await rm(statePath(root), { force: true })
    return { status: 'stopped' }
  }
  process.kill(Number(state.pid), 'SIGTERM')
  for (let attempt = 0; attempt < 50 && processAlive(state.pid); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await rm(statePath(root), { force: true })
  return { ...state, status: 'stopped' }
}
