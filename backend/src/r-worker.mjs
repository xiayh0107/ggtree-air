import { spawn } from 'node:child_process'
import { R_WORKER_PATH } from './paths.mjs'

function cancelledError() {
  return Object.assign(new Error('R worker cancelled'), { code: 'JOB_CANCELLED' })
}

export function callRWorker(method, params = {}, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000
  const rscript = process.env.GGTREE_AIR_RSCRIPT || 'Rscript'
  if (options.signal?.aborted) return Promise.reject(cancelledError())
  return new Promise((resolve, reject) => {
    const child = spawn(rscript, [R_WORKER_PATH], {
      cwd: options.cwd,
      env: { ...process.env, LANGUAGE: 'en', LC_ALL: process.env.LC_ALL || 'C.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let cancelled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => {
      cancelled = true
      child.kill('SIGTERM')
      setTimeout(() => { if (!settled) child.kill('SIGKILL') }, 2_000).unref()
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(reject, Object.assign(new Error(`R worker timed out after ${timeoutMs}ms`), {
        code: 'R_WORKER_TIMEOUT',
      }))
    }, timeoutMs)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      options.onLog?.(chunk)
    })
    child.on('error', (error) => {
      finish(reject, new Error(`Could not start R worker: ${error.message}`))
    })
    child.on('close', (code, signal) => {
      if (cancelled || options.signal?.aborted) {
        finish(reject, cancelledError())
        return
      }
      let response
      try {
        response = JSON.parse(stdout.trim())
      } catch {
        finish(reject, new Error(`R worker returned invalid JSON (exit ${code}, signal ${signal ?? 'none'}): ${stderr || stdout}`))
        return
      }
      if (code !== 0 || response.error || !response.result?.ok) {
        finish(reject, new Error(response.error?.message ?? response.result?.error?.message
          ?? `R worker failed with exit code ${code}: ${stderr}`))
        return
      }
      finish(resolve, { ...response.result, logs: stderr })
    })
    child.stdin.end(`${JSON.stringify({ jsonrpc: '2.0', id: options.id ?? 1, method, params })}\n`)
  })
}
