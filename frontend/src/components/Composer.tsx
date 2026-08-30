import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Brush, X } from 'lucide-react'
import { apiFetch } from '../api'
import type { CanvasFlowNode } from '../graph'
import type { ActionRecord, ActionSource, Payload, SelectionValue } from '../types'

export function Composer({
  nodeIds, nodes, payload, selection, onSelectionClear, onClose, onSubmitted, onAnnotate,
}: {
  nodeIds: string[]
  nodes: CanvasFlowNode[]
  payload: Payload
  selection: SelectionValue | null
  onSelectionClear: () => void
  onClose: () => void
  onSubmitted: (action: ActionRecord) => void
  onAnnotate: (node: CanvasFlowNode) => void
}) {
  const selectedNodes = nodeIds.map((id) => nodes.find((node) => node.id === id)).filter((node): node is CanvasFlowNode => Boolean(node))
  const compound = selectedNodes.length > 1
  const selectedWorkspaceIds = new Set(selectedNodes
    .filter((node) => node.id.startsWith('workspace-artifact-'))
    .map((node) => node.data.artifact?.id).filter(Boolean))
  const initialChecked = useMemo(() => new Set(payload.workspace_artifacts
    .filter((artifact) => !compound || selectedWorkspaceIds.has(artifact.id))
    .map((artifact) => artifact.id)), [compound, nodeIds.join('|'), payload.workspace_artifacts.length])
  const [checked, setChecked] = useState(initialChecked)
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => { setChecked(initialChecked); setPrompt('') }, [initialChecked])
  if (!selectedNodes.length) return null
  const treeNode = selectedNodes.find((node) => node.data.kind === 'tree')
  const sourceTitle = compound ? `已选 ${selectedNodes.length} 个节点` : selectedNodes[0].data.title
  const selectionLabel = selection?.kind === 'tip' ? selection.label || `tip ${selection.node}`
    : selection?.kind === 'clade' ? selection.label || `clade ${selection.node}`
      : selection?.kind === 'region' ? '框选区域' : selection?.kind === 'stroke' ? '自由涂鸦' : null

  const submit = async () => {
    const instruction = prompt.trim()
    if (!instruction || submitting) return
    setSubmitting(true)
    try {
      const sources = dedupeSources([
        ...selectedNodes.map(sourceForNode).filter((source): source is ActionSource => Boolean(source)),
        ...payload.workspace_artifacts.filter((artifact) => checked.has(artifact.id)).map((artifact): ActionSource => ({
          kind: 'workspace-artifact', artifact_id: artifact.id,
        })),
      ])
      const action = await apiFetch<ActionRecord>('/api/actions', {
        method: 'POST',
        body: JSON.stringify({
          sources,
          instruction,
          selection: selection?.kind === 'view' ? null : selection,
        }),
      })
      onSubmitted(action)
    } catch (error) {
      alert(`任务提交失败：${error instanceof Error ? error.message : String(error)}`)
      setSubmitting(false)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <section id="node-composer" className="node-composer" data-no-drag>
      <header className="composer-header">
        <div><strong>新建 Agent 任务</strong><small>来源 · {sourceTitle}</small></div>
        <button data-composer-close aria-label="关闭" onClick={onClose}><X size={13} /></button>
      </header>
      {selectionLabel && <button className="selection-chip" data-composer-clear-selection onClick={onSelectionClear}>{selectionLabel} ×</button>}
      {payload.workspace_artifacts.length > 1 && (
        <div className="composer-context-block">
          <span>任务输入</span>
          <div className="composer-context">
            {payload.workspace_artifacts.map((artifact) => (
              <label key={artifact.id}>
                <input
                  type="checkbox"
                  data-composer-source={artifact.id}
                  checked={checked.has(artifact.id)}
                  onChange={(event) => setChecked((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(artifact.id); else next.delete(artifact.id)
                    return next
                  })}
                />
                <span>{artifact.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="composer-surface">
        {treeNode && <button data-composer-annotate title="在图上选择区域" onClick={() => onAnnotate(treeNode)}><Brush size={14} /></button>}
        <textarea id="node-composer-input" autoFocus rows={2} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onKeyDown} placeholder="告诉 Agent 要完成的具体任务…" />
        <button data-composer-send aria-label="发送" disabled={!prompt.trim() || submitting} onClick={() => void submit()}>{submitting ? '…' : <ArrowUp size={16} />}</button>
      </div>
      <footer><span>{checked.size || selectedNodes.length} 个上下文资源</span><span>⌘/Ctrl + Enter</span></footer>
    </section>
  )
}

function sourceForNode(node: CanvasFlowNode): ActionSource | null {
  if (node.data.kind === 'artifact' && node.data.artifact) {
    return node.data.artifact.action_id
      ? { kind: 'action-artifact', artifact_id: node.data.artifact.id }
      : { kind: 'workspace-artifact', artifact_id: node.data.artifact.id }
  }
  if (node.data.kind === 'tree') {
    return { kind: 'revision-view', revision: node.data.revision, layout: node.data.layout }
  }
  return null
}

function dedupeSources(sources: ActionSource[]) {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = source.kind === 'revision-view'
      ? `${source.kind}:${source.revision}:${source.layout}`
      : `${source.kind}:${source.artifact_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
