export interface Artifact {
  id: string
  action_id?: string
  label: string
  path: string
  role: string
  media_type: string
  bytes: number
  md5: string
  data_uri?: string
  text?: string
  metadata?: Record<string, unknown>
}

export type ActionStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ActionSource {
  kind: 'workspace-artifact' | 'action-artifact' | 'revision-view'
  artifact?: Artifact
  artifact_id?: string
  revision?: number
  layout?: string
}

export interface ActionRecord {
  id: string
  source: ActionSource
  sources?: ActionSource[]
  origin?: { kind: string; actor?: string | null }
  instruction: string
  selection?: SelectionValue | null
  status: ActionStatus
  claim?: { agent_id: string } | null
  progress?: {
    phase?: string
    message?: string
    percent?: number
    updated?: string
    preview?: Artifact | null
  }
  events?: Array<{ time: string; type: string; message: string; phase?: string; percent?: number }>
  outputs?: Artifact[]
  error?: { message: string } | null
  updated: string
}

export interface SceneNode {
  node: number
  kind: 'tip' | 'internal'
  label?: string
  artifact_coordinate?: { x: number; y: number }
}

export interface SceneView {
  id: string
  layout: string
  variant?: string
  artifact?: { md5?: string; path?: string }
  nodes: SceneNode[]
}

export interface Scene {
  schema_version: string
  scene_id: string
  tree: {
    tips: number
    internal_nodes: number
    rooted: boolean
    hash?: string | null
    input: { md5?: string | null }
  }
  views: SceneView[]
}

export interface ImageVariant {
  path: string
  data_uri: string
}

export interface RevisionPayload {
  revision: number
  current: boolean
  branch: string
  parents?: number[]
  scene: Scene
  variants: Record<string, {
    base?: ImageVariant | null
    intents?: ImageVariant | null
    annotated?: ImageVariant | null
  }>
}

export interface WorkspacePayload {
  id: string
  kind: string
  title: string
  subtitle?: string
  revision: number
  current_branch?: string
  activity_revision?: number
  branches?: unknown
}

export interface Payload {
  schema_version: string
  workspace: WorkspacePayload
  revisions: RevisionPayload[]
  scene: Scene
  actions: ActionRecord[]
  workspace_artifacts: Artifact[]
  variants: RevisionPayload['variants']
  annotations?: { annotations: unknown[] }
  pending_plan?: unknown
  run_metadata?: Record<string, unknown>
  feedback_status?: Record<string, unknown>
  caveats?: string[]
}

export type SelectionValue =
  | { kind: 'tip'; node: number; label?: string }
  | { kind: 'clade'; node: number; label?: string }
  | { kind: 'region'; region: { x: number; y: number; width: number; height: number } }
  | { kind: 'stroke'; points: Array<{ x: number; y: number }> }
  | { kind: 'view'; point: { x: number; y: number } }

export type CanvasNodeKind = 'artifact' | 'action' | 'tree'

export interface CanvasNodeData extends Record<string, unknown> {
  kind: CanvasNodeKind
  title: string
  artifact?: Artifact
  action?: ActionRecord
  parentAction?: ActionRecord
  revision?: number
  layout?: string
  image?: ImageVariant | null
  current?: boolean
}

declare global {
  interface Window {
    __GGTREE_AIR_PAYLOAD__?: Payload
    __GGTREE_AIR_API_TOKEN__?: string
  }
}
