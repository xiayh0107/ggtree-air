import { spawn } from 'node:child_process'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  claimAction, failAction, getAction, markActionRunning,
} from './actions.mjs'
import { bundledSkillPath } from './skill-manager.mjs'
import {
  createClaudeAdapter, createCodexAdapter, createPiAdapter,
} from './agent-bridge/adapters.mjs'
import { normalizeAgentActivity } from './agent-bridge/events.mjs'
import { AgentBridgeRegistry, normalizeAgentId } from './agent-bridge/registry.mjs'

const CLI_PATH = fileURLToPath(new URL('../bin/ggtree-air.mjs', import.meta.url))

export async function readAgentRunActivity(root, actionId) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(actionId)) throw new Error('Invalid Action id')
  const target = path.join(path.resolve(root), '.ggtree-air', 'agent-runs', actionId, 'agent.jsonl')
  const content = await readFile(target, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  const activity = []
  const toolNames = new Map()
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    let wrapper
    try { wrapper = JSON.parse(line) } catch { continue }
    if (wrapper.stream === 'stderr' && String(wrapper.text || '').trim()) {
      activity.push({ time: wrapper.time, kind: 'warning', text: String(wrapper.text).trim().slice(0, 2000) })
      continue
    }
    for (const nestedLine of String(wrapper.text || '').split('\n')) {
      if (!nestedLine.trim()) continue
      let event
      try { event = JSON.parse(nestedLine) } catch { continue }
      for (const entry of normalizeAgentActivity(event, wrapper.time)) {
        if (entry.kind === 'tool-call' && entry.tool_id) toolNames.set(entry.tool_id, entry.name)
        if (entry.kind === 'tool-result' && entry.tool_id && toolNames.has(entry.tool_id)) {
          entry.name = toolNames.get(entry.tool_id)
        }
        activity.push(entry)
      }
    }
  }
  return activity.slice(-200)
}

function actionPrompt({ root, action, runDir, agentId, skillPath }) {
  const cli = `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_PATH)}`
  return `You are the real external Agent executing a user-created ggtree-air Action.

Workspace: ${root}
Action id: ${action.id}
Run output directory: ${runDir}
Canonical Skill: ${skillPath}

This Action has already been claimed and marked running by the local Agent Bridge. Read the complete Action record with:
${cli} actions show ${action.id} --workspace ${JSON.stringify(root)}

Required protocol:
1. Read ${skillPath} completely, then inspect every item in action.sources. Resolve relative artifact paths against the workspace root. Distinguish target/reference figures from user tree, metadata, and previous outputs.
2. Work on the user's concrete request; do not substitute a generic Recipe and do not copy a reference image as the answer.
3. Write all newly generated deliverables under ${runDir}. Use R/ggtree/ggtreeExtra or other appropriate tools and actually inspect generated images before accepting them.
4. Report meaningful progress when useful:
${cli} actions progress ${action.id} --workspace ${JSON.stringify(root)} --agent ${JSON.stringify(agentId)} --phase render --percent 60 --message ${JSON.stringify('正在生成并检查真实产物')}
5. Commit one or more real output files before finishing:
${cli} artifacts commit ${action.id} --workspace ${JSON.stringify(root)} --agent ${JSON.stringify(agentId)} --file OUTPUT_FILE
6. If the task cannot be completed, mark it failed with a truthful reason. Never fabricate completion, conversation history, previews, or artifacts.

User instruction:
${action.instruction}
`
}

export class LocalAgentRunner {
  constructor({
    root,
    adapter = process.env.GGTREE_AIR_AGENT || 'auto',
    piCommand = process.env.GGTREE_AIR_PI_COMMAND || 'pi',
    codexCommand = process.env.GGTREE_AIR_CODEX_COMMAND || 'codex',
    claudeCommand = process.env.GGTREE_AIR_CLAUDE_COMMAND || 'claude',
    preference = String(process.env.GGTREE_AIR_AGENT_PREFERENCE || 'pi,codex,claude')
      .split(',').map((value) => normalizeAgentId(value.trim())).filter(Boolean),
    bridge,
    onLog = console.error,
    onRefresh,
  }) {
    this.root = path.resolve(root)
    this.adapter = normalizeAgentId(adapter)
    this.onLog = onLog
    this.onRefresh = onRefresh || (async () => undefined)
    this.active = new Map()
    this.starting = new Set()
    this.selection = null
    this.bridge = bridge || new AgentBridgeRegistry([
      createPiAdapter({ command: piCommand }),
      createCodexAdapter({ command: codexCommand }),
      createClaudeAdapter({ command: claudeCommand }),
    ], { preference })
  }

  async listAgents() {
    const selected = await this.inspect()
    return (await this.bridge.list()).map((descriptor) => ({
      ...descriptor,
      selected: descriptor.id === selected.id && selected.available,
      active_actions: descriptor.id === selected.id ? this.activeActionIds() : [],
    }))
  }

  async inspect() {
    if (this.selection) return this.selection.descriptor
    if (this.adapter === 'none') {
      return { id: 'none', label: 'External Agent', available: false, detail: 'Managed Agent execution is disabled' }
    }
    const selection = await this.bridge.select(this.adapter)
    if (selection) {
      this.selection = selection
      return selection.descriptor
    }
    const requested = this.adapter === 'auto' ? null : this.adapter
    const descriptor = requested
      ? (await this.bridge.list()).find((candidate) => candidate.id === requested)
      : null
    return descriptor || {
      id: this.adapter, label: this.adapter, available: false,
      detail: this.adapter === 'auto' ? 'No managed Agent adapter is available'
        : `Agent adapter is unavailable: ${this.adapter}`,
    }
  }

  activeActionIds() {
    return [...this.active.keys()]
  }

  async start(actionId) {
    if (this.active.has(actionId)) return this.active.get(actionId).completion
    if (this.starting.has(actionId)) return null
    this.starting.add(actionId)
    try {
    const descriptor = await this.inspect()
    if (!descriptor.available) return null
    const selection = this.selection || await this.bridge.select(descriptor.id)
    if (!selection) return null
    const { adapter } = selection
    const action = await getAction(this.root, actionId)
    if (action.status !== 'pending') return null
    const agentId = `managed:${descriptor.id}`
    await claimAction(this.root, actionId, agentId)
    await markActionRunning(this.root, actionId, agentId)
    await this.onRefresh().catch(() => undefined)

    const runDir = path.join(this.root, '.ggtree-air', 'agent-runs', actionId, 'files')
    const logPath = path.join(this.root, '.ggtree-air', 'agent-runs', actionId, 'agent.jsonl')
    await mkdir(runDir, { recursive: true })
    const skillPath = bundledSkillPath('ggtree-phylo')
    const prompt = actionPrompt({ root: this.root, action, runDir, agentId, skillPath })
    const invocation = adapter.invocation({
      root: this.root, action, runDir, prompt, skillPath, agentId,
    })
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd || this.root,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1', CLICOLOR: '0',
        GGTREE_AIR_ACTION_ID: action.id,
        GGTREE_AIR_WORKSPACE: this.root,
        GGTREE_AIR_OUTPUT_DIR: runDir,
        GGTREE_AIR_AGENT_ID: agentId,
        GGTREE_AIR_CLI_PATH: CLI_PATH,
        GGTREE_AIR_NODE: process.execPath,
      },
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(invocation.stdin ?? undefined)

    const record = { child, adapter: descriptor.id, completion: null }
    this.active.set(actionId, record)
    const buffers = { stdout: '', stderr: '' }
    let logQueue = Promise.resolve()
    const enqueueLog = (stream, text) => {
      const entry = `${JSON.stringify({
        time: new Date().toISOString(), adapter: descriptor.id, stream, text,
      })}\n`
      logQueue = logQueue.then(() => appendFile(logPath, entry)).catch(() => undefined)
    }
    const consumeLog = (stream, chunk) => {
      const text = chunk.toString('utf8')
      this.onLog?.(`[agent:${descriptor.id}:${action.id.slice(0, 8)}:${stream}] ${text}`)
      const lines = `${buffers[stream]}${text}`.split('\n')
      buffers[stream] = lines.pop() || ''
      for (const line of lines) if (line) enqueueLog(stream, `${line}\n`)
    }
    const flushLogs = async () => {
      for (const stream of ['stdout', 'stderr']) {
        if (buffers[stream]) enqueueLog(stream, buffers[stream])
        buffers[stream] = ''
      }
      await logQueue
    }
    child.stdout.on('data', (chunk) => consumeLog('stdout', chunk))
    child.stderr.on('data', (chunk) => consumeLog('stderr', chunk))
    record.completion = new Promise((resolve) => {
      child.once('error', async (error) => {
        await flushLogs()
        const latest = await getAction(this.root, actionId).catch(() => null)
        if (latest && !['completed', 'failed'].includes(latest.status)) {
          await failAction(this.root, actionId, `Agent process could not start: ${error.message}`, { agentId }).catch(() => undefined)
          await this.onRefresh().catch(() => undefined)
        }
        this.active.delete(actionId)
        resolve(null)
      })
      child.once('close', async (code, signal) => {
        await flushLogs()
        const latest = await getAction(this.root, actionId).catch(() => null)
        if (latest && !['completed', 'failed'].includes(latest.status)) {
          const reason = code === 0
            ? `${descriptor.label} exited without committing a verified output artifact`
            : `${descriptor.label} exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`
          await failAction(this.root, actionId, reason, { agentId }).catch(() => undefined)
        }
        await this.onRefresh().catch(() => undefined)
        this.active.delete(actionId)
        resolve(await getAction(this.root, actionId).catch(() => null))
      })
    })
    return await record.completion
    } finally {
      this.starting.delete(actionId)
    }
  }

  stopAll() {
    for (const { child } of this.active.values()) terminateProcess(child)
  }
}

function terminateProcess(child) {
  if (process.platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); return } catch { /* fall through */ }
  }
  try { child.kill('SIGTERM') } catch { /* process already exited */ }
}
