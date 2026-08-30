import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createWorkspaceBranch, listWorkspaceBranches, loadWorkspace, mergeWorkspaceBranch, readWorkspaceAnnotations, refreshWorkspacePresentation, rerunWorkspace, saveWorkspaceAnnotations, saveWorkspacePlan, switchWorkspaceBranch, workspaceSummary } from './workspace.mjs'
import { pathExists, readJson, safeWorkspacePath } from './paths.mjs'
import { JobManager } from './jobs.mjs'
import { LocalAgentRunner, readAgentRunActivity } from './agent-runner.mjs'
import { listAgentPresences } from './agent-presence.mjs'
import { evaluateScenePredicate, pageSceneObjects } from './scene-query.mjs'
import {
  claimAction, commitActionArtifacts, createAction, failAction, getAction,
  interruptStaleManagedActions, listActions, markActionRunning, updateActionProgress,
} from './actions.mjs'

const MAX_BODY_BYTES = 1024 * 1024

function contentType(target) {
  return new Map([
    ['.html', 'text/html; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'], ['.pdf', 'application/pdf'], ['.svg', 'image/svg+xml'], ['.txt', 'text/plain; charset=utf-8'],
    ['.tsv', 'text/tab-separated-values; charset=utf-8'],
  ]).get(path.extname(target).toLowerCase()) ?? 'application/octet-stream'
}

function jsonResponse(response, status, value) {
  const body = `${JSON.stringify(value)}\n`
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function tokenMatches(request, token) {
  const supplied = request.headers['x-ggtree-air-token']
  if (typeof supplied !== 'string') return false
  const expectedBuffer = Buffer.from(token)
  const suppliedBuffer = Buffer.from(supplied)
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer)
}

function requireMutationToken(request, token) {
  if (!tokenMatches(request, token)) {
    const error = new Error('Missing or invalid workspace mutation token')
    error.statusCode = 403
    throw error
  }
}

async function serveFile(response, target, token, injectToken = false) {
  let content = await readFile(target)
  if (injectToken) {
    content = Buffer.from(content.toString('utf8').replaceAll('__GGTREE_AIR_TOKEN_VALUE__', token))
  }
  response.writeHead(200, {
    'content-type': contentType(target),
    'content-length': content.length,
    'cache-control': injectToken ? 'no-store' : 'private, max-age=60',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self' data: blob:; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  })
  response.end(content)
}

export async function startWorkspaceServer({
  root, host = '127.0.0.1', port = 0, onLog = console.error,
  agentAdapter = process.env.GGTREE_AIR_AGENT || 'auto',
  agentCommand = null,
  piCommand = agentCommand || process.env.GGTREE_AIR_PI_COMMAND || 'pi',
  codexCommand = process.env.GGTREE_AIR_CODEX_COMMAND || 'codex',
  claudeCommand = process.env.GGTREE_AIR_CLAUDE_COMMAND || 'claude',
}) {
  const allowContainerBind = process.env.GGTREE_AIR_ALLOW_NON_LOOPBACK === '1'
  if (host !== '127.0.0.1' && !(allowContainerBind && host === '0.0.0.0')) {
    throw new Error('The workspace server must bind to 127.0.0.1 (container images may explicitly allow 0.0.0.0)')
  }
  root = path.resolve(root)
  await loadWorkspace(root)
  await interruptStaleManagedActions(root)
  await refreshWorkspacePresentation(root)
  const token = randomBytes(24).toString('base64url')
  const jobs = new JobManager()
  const agentRunner = new LocalAgentRunner({
    root, onLog,
    adapter: agentAdapter,
    piCommand,
    codexCommand,
    claudeCommand,
    onRefresh: () => refreshWorkspacePresentation(root),
  })
  let rerunActive = false
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`)
      if (request.method === 'GET' && url.pathname === '/api/health') {
        jsonResponse(response, 200, { ok: true, service: 'ggtree-air-node', version: '0.5.0' })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/workspace') {
        jsonResponse(response, 200, await workspaceSummary(root))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/agents') {
        const selected = await agentRunner.inspect()
        const externalAgents = await listAgentPresences(root)
        const externalById = new Map(externalAgents.map((agent) => [agent.id, agent]))
        const managedAgents = (await agentRunner.listAgents()).map((agent) => {
          const external = externalById.get(agent.id)
          if (external) externalById.delete(agent.id)
          return {
            ...agent,
            selected: agent.selected || (!selected.available && Boolean(external)),
            external_connected: Boolean(external),
            external_state: external?.state,
          }
        })
        const extraExternal = [...externalById.values()].map((agent) => ({
          id: agent.id, label: agent.id, transport: 'external', available: true,
          auth_status: 'external', detail: 'External Agent heartbeat', selected: !selected.available,
          external_connected: true, external_state: agent.state, active_actions: [],
        }))
        jsonResponse(response, 200, {
          selected_agent: selected.available ? selected.id : externalAgents[0]?.id || null,
          managed_agent: selected.available ? selected.id : null,
          external_agents: externalAgents,
          agents: [...managedAgents, ...extraExternal],
        })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/branches') {
        jsonResponse(response, 200, await listWorkspaceBranches(root))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/branches') {
        requireMutationToken(request, token)
        if (rerunActive) throw Object.assign(new Error('A workflow job is active'), { statusCode: 409 })
        const body = await readJsonBody(request)
        jsonResponse(response, 201, await createWorkspaceBranch(root, body.name, body.from_revision))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/branches/switch') {
        requireMutationToken(request, token)
        if (rerunActive) throw Object.assign(new Error('A workflow job is active'), { statusCode: 409 })
        const body = await readJsonBody(request)
        const workspace = await switchWorkspaceBranch(root, body.name)
        jsonResponse(response, 200, { ok: true, workspace: await workspaceSummary(root), revision: workspace.revision })
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/branches/merge') {
        requireMutationToken(request, token)
        if (rerunActive) throw Object.assign(new Error('A workflow job is active'), { statusCode: 409 })
        const body = await readJsonBody(request)
        rerunActive = true
        const job = jobs.create('merge', async ({ signal, progress, log }) => {
          try {
            const workspace = await mergeWorkspaceBranch(root, body.source, {
              strategy: body.strategy || 'auto', signal, progress,
              onLog: (chunk) => { onLog?.(chunk); log(chunk) },
            })
            return { workspace: await workspaceSummary(root), revision: workspace.revision }
          } finally {
            rerunActive = false
          }
        })
        jsonResponse(response, 202, { ok: true, job })
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/scene') {
        jsonResponse(response, 200, await readJson(path.join(root, 'scene.json')))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/objects') {
        const scene = await readJson(path.join(root, 'scene.json'))
        jsonResponse(response, 200, pageSceneObjects(scene, Object.fromEntries(url.searchParams)))
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/predicates/evaluate') {
        const scene = await readJson(path.join(root, 'scene.json'))
        jsonResponse(response, 200, evaluateScenePredicate(scene, await readJsonBody(request)))
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/actions') {
        jsonResponse(response, 200, {
          actions: await listActions(root, { status: url.searchParams.get('status') || undefined }),
        })
        return
      }
      const actionLogMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/log$/)
      if (request.method === 'GET' && actionLogMatch) {
        await getAction(root, actionLogMatch[1])
        jsonResponse(response, 200, { activity: await readAgentRunActivity(root, actionLogMatch[1]) })
        return
      }
      const actionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)(?:\/(claim|running|progress|preview|complete|fail))?$/)
      if (request.method === 'GET' && actionMatch && !actionMatch[2]) {
        jsonResponse(response, 200, await getAction(root, actionMatch[1]))
        return
      }
      if (request.method === 'GET' && actionMatch?.[2] === 'preview') {
        const action = await getAction(root, actionMatch[1])
        const relative = action.progress?.preview?.path
        if (!relative) {
          jsonResponse(response, 404, { error: { code: 'NOT_FOUND', message: 'Preview not available' } })
          return
        }
        await serveFile(response, safeWorkspacePath(root, relative), token, false)
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/actions') {
        requireMutationToken(request, token)
        const action = await createAction(root, await readJsonBody(request))
        await refreshWorkspacePresentation(root)
        jsonResponse(response, 201, action)
        setImmediate(() => { void agentRunner.start(action.id) })
        return
      }
      if (request.method === 'POST' && actionMatch?.[2] && actionMatch[2] !== 'preview') {
        requireMutationToken(request, token)
        const body = await readJsonBody(request)
        const action = actionMatch[2] === 'claim'
          ? await claimAction(root, actionMatch[1], body.agent_id)
          : actionMatch[2] === 'running'
            ? await markActionRunning(root, actionMatch[1], body.agent_id)
            : actionMatch[2] === 'progress'
              ? await updateActionProgress(root, actionMatch[1], {
                phase: body.phase, message: body.message, percent: body.percent,
                preview: body.preview, agentId: body.agent_id,
              })
            : actionMatch[2] === 'complete'
              ? await commitActionArtifacts(root, actionMatch[1], body.files, { agentId: body.agent_id })
              : await failAction(root, actionMatch[1], body.message, { agentId: body.agent_id })
        await refreshWorkspacePresentation(root)
        jsonResponse(response, 200, action)
        return
      }
      if (request.method === 'GET' && url.pathname === '/api/annotations') {
        jsonResponse(response, 200, await readWorkspaceAnnotations(root))
        return
      }
      if (request.method === 'PUT' && url.pathname === '/api/plan') {
        requireMutationToken(request, token)
        if (rerunActive) {
          const error = new Error('A rerun is active; plans are temporarily read-only')
          error.statusCode = 409
          throw error
        }
        jsonResponse(response, 200, await saveWorkspacePlan(root, await readJsonBody(request)))
        return
      }
      if (request.method === 'PUT' && url.pathname === '/api/annotations') {
        requireMutationToken(request, token)
        if (rerunActive) {
          const error = new Error('A rerun is active; feedback is temporarily read-only')
          error.statusCode = 409
          throw error
        }
        const value = await saveWorkspaceAnnotations(root, await readJsonBody(request))
        jsonResponse(response, 200, value)
        return
      }
      if (request.method === 'POST' && url.pathname === '/api/rerun') {
        requireMutationToken(request, token)
        if (rerunActive) {
          const error = new Error('A rerun is already active')
          error.statusCode = 409
          throw error
        }
        await readJsonBody(request)
        rerunActive = true
        const job = jobs.create('rerun', async ({ signal, progress, log }) => {
          try {
            const workspace = await rerunWorkspace(root, {
              signal,
              progress,
              onLog: (chunk) => { onLog?.(chunk); log(chunk) },
            })
            return { workspace: await workspaceSummary(root), revision: workspace.revision }
          } finally {
            rerunActive = false
          }
        })
        jsonResponse(response, 202, { ok: true, job })
        return
      }
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/)
      if (request.method === 'GET' && jobMatch) {
        const job = jobs.snapshot(jobMatch[1])
        if (!job) {
          jsonResponse(response, 404, { error: { code: 'NOT_FOUND', message: 'Job not found' } })
        } else jsonResponse(response, 200, job)
        return
      }
      if (request.method === 'DELETE' && jobMatch) {
        requireMutationToken(request, token)
        const job = jobs.cancel(jobMatch[1])
        if (!job) {
          jsonResponse(response, 404, { error: { code: 'NOT_FOUND', message: 'Job not found' } })
        } else jsonResponse(response, 202, job)
        return
      }
      const eventMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/)
      if (request.method === 'GET' && eventMatch) {
        const jobId = eventMatch[1]
        const after = Number(url.searchParams.get('after') || 0)
        const existing = jobs.events(jobId, Number.isFinite(after) ? after : 0)
        if (!existing) {
          jsonResponse(response, 404, { error: { code: 'NOT_FOUND', message: 'Job not found' } })
          return
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        const send = (event) => {
          response.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        }
        existing.forEach(send)
        const unsubscribe = jobs.subscribe(jobId, send)
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15_000)
        request.on('close', () => {
          clearInterval(heartbeat)
          unsubscribe?.()
        })
        return
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        jsonResponse(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } })
        return
      }
      const relative = url.pathname === '/' ? 'report.html' : decodeURIComponent(url.pathname.slice(1))
      if (!relative || relative.startsWith('.') || relative.includes('/') || relative.includes('\\')) {
        jsonResponse(response, 404, { error: { code: 'NOT_FOUND', message: 'Artifact not found' } })
        return
      }
      const target = safeWorkspacePath(root, relative)
      if (!await pathExists(target) || !(await stat(target)).isFile()) {
        jsonResponse(response, 404, { error: { code: 'NOT_FOUND', message: 'Artifact not found' } })
        return
      }
      if (request.method === 'HEAD') {
        const info = await stat(target)
        response.writeHead(200, { 'content-type': contentType(target), 'content-length': info.size })
        response.end()
        return
      }
      await serveFile(response, target, token, relative === 'report.html')
    } catch (error) {
      const status = Number(error.statusCode) || (error instanceof SyntaxError ? 400 : 500)
      onLog?.(`[server] ${error.stack || error.message}\n`)
      if (!response.headersSent) {
        jsonResponse(response, status, { error: { code: status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED', message: error.message } })
      } else response.destroy()
    }
  })
  server.on('close', () => agentRunner.stopAll())
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  const address = server.address()
  return {
    server,
    token,
    host,
    port: typeof address === 'object' ? address.port : port,
    url: `http://${host}:${typeof address === 'object' ? address.port : port}`,
    agentAdapter,
  }
}
