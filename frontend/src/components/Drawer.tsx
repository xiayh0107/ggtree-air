import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  Brush, Download, Maximize2, Minimize2, MousePointer2,
  Scan, X, MessageSquarePlus,
} from 'lucide-react'
import { apiFetch } from '../api'
import type { CanvasFlowNode } from '../graph'
import type { ActionRecord, Payload, SceneView, SelectionValue } from '../types'

export type DrawerRequest =
  | { kind: 'artifact'; node: CanvasFlowNode }
  | { kind: 'tree'; node: CanvasFlowNode; selecting?: boolean }
  | { kind: 'action'; action: ActionRecord }
  | { kind: 'workspace' }

export function Drawer({
  request, payload, fullscreen, onFullscreen, onClose, onTask, onSelection,
}: {
  request: DrawerRequest
  payload: Payload
  fullscreen: boolean
  onFullscreen: () => void
  onClose: () => void
  onTask: (nodeIds: string[]) => void
  onSelection: (nodeId: string, selection: SelectionValue) => void
}) {
  return (
    <>
      <div className={`drawer-backdrop ${fullscreen ? 'fullscreen' : ''}`} onClick={onClose} />
      <aside id="right-drawer" className={`right-drawer open ${fullscreen ? 'fullscreen' : ''}`} aria-label="结果与反馈">
        {request.kind === 'artifact' && <ArtifactDrawer request={request} fullscreen={fullscreen} onFullscreen={onFullscreen} onClose={onClose} onTask={onTask} />}
        {request.kind === 'tree' && <TreeDrawer request={request} payload={payload} fullscreen={fullscreen} onFullscreen={onFullscreen} onClose={onClose} onSelection={onSelection} />}
        {request.kind === 'action' && <ActionDrawer action={request.action} onClose={onClose} />}
        {request.kind === 'workspace' && <WorkspaceDrawer payload={payload} onClose={onClose} />}
      </aside>
    </>
  )
}

function DrawerHeader({ title, detail, icon, fullscreen, onFullscreen, onClose, actions }: {
  title: string; detail: string; icon?: ReactNode; fullscreen?: boolean
  onFullscreen?: () => void; onClose: () => void; actions?: ReactNode
}) {
  return (
    <header className="drawer-header">
      <span className="drawer-icon">{icon}</span>
      <div className="drawer-heading"><h2>{title}</h2><p>{detail}</p></div>
      <div className="drawer-header-actions">{actions}{onFullscreen && <button data-drawer-fullscreen title={fullscreen ? '退出产物面板全屏' : '产物面板全屏'} onClick={onFullscreen}>{fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>}<button data-close title="关闭" onClick={onClose}><X size={14} /></button></div>
    </header>
  )
}

function ArtifactDrawer({ request, fullscreen, onFullscreen, onClose, onTask }: {
  request: Extract<DrawerRequest, { kind: 'artifact' }>; fullscreen: boolean
  onFullscreen: () => void; onClose: () => void; onTask: (ids: string[]) => void
}) {
  const artifact = request.node.data.artifact!
  const image = Boolean(artifact.data_uri)
  return (
    <>
      <DrawerHeader
        title={artifact.label}
        detail={`${artifact.role === 'agent-output' ? 'Agent 产物' : '任务输入'} · ${formatBytes(artifact.bytes)} · ${artifact.md5.slice(0, 8)}`}
        icon={<FileIcon image={image} />}
        fullscreen={fullscreen}
        onFullscreen={onFullscreen}
        onClose={onClose}
        actions={<><button title="创建 Agent 任务" onClick={() => { onClose(); onTask([request.node.id]) }}><MessageSquarePlus size={14} /></button>{image && <a href={artifact.data_uri} download={artifact.label} title="下载"><Download size={14} /></a>}</>}
      />
      <div className={image ? 'drawer-canvas' : 'artifact-text-drawer'}>
        {image ? <div className="image-frame"><img src={artifact.data_uri} alt={artifact.label} /></div>
          : <pre className={artifact.media_type.includes('r-source') ? 'artifact-text-viewer code' : 'artifact-text-viewer'}>{artifact.text || '该类型暂不支持内联查看'}</pre>}
      </div>
    </>
  )
}

function TreeDrawer({ request, payload, fullscreen, onFullscreen, onClose, onSelection }: {
  request: Extract<DrawerRequest, { kind: 'tree' }>; payload: Payload; fullscreen: boolean
  onFullscreen: () => void; onClose: () => void
  onSelection: (nodeId: string, selection: SelectionValue) => void
}) {
  const [mode, setMode] = useState<'none' | 'select' | 'region' | 'draw'>(request.selecting ? 'select' : 'none')
  const [draft, setDraft] = useState<SelectionValue | null>(null)
  const draftRef = useRef<SelectionValue | null>(null)
  const [gesture, setGesture] = useState<Array<{ x: number; y: number }> | null>(null)
  const gestureRef = useRef<Array<{ x: number; y: number }> | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const updateDraft = (value: SelectionValue | null) => { draftRef.current = value; setDraft(value) }
  const updateGesture = (value: Array<{ x: number; y: number }> | null) => { gestureRef.current = value; setGesture(value) }
  const revision = payload.revisions.find((item) => item.revision === request.node.data.revision) || payload.revisions.at(-1)
  const view = revision?.scene.views.find((item) => item.layout === request.node.data.layout)
  const image = request.node.data.image
  const point = (event: { clientX: number; clientY: number }) => {
    const rect = frameRef.current!.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  const pointerDown = (event: ReactPointerEvent) => {
    if (mode !== 'region' && mode !== 'draw') return
    event.preventDefault()
    updateGesture([point(event)])
  }
  const pointerMove = (event: { clientX: number; clientY: number }) => {
    const points = gestureRef.current
    if (!points || (mode !== 'region' && mode !== 'draw')) return
    const current = point(event)
    updateGesture(mode === 'region' ? [points[0], current] : [...points, current].slice(-500))
  }
  const pointerUp = () => {
    const points = gestureRef.current
    if (!points || points.length < 2) return
    if (mode === 'region') {
      const [a, b] = points
      updateDraft({ kind: 'region', region: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) } })
    } else updateDraft({ kind: 'stroke', points })
    updateGesture(null)
  }
  useEffect(() => {
    if (mode !== 'region' && mode !== 'draw') return
    const move = (event: globalThis.PointerEvent) => pointerMove(event)
    const up = () => pointerUp()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [mode])
  const finish = () => {
    if (draftRef.current) onSelection(request.node.id, draftRef.current)
    onClose()
  }
  return (
    <>
      <DrawerHeader title={`${request.node.data.layout} · revision ${request.node.data.revision}`} detail={`${image?.path || 'tree'} · ${view?.artifact?.md5?.slice(0, 8) || '—'}`} icon={<FileIcon image />} fullscreen={fullscreen} onFullscreen={onFullscreen} onClose={onClose} />
      <div className="drawer-toolbar">
        <strong>{mode === 'none' ? '推荐成图' : '选择修改范围'}</strong><span />
        {mode === 'none' ? <button id="toggle-selection-mode" onClick={() => setMode('select')}><MousePointer2 size={13} />选择区域</button>
          : <><div className="annotation-tools">{(['select', 'region', 'draw'] as const).map((value) => <button key={value} data-annotation-mode={value} className={mode === value ? 'active' : ''} onClick={() => { setMode(value); updateDraft(null); updateGesture(null) }}>{value === 'select' ? <MousePointer2 size={13} /> : value === 'region' ? <Scan size={13} /> : <Brush size={13} />}{value === 'select' ? '点选' : value === 'region' ? '框选' : '画笔'}</button>)}</div><button id="finish-selection-mode" onClick={finish}>完成</button></>}
      </div>
      <div className="drawer-canvas">
        <div
          id="image-frame"
          ref={frameRef}
          className={`image-frame mode-${mode}`}
          onPointerDown={pointerDown}
          onPointerCancel={() => updateGesture(null)}
        >
          <img id="drawer-image" src={image?.data_uri} alt={request.node.data.title} />
          {mode === 'select' && <MarkerLayer view={view} onPick={updateDraft} draft={draft} />}
          {(gesture || draft?.kind === 'region' || draft?.kind === 'stroke') && <DrawingOverlay gesture={gesture} draft={draft} />}
        </div>
      </div>
    </>
  )
}

function MarkerLayer({ view, onPick, draft }: { view?: SceneView; onPick: (selection: SelectionValue) => void; draft: SelectionValue | null }) {
  return <div className="marker-layer">{(view?.nodes || []).map((node) => {
    const coordinate = node.artifact_coordinate
    if (!coordinate) return null
    const active = (draft?.kind === 'tip' || draft?.kind === 'clade') && draft.node === node.node
    return <button key={node.node} className={`scene-marker ${node.kind === 'internal' ? 'internal' : ''} ${active ? 'active' : ''}`} style={{ left: `${coordinate.x * 100}%`, top: `${coordinate.y * 100}%` }} onClick={() => onPick({ kind: node.kind === 'tip' ? 'tip' : 'clade', node: node.node, label: node.label })} aria-label={node.label || `node ${node.node}`} />
  })}</div>
}

function DrawingOverlay({ gesture, draft }: { gesture: Array<{ x: number; y: number }> | null; draft: SelectionValue | null }) {
  const points = gesture || (draft?.kind === 'stroke' ? draft.points : null)
  const regionPoints = gesture && gesture.length === 2 ? gesture : null
  const region = draft?.kind === 'region' ? draft.region : regionPoints ? { x: Math.min(regionPoints[0].x, regionPoints[1].x), y: Math.min(regionPoints[0].y, regionPoints[1].y), width: Math.abs(regionPoints[0].x - regionPoints[1].x), height: Math.abs(regionPoints[0].y - regionPoints[1].y) } : null
  return <svg className="drawing-layer" viewBox="0 0 1 1" preserveAspectRatio="none">{region && <rect x={region.x} y={region.y} width={region.width} height={region.height} />}{points && points.length > 1 && <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} />}</svg>
}

function ActionDrawer({ action, onClose }: { action: ActionRecord; onClose: () => void }) {
  const [activity, setActivity] = useState<Array<Record<string, unknown>>>([])
  useEffect(() => { void apiFetch<{ activity: Array<Record<string, unknown>> }>(`/api/actions/${action.id}/log`).then((value) => setActivity(value.activity || [])) }, [action.id])
  const title = action.origin?.kind === 'agent-session' ? 'Agent 会话发布' : '用户要求'
  return <><DrawerHeader title="Agent 运行过程" detail={`${action.claim?.agent_id || '等待 Agent'} · ${action.status}`} onClose={onClose} /><div className="info-drawer"><section><h3>{title}</h3><p>{action.instruction}</p></section><section><h3>过程</h3><ol className="process-list">{(action.events || []).map((event, index) => <li key={index}><time>{new Date(event.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>{event.message}</span></li>)}</ol></section><section><h3>详细工具日志</h3><div className="agent-run-log">{activity.map((entry, index) => <article key={index}><strong>{entry.kind === 'tool-call' ? `调用 ${String(entry.name)}` : entry.kind === 'tool-result' ? `${String(entry.name)} 返回` : '警告'}</strong>{entry.input != null && <pre>{JSON.stringify(entry.input, null, 2)}</pre>}{entry.text != null && <pre>{String(entry.text)}</pre>}</article>)}</div></section></div></>
}

function WorkspaceDrawer({ payload, onClose }: { payload: Payload; onClose: () => void }) {
  return <><DrawerHeader title="工作空间" detail="真实输入与 Agent 产物" onClose={onClose} /><div className="workspace-panel"><section><h3>当前任务</h3><div className="workspace-current"><strong>{payload.workspace.title}</strong><span>{payload.workspace_artifacts.length} 个输入 · {payload.actions.length} 次真实 Agent 运行</span></div></section><section><h3>输入资源</h3><div className="workspace-list">{payload.workspace_artifacts.length ? payload.workspace_artifacts.map((artifact) => <div key={artifact.id}><strong>{artifact.label}</strong><small>{artifact.role} · {artifact.media_type}</small></div>) : <p>尚未导入输入资源。</p>}</div></section></div></>
}

function FileIcon({ image }: { image: boolean }) { return image ? <Maximize2 size={14} /> : <FileTextIcon /> }
function FileTextIcon() { return <span aria-hidden>▤</span> }
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }
