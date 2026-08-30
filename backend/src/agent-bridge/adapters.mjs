import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const PROBE_TIMEOUT_MS = 5_000
const MAX_PROBE_BYTES = 256 * 1024

export async function executableOnPath(name) {
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

async function runProbe(command, args) {
  const binaryPath = await executableOnPath(command)
  if (!binaryPath) return { found: false, code: null, output: '', binaryPath: null }
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', CLICOLOR: '0' },
    })
    const append = (chunk) => { output = `${output}${chunk.toString('utf8')}`.slice(-MAX_PROBE_BYTES) }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    child.once('error', () => finish({ found: false, code: null, output, binaryPath }))
    child.once('close', (code) => finish({ found: true, code, output: output.trim(), binaryPath }))
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ found: true, code: null, output: 'probe timed out', binaryPath })
    }, PROBE_TIMEOUT_MS)
  })
}

function lastLine(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1)
}

function baseDescriptor(adapter, version) {
  return {
    id: adapter.id,
    label: adapter.label,
    transport: adapter.id,
    available: Boolean(version.found && version.code === 0),
    binaryPath: version.binaryPath,
    version: version.code === 0 ? lastLine(version.output) : undefined,
    auth_status: 'unknown',
    detail: version.found ? version.output || adapter.label : `${adapter.label} is not installed`,
  }
}

export function createPiAdapter({ command = 'pi' } = {}) {
  return {
    id: 'pi', label: 'Pi', command,
    async probe() {
      const version = await runProbe(command, ['--version'])
      if (!version.found || version.code !== 0) return baseDescriptor(this, version)
      const settingsPath = path.join(
        process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent'),
        'settings.json',
      )
      const settings = await readFile(settingsPath, 'utf8').then((text) => {
        try { return JSON.parse(text) } catch { return null }
      }, () => null)
      const authArgs = ['auth', 'check', '--json', '--no-refresh']
      if (settings?.defaultProvider) authArgs.push('--provider', String(settings.defaultProvider))
      if (settings?.defaultModel) authArgs.push('--model', String(settings.defaultModel))
      const auth = settings?.defaultProvider || settings?.defaultModel
        ? await runProbe(command, authArgs) : null
      let authenticated = null
      if (auth) {
        try { authenticated = JSON.parse(auth.output).status === 'ready' } catch {
          authenticated = auth.code === 0 && /ready|authenticated/iu.test(auth.output)
        }
      }
      return {
        ...baseDescriptor(this, version),
        available: authenticated !== false,
        auth_status: authenticated === true ? 'authenticated' : authenticated === false ? 'unauthenticated' : 'unknown',
        detail: authenticated === false ? auth.output || 'Pi is not authenticated' : 'Local Pi CLI',
      }
    },
    invocation({ prompt, skillPath, action }) {
      return {
        command,
        args: [
          '--mode', 'json', '--print', '--approve', '--no-context-files',
          '--no-extensions', '--no-prompt-templates', '--no-skills',
          '--skill', skillPath,
          '--tools', 'read,bash,edit,write', '--no-session',
          '--name', `ggtree-air ${action.id.slice(0, 8)}`, '--', prompt,
        ],
        stdin: null,
      }
    },
  }
}

export function createCodexAdapter({ command = 'codex' } = {}) {
  return {
    id: 'codex', label: 'Codex', command,
    async probe() {
      const version = await runProbe(command, ['--version'])
      if (!version.found || version.code !== 0) return baseDescriptor(this, version)
      const [auth, help] = await Promise.all([
        runProbe(command, ['login', 'status']),
        runProbe(command, ['exec', '--help']),
      ])
      const compatible = help.code === 0
        && ['--json', '--sandbox', '--cd', '--add-dir'].every((flag) => help.output.includes(flag))
      const authenticated = auth.code === 0 && /logged in|authenticated/iu.test(auth.output)
      return {
        ...baseDescriptor(this, version),
        available: compatible && auth.code === 0,
        auth_status: authenticated ? 'authenticated' : auth.code === 0 ? 'unknown' : 'unauthenticated',
        detail: !compatible ? 'Codex CLI is missing required exec flags'
          : auth.code !== 0 ? auth.output || 'Codex is not authenticated' : 'Local Codex CLI',
      }
    },
    invocation({ root, runDir, prompt }) {
      return {
        command,
        args: [
          'exec', '--json', '--color', 'never', '--sandbox', 'workspace-write',
          '--skip-git-repo-check', '-C', root, '--add-dir', runDir, '-',
        ],
        stdin: prompt,
      }
    },
  }
}

export function createClaudeAdapter({ command = 'claude' } = {}) {
  return {
    id: 'claude', label: 'Claude Code', command,
    async probe() {
      const version = await runProbe(command, ['--version'])
      if (!version.found || version.code !== 0) return baseDescriptor(this, version)
      const [auth, help] = await Promise.all([
        runProbe(command, ['auth', 'status']),
        runProbe(command, ['--help']),
      ])
      const compatible = help.code === 0
        && ['--print', '--output-format', '--permission-mode'].every((flag) => help.output.includes(flag))
      let authenticated = false
      try { authenticated = Boolean(JSON.parse(auth.output).loggedIn) } catch {
        authenticated = auth.code === 0 && /logged.?in|authenticated/iu.test(auth.output)
      }
      return {
        ...baseDescriptor(this, version),
        available: compatible && auth.code === 0 && authenticated,
        auth_status: authenticated ? 'authenticated' : 'unauthenticated',
        detail: !compatible ? 'Claude Code is missing required print/stream flags'
          : !authenticated ? auth.output || 'Claude Code is not authenticated' : 'Local Claude Code CLI',
      }
    },
    invocation({ prompt, action }) {
      return {
        command,
        args: [
          '--print', '--output-format', 'stream-json', '--verbose',
          '--no-session-persistence', '--dangerously-skip-permissions',
          '--allowedTools', 'Read,Bash,Edit,Write',
          '--name', `ggtree-air ${action.id.slice(0, 8)}`, '--', prompt,
        ],
        stdin: null,
      }
    },
  }
}
