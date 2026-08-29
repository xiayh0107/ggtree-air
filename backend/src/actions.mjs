import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  artifactRecord, atomicWriteJson, isoNow, md5File, pathExists, readJson,
} from './paths.mjs'
import { normalizeAnnotationEnvelope } from './contracts.mjs'

const ACTION_SCHEMA = '1.0.0'

function actionsDir(root) {
  return path.join(root, '.ggtree-air', 'actions')
}

function actionPath(root, id) {
  return path.join(actionsDir(root), `${id}.json`)
}

function workspaceAssetsPath(root) {
  return path.join(root, '.ggtree-air', 'workspace-artifacts.json')
}

export async function listWorkspaceArtifacts(root) {
  const target = workspaceAssetsPath(path.resolve(root))
  return await pathExists(target) ? readJson(target) : []
}

export async function importWorkspaceArtifact(root, file, {
  label, role = 'reference', mediaType, metadata = {},
} = {}) {
  root = path.resolve(root)
  const source = path.resolve(file)
  const info = await stat(source).catch(() => null)
  if (!info?.isFile()) throw new Error(`Workspace artifact does not exist: ${source}`)
  const id = randomUUID()
  const directory = path.join(root, '.ggtree-air', 'workspace-artifacts')
  await mkdir(directory, { recursive: true })
  const destination = path.join(directory, `${id}-${path.basename(source)}`)
  await copyFile(source, destination)
  const record = await artifactRecord(destination, root, role)
  const artifact = {
    id,
    label: String(label || path.basename(source)),
    ...record,
    media_type: mediaType || record.media_type,
    metadata,
    created: isoNow(),
  }
  const assets = await listWorkspaceArtifacts(root)
  assets.push(artifact)
  await atomicWriteJson(workspaceAssetsPath(root), assets)
  await touchActivity(root)
  return artifact
}

async function rawWorkspace(root) {
  return readJson(path.join(root, 'workspace.json'))
}

async function touchActivity(root) {
  const target = path.join(root, 'workspace.json')
  const workspace = await readJson(target)
  workspace.activity_revision = Number(workspace.activity_revision || 0) + 1
  workspace.updated = isoNow()
  await atomicWriteJson(target, workspace)
  return workspace.activity_revision
}

async function revisionSource(root, source) {
  const workspace = await rawWorkspace(root)
  const revision = Number(source.revision)
  const directory = revision === workspace.revision
    ? root
    : path.join(root, '.ggtree-air', 'revisions', `r${String(revision).padStart(4, '0')}`)
  const scenePath = path.join(directory, 'scene.json')
  if (!await pathExists(scenePath)) throw new Error(`Revision ${revision} artifacts are unavailable`)
  const scene = await readJson(scenePath)
  const view = scene.views.find((candidate) => candidate.layout === source.layout)
  if (!view) throw new Error(`Layout ${source.layout} is unavailable in revision ${revision}`)
  return {
    kind: 'revision-view',
    revision,
    layout: view.layout,
    scene_id: scene.scene_id,
    view_id: view.id,
    artifact: {
      path: path.relative(root, path.join(directory, view.artifact.path)),
      md5: view.artifact.md5,
      media_type: 'image/png',
    },
    scene,
    view,
  }
}

async function workspaceArtifactSource(root, source) {
  const artifact = (await listWorkspaceArtifacts(root))
    .find((candidate) => candidate.id === source.artifact_id)
  if (!artifact) throw new Error(`Unknown workspace artifact: ${source.artifact_id}`)
  return { kind: 'workspace-artifact', artifact }
}

async function externalArtifactSource(root, source) {
  const actions = await listActions(root)
  for (const action of actions) {
    const artifact = (action.outputs || []).find((candidate) => candidate.id === source.artifact_id)
    if (artifact) return { kind: 'action-artifact', artifact }
  }
  throw new Error(`Unknown action artifact: ${source.artifact_id}`)
}

function normalizedFreeSelection(selection) {
  if (!selection) return null
  if (selection.kind === 'view') {
    const x = Number(selection.point?.x); const y = Number(selection.point?.y)
    if (![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new Error('view selection must be normalized')
    }
    return { kind: 'view', point: { x, y } }
  }
  if (selection.kind === 'region') {
    const region = Object.fromEntries(['x', 'y', 'width', 'height']
      .map((key) => [key, Number(selection.region?.[key])]))
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite)
        || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
        || region.x + region.width > 1 || region.y + region.height > 1) {
      throw new Error('region selection must be a normalized rectangle')
    }
    return { kind: 'region', region }
  }
  if (selection.kind === 'stroke') {
    if (!Array.isArray(selection.points) || selection.points.length < 2 || selection.points.length > 500) {
      throw new Error('stroke selection needs 2..500 points')
    }
    const points = selection.points.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
      throw new Error('stroke points must be normalized')
    }
    return { kind: 'stroke', points }
  }
  throw new Error('This artifact does not expose semantic tip/clade selection')
}

export async function createAction(root, input) {
  root = path.resolve(root)
  const instruction = String(input?.instruction || '').trim()
  if (!instruction) throw new Error('Action instruction must be non-empty')
  if (instruction.length > 8000) throw new Error('Action instruction is too long')
  const requestedSources = Array.isArray(input?.sources) && input.sources.length
    ? input.sources : input?.source ? [input.source] : []
  if (!requestedSources.length) throw new Error('At least one Action source is required')
  if (requestedSources.length > 20) throw new Error('An Action may reference at most 20 sources')

  let selection = input.selection || null
  const sources = []
  let semanticSelectionValidated = false
  for (const requested of requestedSources) {
    if (requested.kind === 'revision-view') {
      const source = await revisionSource(root, requested)
      if (selection && !semanticSelectionValidated) {
        const envelope = {
          schema_version: '1.0.0', scene_id: source.scene.scene_id,
          created: isoNow(), updated: isoNow(), annotations: [{
            id: 'selection', created: isoNow(), artifact_hash: source.view.artifact.md5,
            view_id: source.view.id, selector: selection, intent: 'other', instruction,
          }],
        }
        selection = normalizeAnnotationEnvelope(envelope, source.scene).annotations[0].selector
        semanticSelectionValidated = true
      }
      delete source.scene
      delete source.view
      sources.push(source)
    } else if (requested.kind === 'action-artifact') {
      sources.push(await externalArtifactSource(root, requested))
    } else if (requested.kind === 'workspace-artifact') {
      sources.push(await workspaceArtifactSource(root, requested))
    } else throw new Error(`Unsupported Action source kind: ${requested.kind}`)
  }
  if (selection && !semanticSelectionValidated) selection = normalizedFreeSelection(selection)
  const source = sources[0]

  const now = isoNow()
  const action = {
    schema_version: ACTION_SCHEMA,
    id: randomUUID(),
    workspace_id: (await rawWorkspace(root)).id,
    branch: (await rawWorkspace(root)).current_branch || 'main',
    source,
    sources,
    instruction,
    selection,
    status: 'pending',
    created: now,
    updated: now,
    claim: null,
    outputs: [],
    progress: { phase: 'queued', message: '等待 Agent 运行', percent: 0, updated: now, preview: null },
    events: [{ time: now, type: 'created', message: '用户提交了修改要求' }],
    error: null,
  }
  await mkdir(actionsDir(root), { recursive: true })
  await atomicWriteJson(actionPath(root, action.id), action)
  await touchActivity(root)
  return action
}

export async function listActions(root, { status } = {}) {
  root = path.resolve(root)
  await mkdir(actionsDir(root), { recursive: true })
  const names = (await readdir(actionsDir(root))).filter((name) => name.endsWith('.json')).sort()
  const actions = await Promise.all(names.map((name) => readJson(path.join(actionsDir(root), name))))
  return actions.filter((action) => !status || action.status === status)
    .sort((a, b) => a.created.localeCompare(b.created))
}

export async function interruptStaleManagedActions(root) {
  root = path.resolve(root)
  const actions = await listActions(root)
  const interrupted = []
  for (const action of actions) {
    if (!['claimed', 'running'].includes(action.status)
        || !String(action.claim?.agent_id || '').startsWith('managed:')) continue
    action.status = 'failed'
    action.error = { message: 'Managed Agent process was interrupted before committing output' }
    action.progress = {
      ...(action.progress || {}), phase: 'interrupted', message: action.error.message,
      updated: isoNow(),
    }
    action.events = [...(action.events || []), {
      time: isoNow(), type: 'interrupted', message: action.error.message,
    }].slice(-50)
    action.finished = isoNow()
    action.updated = isoNow()
    await atomicWriteJson(actionPath(root, action.id), action)
    interrupted.push(action)
  }
  if (interrupted.length) await touchActivity(root)
  return interrupted
}

export async function waitForAction(root, {
  timeoutMs = 60 * 60 * 1000, agentId = null, claim = true, signal = null,
} = {}) {
  root = path.resolve(root)
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (signal?.aborted) throw Object.assign(new Error('Action wait cancelled'), { code: 'WAIT_CANCELLED' })
    const pending = (await listActions(root, { status: 'pending' }))[0]
    if (pending) {
      if (!claim) return pending
      try { return await claimAction(root, pending.id, agentId || 'external-agent') }
      catch { /* another Agent won the claim; continue waiting */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return null
}

export async function getAction(root, id) {
  const target = actionPath(path.resolve(root), id)
  if (!await pathExists(target)) throw new Error(`Action not found: ${id}`)
  return readJson(target)
}

export async function claimAction(root, id, agentId) {
  root = path.resolve(root)
  const action = await getAction(root, id)
  if (action.status !== 'pending') throw new Error(`Action is ${action.status}, not pending`)
  action.status = 'claimed'
  action.claim = { agent_id: String(agentId || 'external-agent'), claimed: isoNow() }
  action.progress = { ...(action.progress || {}), phase: 'claimed', message: `${action.claim.agent_id} 已接收任务`, percent: 2, updated: isoNow() }
  action.events = [...(action.events || []), { time: isoNow(), type: 'claimed', message: action.progress.message }].slice(-50)
  action.updated = isoNow()
  await atomicWriteJson(actionPath(root, id), action)
  await touchActivity(root)
  return action
}

function assertClaimOwner(action, agentId) {
  if (action.claim?.agent_id && String(agentId || '') !== action.claim.agent_id) {
    throw new Error(`Action is claimed by ${action.claim.agent_id}`)
  }
}

export async function markActionRunning(root, id, agentId) {
  root = path.resolve(root)
  const action = await getAction(root, id)
  assertClaimOwner(action, agentId)
  if (!['pending', 'claimed'].includes(action.status)) throw new Error(`Action cannot run from ${action.status}`)
  action.status = 'running'
  action.claim ||= { agent_id: String(agentId || 'external-agent'), claimed: isoNow() }
  action.progress = { ...(action.progress || {}), phase: 'running', message: 'Agent 正在读取源产物', percent: Math.max(5, Number(action.progress?.percent || 0)), updated: isoNow() }
  action.events = [...(action.events || []), { time: isoNow(), type: 'running', message: action.progress.message }].slice(-50)
  action.started = isoNow()
  action.updated = isoNow()
  await atomicWriteJson(actionPath(root, id), action)
  await touchActivity(root)
  return action
}

export async function updateActionProgress(root, id, {
  phase = 'running', message, percent, preview, agentId,
} = {}) {
  root = path.resolve(root)
  const action = await getAction(root, id)
  assertClaimOwner(action, agentId)
  if (!['pending', 'claimed', 'running'].includes(action.status)) {
    throw new Error(`Action cannot report progress from ${action.status}`)
  }
  action.status = 'running'
  action.claim ||= { agent_id: String(agentId || 'external-agent'), claimed: isoNow() }
  let previewRecord = action.progress?.preview || null
  if (preview) {
    const source = path.resolve(preview)
    const info = await stat(source).catch(() => null)
    if (!info?.isFile()) throw new Error(`Preview file does not exist: ${source}`)
    const previewDir = path.join(root, '.ggtree-air', 'action-previews')
    await mkdir(previewDir, { recursive: true })
    const extension = path.extname(source) || '.png'
    const destination = path.join(previewDir, `${id}${extension}`)
    await copyFile(source, destination)
    previewRecord = await artifactRecord(destination, root, 'agent-preview')
  }
  const numericPercent = percent == null ? Number(action.progress?.percent || 0)
    : Math.max(0, Math.min(99, Number(percent)))
  action.progress = {
    phase: String(phase),
    message: String(message || action.progress?.message || 'Agent 正在处理'),
    percent: Number.isFinite(numericPercent) ? numericPercent : 0,
    updated: isoNow(),
    preview: previewRecord,
  }
  action.events = [...(action.events || []), {
    time: isoNow(), type: 'progress', phase: action.progress.phase,
    message: action.progress.message, percent: action.progress.percent,
  }].slice(-50)
  action.updated = isoNow()
  await atomicWriteJson(actionPath(root, id), action)
  await touchActivity(root)
  return action
}

export async function failAction(root, id, message, { agentId } = {}) {
  root = path.resolve(root)
  const action = await getAction(root, id)
  assertClaimOwner(action, agentId)
  action.status = 'failed'
  action.error = { message: String(message || 'Agent failed to complete the action') }
  action.progress = { ...(action.progress || {}), phase: 'failed', message: action.error.message, updated: isoNow() }
  action.events = [...(action.events || []), { time: isoNow(), type: 'failed', message: action.error.message }].slice(-50)
  action.finished = isoNow()
  action.updated = isoNow()
  await atomicWriteJson(actionPath(root, id), action)
  await touchActivity(root)
  return action
}

export async function commitActionArtifacts(root, id, files, { agentId } = {}) {
  root = path.resolve(root)
  if (!Array.isArray(files) || files.length === 0) throw new Error('At least one output file is required')
  const action = await getAction(root, id)
  assertClaimOwner(action, agentId)
  if (action.status === 'completed') throw new Error('Action is already completed')
  if (['failed', 'cancelled'].includes(action.status)) throw new Error(`Action cannot commit from ${action.status}`)
  const sourceHashes = new Set((action.sources || [action.source])
    .map((source) => source?.artifact?.md5).filter(Boolean))
  const outputDir = path.join(root, '.ggtree-air', 'action-artifacts', id)
  await mkdir(outputDir, { recursive: true })
  const outputs = []
  for (const entry of files) {
    const source = path.resolve(typeof entry === 'string' ? entry : entry.path)
    const info = await stat(source).catch(() => null)
    if (!info?.isFile()) throw new Error(`Output file does not exist: ${source}`)
    if (info.size === 0) throw new Error(`Output file is empty: ${source}`)
    const sourceHash = await md5File(source)
    if (sourceHashes.has(sourceHash)) {
      throw new Error('Output is byte-identical to an Action source; copied inputs cannot be committed as Agent work')
    }
    const artifactId = randomUUID()
    const destination = path.join(outputDir, `${artifactId}-${path.basename(source)}`)
    await copyFile(source, destination)
    const record = await artifactRecord(destination, root, 'agent-output')
    outputs.push({
      id: artifactId,
      action_id: id,
      label: typeof entry === 'object' && entry.label ? String(entry.label) : path.basename(source),
      ...record,
      created: isoNow(),
    })
  }
  action.status = 'completed'
  action.outputs = outputs
  action.progress = { ...(action.progress || {}), phase: 'completed', message: `已生成 ${outputs.length} 个产物`, percent: 100, updated: isoNow() }
  action.events = [...(action.events || []), { time: isoNow(), type: 'completed', message: action.progress.message }].slice(-50)
  action.claim ||= { agent_id: String(agentId || 'external-agent'), claimed: isoNow() }
  action.finished = isoNow()
  action.updated = isoNow()
  action.error = null
  await atomicWriteJson(actionPath(root, id), action)
  await touchActivity(root)
  return action
}
