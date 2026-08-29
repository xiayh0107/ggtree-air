import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  claimAction, failAction, getAction, markActionRunning,
} from './actions.mjs'
import { bundledSkillPath } from './skill-manager.mjs'

const CLI_PATH = fileURLToPath(new URL('../bin/ggtree-air.mjs', import.meta.url))

async function executableOnPath(name) {
  if (name.includes(path.sep)) {
    return access(name, fsConstants.X_OK).then(() => name, () => null)
  }
  for (const directory of String(process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue
    const candidate = path.join(directory, name)
    if (await access(candidate, fsConstants.X_OK).then(() => true, () => false)) return candidate
  }
  return null
}

export async function readAgentRunActivity(root, actionId) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(actionId)) throw new Error('Invalid Action id')
  const target = path.join(path.resolve(root), '.ggtree-air', 'agent-runs', actionId, 'agent.jsonl')
  const content = await readFile(target, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return ''
    throw error
  })
  const activity = []
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
      if (event.type === 'tool_execution_start') {
        activity.push({ time: wrapper.time, kind: 'tool-call', name: event.toolName, input: event.args || {} })
      } else if (event.type === 'tool_execution_end') {
        const text = event.result?.content?.map((item) => item.text || '').join('\n') || ''
        activity.push({
          time: wrapper.time, kind: 'tool-result', name: event.toolName,
          error: Boolean(event.result?.isError), text: text.slice(0, 3000),
        })
      }
    }
  }
  return activity.slice(-200)
}

function actionPrompt({ root, action, runDir, agentId }) {
  const cli = `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_PATH)}`
  return `You are the real external Agent executing a user-created ggtree-air Action.

Workspace: ${root}
Action id: ${action.id}
Run output directory: ${runDir}

This Action has already been claimed and marked running by the local Agent transport. Read the complete Action record with:
${cli} actions show ${action.id} --workspace ${JSON.stringify(root)}

Required protocol:
1. Inspect every item in action.sources. Resolve relative artifact paths against the workspace root. Distinguish target/reference figures from user tree, metadata, and previous outputs.
2. Read and follow the loaded ggtree-phylo Skill. Work on the user's concrete request; do not substitute a generic Recipe and do not copy a reference image as the answer.
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
    root, adapter = process.env.GGTREE_AIR_AGENT || 'auto',
    piCommand = process.env.GGTREE_AIR_PI_COMMAND || 'pi',
    onLog = console.error, onRefresh,
  }) {
    this.root = path.resolve(root)
    this.adapter = adapter
    this.piCommand = piCommand
    this.onLog = onLog
    this.onRefresh = onRefresh || (async () => undefined)
    this.active = new Map()
    this.descriptor = null
  }

  async inspect() {
    if (this.descriptor) return this.descriptor
    if (this.adapter === 'none') {
      this.descriptor = { id: 'none', available: false, detail: 'Managed Agent execution is disabled' }
      return this.descriptor
    }
    const requested = this.adapter === 'auto' ? ['pi'] : [this.adapter]
    for (const id of requested) {
      if (id !== 'pi') continue
      const binaryPath = await executableOnPath(this.piCommand)
      if (binaryPath) {
        this.descriptor = { id: 'pi', available: true, binaryPath, detail: 'Local Pi CLI' }
        return this.descriptor
      }
    }
    this.descriptor = { id: this.adapter, available: false, detail: `Agent adapter is unavailable: ${this.adapter}` }
    return this.descriptor
  }

  activeActionIds() {
    return [...this.active.keys()]
  }

  async start(actionId) {
    if (this.active.has(actionId)) return this.active.get(actionId).completion
    const descriptor = await this.inspect()
    if (!descriptor.available) return null
    const action = await getAction(this.root, actionId)
    if (action.status !== 'pending') return null
    const agentId = `managed:${descriptor.id}`
    await claimAction(this.root, actionId, agentId)
    await markActionRunning(this.root, actionId, agentId)
    await this.onRefresh().catch(() => undefined)

    const runDir = path.join(this.root, '.ggtree-air', 'agent-runs', actionId, 'files')
    const logPath = path.join(this.root, '.ggtree-air', 'agent-runs', actionId, 'agent.jsonl')
    await mkdir(runDir, { recursive: true })
    const prompt = actionPrompt({ root: this.root, action, runDir, agentId })
    const args = [
      '--mode', 'json', '--print', '--approve', '--no-context-files',
      '--no-extensions', '--no-prompt-templates', '--no-skills',
      '--skill', bundledSkillPath('ggtree-phylo'),
      '--tools', 'read,bash,edit,write',
      '--no-session',
      '--name', `ggtree-air ${action.id.slice(0, 8)}`,
      '--', prompt,
    ]
    const child = spawn(descriptor.binaryPath, args, {
      cwd: this.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GGTREE_AIR_ACTION_ID: action.id,
        GGTREE_AIR_WORKSPACE: this.root,
        GGTREE_AIR_OUTPUT_DIR: runDir,
        GGTREE_AIR_AGENT_ID: agentId,
        GGTREE_AIR_CLI_PATH: CLI_PATH,
        GGTREE_AIR_NODE: process.execPath,
      },
    })
    const record = { child, completion: null }
    this.active.set(actionId, record)
    const buffers = { stdout: '', stderr: '' }
    let logQueue = Promise.resolve()
    const enqueueLog = (stream, text) => {
      const entry = `${JSON.stringify({ time: new Date().toISOString(), stream, text })}\n`
      logQueue = logQueue.then(() => appendFile(logPath, entry)).catch(() => undefined)
    }
    const consumeLog = (stream, chunk) => {
      const text = chunk.toString('utf8')
      this.onLog?.(`[agent:${action.id.slice(0, 8)}:${stream}] ${text}`)
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
            ? 'Agent exited without committing a verified output artifact'
            : `Agent exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`
          await failAction(this.root, actionId, reason, { agentId }).catch(() => undefined)
        }
        await this.onRefresh().catch(() => undefined)
        this.active.delete(actionId)
        resolve(await getAction(this.root, actionId).catch(() => null))
      })
    })
    return record.completion
  }

  stopAll() {
    for (const { child } of this.active.values()) child.kill('SIGTERM')
  }
}
