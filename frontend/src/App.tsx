import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background, BackgroundVariant, ReactFlow, ReactFlowProvider,
  SelectionMode, useEdgesState, useNodesState, useReactFlow, useViewport, ViewportPortal,
  type NodeChange, type NodeMouseHandler,
} from '@xyflow/react'
import { Focus, FolderOpen, MessageSquarePlus, Minus, Plus, X } from 'lucide-react'
import { apiFetch, listActions, liveApi } from './api'
import { buildGraph, loadSavedPositions, savePositions, type CanvasFlowNode } from './graph'
import type { ActionRecord, CanvasNodeData, Payload, SelectionValue } from './types'
import { CanvasNode, CanvasNodeCallbacks, FullscreenNode } from './components/CanvasNode'
import { Composer } from './components/Composer'
import { Drawer, type DrawerRequest } from './components/Drawer'

const nodeTypes = { canvasNode: CanvasNode }

export default function App() {
  return <ReactFlowProvider><CanvasApp /></ReactFlowProvider>
}

function CanvasApp() {
  const initialPayload = window.__GGTREE_AIR_PAYLOAD__!
  const [payload, setPayload] = useState(initialPayload)
  const initialGraph = useMemo(() => buildGraph(initialPayload), [])
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<CanvasFlowNode>(loadSavedPositions(initialPayload.workspace.id, initialGraph.nodes))
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialGraph.edges)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [composerNodeIds, setComposerNodeIds] = useState<string[]>([])
  const [composerSelection, setComposerSelection] = useState<SelectionValue | null>(null)
  const [drawer, setDrawer] = useState<DrawerRequest | null>(null)
  const [drawerFullscreen, setDrawerFullscreen] = useState(false)
  const [fullscreenNodeId, setFullscreenNodeId] = useState<string | null>(null)
  const [agentConnected, setAgentConnected] = useState(liveApi)
  const [toast, setToast] = useState('')
  const statuses = useRef(new Map(initialPayload.actions.map((action) => [action.id, action.status])))
  const { fitView, getNodesBounds, zoomIn, zoomOut } = useReactFlow()
  const viewport = useViewport()

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    onNodesChangeBase(changes)
  }, [onNodesChangeBase])

  const rebuild = useCallback((nextPayload: Payload) => {
    const graph = buildGraph(nextPayload)
    setNodes((current) => {
      const positions = new Map(current.map((node) => [node.id, node.position]))
      return graph.nodes.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node)
    })
    setEdges(graph.edges)
  }, [setEdges, setNodes])

  useEffect(() => {
    const timer = window.setTimeout(() => void fitView({ padding: 0.18, duration: 0, maxZoom: .92 }), 80)
    return () => clearTimeout(timer)
  }, [fitView])

  useEffect(() => {
    if (!liveApi) return
    const refreshAgents = async () => {
      try {
        const response = await apiFetch<{ selected_agent: string | null }>('/api/agents')
        setAgentConnected(Boolean(response.selected_agent))
      } catch { setAgentConnected(false) }
    }
    void refreshAgents()
    const timer = window.setInterval(refreshAgents, 2_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!liveApi) return
    const timer = window.setInterval(async () => {
      try {
        const actions = await listActions()
        const completedChanged = actions.some((action) => action.status === 'completed' && statuses.current.get(action.id) !== 'completed')
        const changed = actions.length !== payload.actions.length || actions.some((action) => {
          const current = payload.actions.find((item) => item.id === action.id)
          return !current || current.updated !== action.updated || current.status !== action.status
        })
        if (!changed) return
        statuses.current = new Map(actions.map((action) => [action.id, action.status]))
        const nextPayload = { ...payload, actions }
        setPayload(nextPayload)
        rebuild(nextPayload)
        if (completedChanged) window.setTimeout(() => location.replace(`/?activity=${Date.now()}`), 350)
      } catch { /* transient service restart */ }
    }, 800)
    return () => clearInterval(timer)
  }, [payload, rebuild])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2_600)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (fullscreenNodeId) { setFullscreenNodeId(null); return }
      if (drawerFullscreen) { setDrawerFullscreen(false); return }
      if (drawer) { setDrawer(null); return }
      if (composerNodeIds.length) { setComposerNodeIds([]); setComposerSelection(null); return }
      if (selectedIds.length) { setSelectedIds([]); setNodes((current) => current.map((node) => ({ ...node, selected: false }))) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [composerNodeIds.length, drawer, drawerFullscreen, fullscreenNodeId, selectedIds.length, setNodes])

  const callbacks = useMemo(() => ({
    hasActions: payload.actions.length > 0,
    selectedCount: selectedIds.length,
    onOpen: (reference: { id: string; data: CanvasNodeData }) => {
      const node = nodes.find((candidate) => candidate.id === reference.id)
      if (!node) return
      if (node.data.kind === 'artifact') setDrawer({ kind: 'artifact', node })
      else if (node.data.kind === 'tree') setDrawer({ kind: 'tree', node })
      else if (node.data.action) setDrawer({ kind: 'action', action: node.data.action })
    },
    onTask: (nodeIds: string[]) => {
      setSelectedIds(nodeIds)
      setNodes((current) => current.map((node) => ({ ...node, selected: nodeIds.includes(node.id) })))
      setComposerNodeIds(nodeIds)
      setComposerSelection(null)
    },
    onFullscreen: (node: { id: string }) => setFullscreenNodeId(node.id),
    onRun: (action: ActionRecord) => setDrawer({ kind: 'action', action }),
  }), [nodes, payload.actions.length, selectedIds.length, setNodes])

  const selectionChanged = useCallback(({ nodes: selected }: { nodes: CanvasFlowNode[] }) => {
    setSelectedIds(selected.map((node) => node.id))
  }, [])

  const onNodeClick: NodeMouseHandler<CanvasFlowNode> = useCallback((event, node) => {
    if (event.shiftKey) return
    setSelectedIds([node.id])
  }, [])

  const selectedFlowNodes = nodes.filter((node) => selectedIds.includes(node.id))
  const selectionBounds = selectedFlowNodes.length ? getNodesBounds(selectedFlowNodes) : null
  const selectedSourceIds = selectedIds.filter((id) => {
    const node = nodes.find((item) => item.id === id)
    return node?.data.kind === 'artifact' || node?.data.kind === 'tree'
  })
  const composerBounds = composerNodeIds.length
    ? getNodesBounds(nodes.filter((node) => composerNodeIds.includes(node.id))) : null
  const composerStyle = composerBounds ? {
    left: Math.max(210, Math.min(window.innerWidth - 210, viewport.x + (composerBounds.x + composerBounds.width / 2) * viewport.zoom)),
    top: Math.max(12, Math.min(window.innerHeight - 52 - 290, viewport.y + (composerBounds.y + composerBounds.height) * viewport.zoom + 12)),
  } : undefined
  const fullscreenNode = nodes.find((node) => node.id === fullscreenNodeId)
  const hint = payload.actions.length === 0 && payload.workspace_artifacts.length
    ? 'Shift 点击或 Shift 框选多个输入，或点击“开始任务”创建第一项工作'
    : 'Shift 多选 · Shift 框选 · 拖动组合 · 滚轮缩放'

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">G</div>
        <div className="project-heading"><h1>{payload.workspace.title}</h1><p>{payload.workspace.subtitle || `revision ${payload.workspace.revision}`}</p></div>
        <div className="run-summary"><span>{payload.workspace_artifacts.length} inputs</span><span>{payload.actions.length} Agent runs</span></div>
        <div id="connection-status" className={agentConnected ? 'connection-status live' : 'connection-status'}>{liveApi ? agentConnected ? 'Agent 已连接' : 'Agent 未连接' : '离线报告'}</div>
      </header>
      <section className="canvas-stage">
        <CanvasNodeCallbacks value={callbacks}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={selectionChanged}
            onNodeClick={onNodeClick}
            onNodeDragStop={() => savePositions(payload.workspace.id, nodes)}
            minZoom={0.25}
            maxZoom={1.35}
            fitView
            fitViewOptions={{ padding: 0.18, maxZoom: .92 }}
            multiSelectionKeyCode="Shift"
            selectionKeyCode="Shift"
            selectionOnDrag={false}
            selectionMode={SelectionMode.Partial}
            panOnDrag
            nodesConnectable={false}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="#d9e2ec" />
            <div className="canvas-toolbar" aria-label="画布工具">
              <button data-tool="fit" title="聚焦全部" onClick={() => void fitView({ padding: 0.18, duration: 220, maxZoom: .92 })}><Focus size={16} /></button>
              <button data-tool="workspaces" title="工作空间与输入资源" onClick={() => setDrawer({ kind: 'workspace' })}><FolderOpen size={16} /></button>
            </div>
            <div className="zoom-controls"><button onClick={() => void zoomOut({ duration: 150 })}><Minus size={14} /></button><span>缩放</span><button onClick={() => void zoomIn({ duration: 150 })}><Plus size={14} /></button></div>
            {selectedIds.length > 1 && selectionBounds && (
              <SelectionChrome
                count={selectedIds.length}
                bounds={selectionBounds}
                viewport={viewport}
                canCreateTask={Boolean(selectedSourceIds.length)}
                onTask={() => setComposerNodeIds(selectedSourceIds)}
                onClear={() => { setSelectedIds([]); setNodes((current) => current.map((node) => ({ ...node, selected: false }))) }}
              />
            )}
          </ReactFlow>
          {composerNodeIds.length > 0 && (
            <Composer
              nodeIds={composerNodeIds}
              nodes={nodes}
              payload={payload}
              selection={composerSelection}
              style={composerStyle}
              onSelectionClear={() => setComposerSelection(null)}
              onClose={() => { setComposerNodeIds([]); setComposerSelection(null) }}
              onSubmitted={(action) => {
                const nextPayload = { ...payload, actions: [...payload.actions, action] }
                statuses.current.set(action.id, action.status)
                setPayload(nextPayload)
                rebuild(nextPayload)
                setComposerNodeIds([])
                setComposerSelection(null)
                setToast('已创建任务，正在启动真实 Agent')
              }}
              onAnnotate={(node) => { setDrawer({ kind: 'tree', node, selecting: true }) }}
            />
          )}
          {fullscreenNode && <FullscreenNode node={fullscreenNode} onExit={() => setFullscreenNodeId(null)} />}
        </CanvasNodeCallbacks>
        <div className="canvas-hint">{hint}</div>
      </section>
      {drawer && (
        <Drawer
          request={drawer}
          payload={payload}
          fullscreen={drawerFullscreen}
          onFullscreen={() => setDrawerFullscreen((value) => !value)}
          onClose={() => { setDrawer(null); setDrawerFullscreen(false) }}
          onTask={(ids) => {
            setDrawer(null)
            setSelectedIds(ids)
            setNodes((current) => current.map((node) => ({ ...node, selected: ids.includes(node.id) })))
            setComposerNodeIds(ids)
          }}
          onSelection={(nodeId, selection) => { setDrawer(null); setComposerNodeIds([nodeId]); setComposerSelection(selection) }}
        />
      )}
      {toast && <div className="toast show" onAnimationEnd={() => undefined}>{toast}</div>}
    </main>
  )
}

function SelectionChrome({
  count, bounds, viewport, canCreateTask, onTask, onClear,
}: {
  count: number
  bounds: { x: number; y: number; width: number; height: number }
  viewport: { x: number; y: number; zoom: number }
  canCreateTask: boolean
  onTask: () => void
  onClear: () => void
}) {
  const padding = 14
  const header = 38
  const left = viewport.x + (bounds.x + bounds.width / 2) * viewport.zoom
  const top = Math.max(10, viewport.y + (bounds.y - header - padding) * viewport.zoom - 10)
  return (
    <>
      <ViewportPortal>
        <div
          className="compound-selection-shell"
          data-selection-count={count}
          style={{
            left: bounds.x - padding,
            top: bounds.y - header - padding,
            width: bounds.width + padding * 2,
            height: bounds.height + header + padding * 2,
          }}
        >
          <header>组合节点 · {count} 项</header>
        </div>
      </ViewportPortal>
      <div className="selection-toolbar" data-selection-count={count} style={{ left, top }} onPointerDown={(event) => event.stopPropagation()}>
        <strong>组合节点 · {count} 项</strong>
        <button data-selection-task disabled={!canCreateTask} onClick={onTask}><MessageSquarePlus size={14} />Agent 任务</button>
        <button data-selection-clear title="取消多选" onClick={onClear}><X size={14} /></button>
      </div>
    </>
  )
}
