import { MarkerType, Position, type Edge, type Node } from '@xyflow/react'
import type { ActionSource, CanvasNodeData, Payload, RevisionPayload } from './types'

export type CanvasFlowNode = Node<CanvasNodeData, 'canvasNode'>

const INPUT_X = 80
const INPUT_GAP_X = 480
const INPUT_GAP_Y = 360

function preferredImage(revision: RevisionPayload, layout: string) {
  const variants = revision.variants?.[layout] || {}
  return variants.intents?.data_uri ? variants.intents
    : variants.annotated?.data_uri ? variants.annotated
      : variants.base || null
}

export function buildGraph(payload: Payload): { nodes: CanvasFlowNode[]; edges: Edge[] } {
  const nodes: CanvasFlowNode[] = []
  const edges: Edge[] = []
  const nodeMap = new Map<string, CanvasFlowNode>()
  const addNode = (node: CanvasFlowNode) => {
    nodes.push(node)
    nodeMap.set(node.id, node)
  }

  payload.workspace_artifacts.forEach((artifact, index) => {
    const image = Boolean(artifact.data_uri)
    addNode({
      id: `workspace-artifact-${artifact.id}`,
      type: 'canvasNode',
      position: { x: INPUT_X + (index % 3) * INPUT_GAP_X, y: 40 + Math.floor(index / 3) * INPUT_GAP_Y },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: image ? 430 : 390, height: image ? 330 : artifact.text ? 230 : 180 },
      data: { kind: 'artifact', title: artifact.label, artifact },
    })
  })

  const revisions = payload.revisions.length ? payload.revisions : [{
    revision: payload.workspace.revision,
    current: true,
    branch: payload.workspace.current_branch || 'main',
    scene: payload.scene,
    variants: payload.variants,
  } as RevisionPayload]
  revisions.forEach((revision, revisionIndex) => {
    revision.scene.views.forEach((view, viewIndex) => {
      const id = `view-r${revision.revision}-${view.layout}`
      addNode({
        id,
        type: 'canvasNode',
        position: { x: 80 + revisionIndex * 760, y: 40 + viewIndex * 360 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { width: 430, height: 330 },
        data: {
          kind: 'tree', title: `${view.layout} · r${revision.revision}`,
          revision: revision.revision, layout: view.layout,
          image: preferredImage(revision, view.layout), current: revision.current,
        },
      })
    })
  })

  for (const action of payload.actions) {
    const sourceIds = (action.sources?.length ? action.sources : [action.source])
      .map((source) => sourceNodeId(source, nodeMap)).filter((id): id is string => Boolean(id))
    if (!sourceIds.length) continue
    const sourceNodes = sourceIds.map((id) => nodeMap.get(id)).filter((node): node is CanvasFlowNode => Boolean(node))
    const sourceRight = Math.max(...sourceNodes.map((node) => node.position.x + Number(node.style?.width || 0)))
    const centerY = sourceNodes.reduce((sum, node) => sum + node.position.y + Number(node.style?.height || 0) / 2, 0) / sourceNodes.length
    const actionId = `agent-action-${action.id}`
    const activePreview = ['pending', 'claimed', 'running'].includes(action.status) && action.progress?.preview
    const actionNode: CanvasFlowNode = {
      id: actionId,
      type: 'canvasNode',
      position: { x: sourceRight + 250, y: centerY - 105 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: { width: 320, height: activePreview ? 310 : 220 },
      data: { kind: 'action', title: 'Agent 任务', action },
    }
    addNode(actionNode)
    sourceIds.forEach((sourceId, index) => edges.push({
      id: `${sourceId}->${actionId}-${index}`,
      source: sourceId,
      target: actionId,
      type: 'smoothstep',
      animated: action.status === 'running',
      style: { stroke: '#8fb3e8', strokeWidth: 1.35 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#8fb3e8', width: 14, height: 14 },
    }))

    const outputs = action.outputs || []
    outputs.forEach((artifact, index) => {
      const image = Boolean(artifact.data_uri)
      const outputId = `agent-artifact-${artifact.id}`
      addNode({
        id: outputId,
        type: 'canvasNode',
        position: {
          x: actionNode.position.x + Number(actionNode.style?.width || 0) + 250,
          y: actionNode.position.y + index * 360 - ((outputs.length - 1) * 180),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { width: image ? 430 : 390, height: image ? 330 : artifact.text ? 230 : 180 },
        data: { kind: 'artifact', title: artifact.label, artifact, parentAction: action },
      })
      edges.push({
        id: `${actionId}->${outputId}`,
        source: actionId,
        target: outputId,
        type: 'smoothstep',
        style: { stroke: '#6f9fe3', strokeWidth: 1.35 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6f9fe3', width: 14, height: 14 },
      })
    })
  }

  return { nodes, edges }
}

function sourceNodeId(source: ActionSource, nodes: Map<string, CanvasFlowNode>): string | null {
  if (source.kind === 'revision-view') {
    const exact = `view-r${source.revision}-${source.layout}`
    if (nodes.has(exact)) return exact
    return [...nodes.keys()].reverse().find((id) => id.endsWith(`-${source.layout}`)) || null
  }
  const artifactId = source.artifact?.id || source.artifact_id
  if (!artifactId) return null
  const id = source.kind === 'workspace-artifact'
    ? `workspace-artifact-${artifactId}` : `agent-artifact-${artifactId}`
  return nodes.has(id) ? id : null
}

export function loadSavedPositions(workspaceId: string, nodes: CanvasFlowNode[]): CanvasFlowNode[] {
  try {
    const value = JSON.parse(localStorage.getItem(`ggtree-air:${workspaceId}:workflow-layout`) || '{}')
    return nodes.map((node) => Number.isFinite(value[node.id]?.x) && Number.isFinite(value[node.id]?.y)
      ? { ...node, position: { x: value[node.id].x, y: value[node.id].y } }
      : node)
  } catch {
    return nodes
  }
}

export function savePositions(workspaceId: string, nodes: CanvasFlowNode[]) {
  try {
    localStorage.setItem(`ggtree-air:${workspaceId}:workflow-layout`, JSON.stringify(Object.fromEntries(
      nodes.map((node) => [node.id, node.position]),
    )))
  } catch { /* storage is optional */ }
}
