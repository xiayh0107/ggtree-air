import { createContext, useContext, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Code2, File, FileText, Image, Maximize2, MessageSquarePlus,
  Network, Table2, ExternalLink, Minimize2,
} from 'lucide-react'
import type { CanvasFlowNode } from '../graph'
import type { ActionRecord, Artifact, CanvasNodeData } from '../types'

interface CanvasNodeRef { id: string; data: CanvasNodeData }

interface CanvasCallbacks {
  hasActions: boolean
  onOpen: (node: CanvasNodeRef) => void
  onTask: (nodeIds: string[]) => void
  onFullscreen: (node: CanvasNodeRef) => void
  onRun: (action: ActionRecord) => void
}

const CallbackContext = createContext<CanvasCallbacks | null>(null)

export function CanvasNodeCallbacks({ value, children }: { value: CanvasCallbacks; children: ReactNode }) {
  return <CallbackContext.Provider value={value}>{children}</CallbackContext.Provider>
}

export function CanvasNode(props: NodeProps<CanvasFlowNode>) {
  const callbacks = useContext(CallbackContext)!
  return <NodeShell node={{ id: props.id, data: props.data }} selected={props.selected} callbacks={callbacks} />
}

export function FullscreenNode({ node, onExit }: { node: CanvasFlowNode; onExit: () => void }) {
  const callbacks = useContext(CallbackContext)!
  return (
    <div className="node-fullscreen-backdrop" role="dialog" aria-modal="true" aria-label={`${node.data.title}全屏`}>
      <NodeShell node={{ id: node.id, data: node.data }} selected fullscreen callbacks={callbacks} onExit={onExit} />
    </div>
  )
}

function NodeShell({
  node, selected, fullscreen = false, callbacks, onExit,
}: {
  node: CanvasNodeRef
  selected: boolean
  fullscreen?: boolean
  callbacks: CanvasCallbacks
  onExit?: () => void
}) {
  const { data } = node
  const artifact = data.artifact
  const action = data.action
  const canTask = data.kind === 'artifact' || data.kind === 'tree'
  const active = action && ['pending', 'claimed', 'running'].includes(action.status)
  const failed = action?.status === 'failed'
  const inputArtifact = artifact && ['reference', 'paper-reference', 'user-input'].includes(artifact.role)
  const showStart = inputArtifact && !callbacks.hasActions
  const Icon = iconForData(data)
  const status = statusForData(data)
  const statusTone = failed ? 'danger' : active ? 'active'
    : artifact && artifact.role !== 'agent-output' ? 'neutral' : 'success'

  return (
    <article
      data-node-id={node.id}
      className={`canvas-node ${selected ? 'selected' : ''} ${fullscreen ? 'node-maximized' : ''} ${data.kind}-node`}
    >
      {!fullscreen && <Handle type="target" position={Position.Left} className="node-handle" />}
      <header className="node-header">
        <Icon size={14} strokeWidth={1.8} />
        <span className="node-title">{data.kind === 'action' ? 'Agent 任务' : data.title}</span>
      </header>
      <div className="node-actions nodrag" role="group" aria-label={`${data.title}节点操作`}>
        {canTask && (
          <button data-edit-node title="创建 Agent 任务" aria-label="创建 Agent 任务" onClick={() => callbacks.onTask([node.id])}>
            <MessageSquarePlus size={13} />
          </button>
        )}
        <button
          data-fullscreen-node
          title={fullscreen ? '退出节点全屏' : '节点全屏'}
          aria-label={fullscreen ? '退出节点全屏' : '节点全屏'}
          onClick={fullscreen ? onExit : () => callbacks.onFullscreen(node)}
        >
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button data-open-node title="打开" aria-label="打开" onClick={() => callbacks.onOpen(node)}>
          <ExternalLink size={13} />
        </button>
      </div>
      <div className={`node-body ${artifact?.data_uri || data.kind === 'tree' ? 'no-inset' : ''}`}>
        <NodeBody data={data} fullscreen={fullscreen} />
      </div>
      <footer className="node-footer nodrag">
        <span className={`activity-state ${statusTone}`}><b>{active ? '◌' : failed ? '!' : inputArtifact ? '•' : '✓'}</b>{status}</span>
        {action && <button data-open-run onClick={() => callbacks.onRun(action)}>查看过程</button>}
        {artifact?.action_id && data.parentAction && <button data-open-parent-run onClick={() => callbacks.onRun(data.parentAction!)}>查看过程</button>}
        {showStart && <button data-start-task className="start-task-link" onClick={() => callbacks.onTask([node.id])}>开始任务</button>}
      </footer>
      {!fullscreen && <Handle type="source" position={Position.Right} className="node-handle" />}
    </article>
  )
}

function NodeBody({ data, fullscreen }: { data: CanvasNodeData; fullscreen: boolean }) {
  if (data.kind === 'tree') {
    return data.image?.data_uri
      ? <img className="artifact-image-preview" src={data.image.data_uri} alt={data.title} />
      : <div className="empty-content">没有可用预览</div>
  }
  if (data.kind === 'artifact' && data.artifact) return <ArtifactBody artifact={data.artifact} fullscreen={fullscreen} />
  if (data.kind === 'action' && data.action) return <ActionBody action={data.action} />
  return null
}

function ArtifactBody({ artifact, fullscreen }: { artifact: Artifact; fullscreen: boolean }) {
  if (artifact.data_uri) return <img className="artifact-image-preview" src={artifact.data_uri} alt={artifact.label} />
  const media = artifact.media_type || 'application/octet-stream'
  const text = artifact.text || ''
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  const table = media.includes('csv') || media.includes('tab-separated')
  const code = media.includes('r-source') || /\.(r|py|js|ts)$/i.test(artifact.label)
  const tree = media.includes('newick')
  const format = table ? (media.includes('tab-separated') ? 'TSV' : 'CSV') : code ? 'CODE' : tree ? 'NEWICK' : 'FILE'
  const separator = media.includes('tab-separated') ? '\t' : ','
  const detail = table && lines.length ? `${Math.max(0, lines.length - 1)} 行 · ${lines[0].split(separator).length} 列`
    : `${formatBytes(artifact.bytes)} · ${artifact.md5.slice(0, 8)}`
  const preview = table ? lines.slice(0, fullscreen ? 80 : 5).join('\n') : text.slice(0, fullscreen ? 100_000 : code ? 1200 : 520)
  return (
    <div className="artifact-file-body">
      <div className="artifact-file-meta"><span>{format}</span><small>{detail}</small></div>
      <pre className={code ? 'code-preview' : 'data-preview'}>{preview}</pre>
    </div>
  )
}

function ActionBody({ action }: { action: ActionRecord }) {
  const active = ['pending', 'claimed', 'running'].includes(action.status)
  const label = action.origin?.kind === 'agent-session'
    ? `Agent 会话发布${action.origin.actor ? ` · ${action.origin.actor}` : ''}` : '用户要求'
  const message = action.progress?.message || ({
    pending: '等待 Agent', claimed: 'Agent 已接收', running: 'Agent 正在处理',
    completed: `已生成 ${action.outputs?.length || 0} 个产物`, failed: '执行失败', cancelled: '已取消',
  } as Record<string, string>)[action.status]
  return (
    <div className="action-content">
      <span className="action-label">{label}</span>
      <blockquote>{action.instruction}</blockquote>
      {active && action.progress?.preview && <img className="agent-preview" src={`/api/actions/${action.id}/preview?t=${encodeURIComponent(action.progress.updated || '')}`} alt="Agent preview" />}
      <div className={`agent-action-status status-${action.status}`}>{action.status === 'running' && <i />}{message}</div>
      {active && Number.isFinite(Number(action.progress?.percent)) && (
        <div className="agent-progress"><span style={{ width: `${Math.max(0, Math.min(100, Number(action.progress?.percent)))}%` }} /></div>
      )}
      {action.error && <p className="error-text">{action.error.message}</p>}
    </div>
  )
}

function iconForData(data: CanvasNodeData) {
  if (data.kind === 'tree') return Network
  if (data.kind === 'action') return MessageSquarePlus
  const media = data.artifact?.media_type || ''
  const name = data.artifact?.label || ''
  if (media.startsWith('image/')) return Image
  if (media.includes('csv') || media.includes('tab-separated')) return Table2
  if (media.includes('r-source') || /\.(r|py|js|ts)$/i.test(name)) return Code2
  if (media.startsWith('text/')) return FileText
  return File
}

function statusForData(data: CanvasNodeData) {
  if (data.kind === 'action' && data.action) {
    return ({ pending: '等待 Agent', claimed: 'Agent 已接收', running: 'Agent 正在处理', completed: '已完成', failed: '失败', cancelled: '已取消' } as Record<string, string>)[data.action.status]
  }
  const role = data.artifact?.role
  if (role === 'reference' || role === 'paper-reference') return '参考输入'
  if (role === 'user-input') return '任务输入'
  if (role === 'agent-output') return '已完成'
  return data.current === false ? '历史产物' : '已完成'
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
