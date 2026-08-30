(() => {
  'use strict'

  const payload = JSON.parse(document.getElementById('ggtree-air-payload').textContent)
  const scene = payload.scene
  const revisions = Array.isArray(payload.revisions) && payload.revisions.length
    ? payload.revisions
    : [{ revision: payload.workspace.revision, current: true, scene, variants: payload.variants,
         run_metadata: payload.run_metadata, feedback_status: payload.feedback_status }]
  const currentRevisionData = revisions.find((revision) => revision.current)
    || revisions[revisions.length - 1]
  const variants = currentRevisionData.variants
  let protocolActions = Array.isArray(payload.actions) ? payload.actions : []
  const workspaceArtifacts = Array.isArray(payload.workspace_artifacts) ? payload.workspace_artifacts : []
  const apiToken = window.__GGTREE_AIR_API_TOKEN__
  const liveApi = typeof apiToken === 'string' && !apiToken.includes('__GGTREE_AIR_')
  const stage = document.getElementById('canvas-stage')
  const world = document.getElementById('canvas-world')
  const nodeLayer = document.getElementById('node-layer')
  const edgeLayer = document.getElementById('edge-layer')
  const drawer = document.getElementById('right-drawer')
  const backdrop = document.getElementById('drawer-backdrop')
  const importInput = document.getElementById('annotation-import')
  const rerunButton = document.getElementById('rerun-button')
  const storageKey = `ggtree-air:${scene.scene_id}:r${payload.workspace.revision}:annotations`

  const camera = { x: 110, y: 72, zoom: 0.86 }
  let selectedNodeId = null
  let maximizedNode = null
  let drawerFullscreen = false
  let currentLayout = null
  let currentRevision = payload.workspace.revision
  let currentVariant = 'base'
  let annotationMode = 'select'
  let drawingGesture = null
  let draftTarget = null
  let draggingNode = null
  let panning = null
  let toastTimer = null
  let activeJobId = null
  let composerNodeId = null
  let composerSelection = null
  let pendingPlan = payload.pending_plan || null
  let annotations = payload.annotations
  let savePromise = Promise.resolve()

  const iconPaths = {
    input: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    route: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6.5 7.5l4.2 8M17.5 7.5l-4.2 8"/>',
    tree: '<path d="M12 3v5M5 21v-5h14v5M5 16v-4h14v4M12 8v4"/><circle cx="5" cy="21" r="1"/><circle cx="19" cy="21" r="1"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/>',
    file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
    code: '<path d="m9 8-4 4 4 4M15 8l4 4-4 4M13 5l-2 14"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
    feedback: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/>',
    branches: '<circle cx="6" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="6" cy="20" r="2"/><path d="M6 6v12M8 7c4 0 4 1 8 1M8 17c4 0 4-5 8-7"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3z"/><path d="M3 6V4h7l2 2"/>',
    science: '<path d="M9 3h6M10 3v5l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3"/><path d="M8 15h8"/>',
    open: '<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    fit: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    maximize: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    minimize: '<path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/>',
    results: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
    pin: '<path d="M12 22v-7M7 3h10l-2 5 3 3H6l3-3z"/>',
    cursor: '<path d="m5 3 14 9-7 2-3 7z"/>',
    box: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M8 5v14M16 5v14" opacity=".35"/>',
    brush: '<path d="m14 4 6 6-8 8H6v-6z"/><path d="M5 19c-1 0-2 .8-2 2h7"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M8 10v7M12 10v7M16 10v7M5 6l1 15h12l1-15"/>',
  }

  function icon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.tree}</svg>`
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char])
  }

  function shortInstruction(value, length = 22) {
    const text = String(value || '').trim()
    return text.length > length ? `${text.slice(0, length - 1)}…` : text
  }

  function humanizeOperation(operation) {
    const paletteNames = {
      colorblind: '色盲友好配色', viridis: 'Viridis 配色', pastel: '柔和配色',
      vivid: '高对比配色', warm: '暖色配色', cool: '冷色配色', monochrome: '黑白配色',
    }
    const themeNames = { publication: '期刊版式', minimal: '极简版式', compact: '紧凑版式' }
    switch (operation?.op) {
      case 'set-heatmap-width': return `${operation.layout ? `${operation.layout} ` : ''}数据色块${operation.value < 0.25 ? '缩小' : '放大'}`
      case 'set-palette': return `${operation.layout ? `${operation.layout} ` : ''}配色改为${paletteNames[operation.value] || operation.value}`
      case 'set-theme': return `${operation.layout ? `${operation.layout} ` : ''}使用${themeNames[operation.value] || operation.value}`
      case 'set-layouts': return `布局改为 ${(operation.values || []).join('、')}`
      case 'set-intents': return '更新图形注释层'
      case 'set-tip-labels': return operation.value === 'hide' ? '隐藏密集 tip 标签' : '显示 tip 标签'
      case 'set-heatmap-columns': return `热图使用 ${(operation.values || []).join('、')}`
      case 'add-clade': return `标记 ${operation.label || `clade ${operation.node}`}`
      case 'remove-clade': return `移除 clade ${operation.node} 标记`
      case 'merge-branch': return `合并 ${operation.source} 到 ${operation.target}`
      default: return '更新绘图设置'
    }
  }

  function shortHash(value) {
    return typeof value === 'string' ? value.slice(0, 8) : '—'
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  function artifactIconName(artifact) {
    const mediaType = String(artifact?.media_type || '')
    const name = String(artifact?.label || '').toLowerCase()
    if (mediaType.startsWith('image/')) return 'image'
    if (mediaType.includes('csv') || mediaType.includes('tab-separated')) return 'table'
    if (mediaType.includes('r-source') || /\.(r|py|js|ts)$/.test(name)) return 'code'
    return 'file'
  }

  function nodeIconName(node) {
    if (node.type === 'external-artifact') return artifactIconName(node.artifact)
    if (node.type === 'revision-feedback' || node.type === 'protocol-action' || node.type.startsWith('draft-')) return 'feedback'
    return node.type
  }

  function sourcePath() {
    const input = payload.workspace?.input_source || payload.run_metadata?.input?.path || ''
    return input.split(/[\\/]/).pop() || input
  }

  function preferredVariant(layout, revision) {
    const available = variantsFor(layout, revision)
    return available.intents?.data_uri ? 'intents'
      : available.annotated?.data_uri ? 'annotated'
        : 'base'
  }

  function makeNodes() {
    const layoutCount = Math.max(...revisions.map((revision) => revision.scene.views.length))
    const viewGap = 360
    const revisionGap = 760
    const laneHeight = layoutCount * viewGap + 250
    const viewStartY = 40
    const revisionMap = new Map(revisions.map((revision) => [revision.revision, revision]))
    const branchNames = Object.keys(payload.workspace.branches || {})
    for (const revision of revisions) if (!branchNames.includes(revision.branch)) branchNames.push(revision.branch)
    const branchLane = new Map(branchNames.map((name, index) => [name, index]))
    const depthMemo = new Map()
    const depthOf = (revision) => {
      if (depthMemo.has(revision.revision)) return depthMemo.get(revision.revision)
      const parents = revision.parents || []
      const depth = parents.length
        ? Math.max(...parents.map((id) => depthOf(revisionMap.get(id) || { revision: id, parents: [] }))) + 1
        : 0
      depthMemo.set(revision.revision, depth)
      return depth
    }
    const centerY = (revision) => viewStartY
      + (branchLane.get(revision.branch) || 0) * laneHeight
      + Math.max(0, (layoutCount - 1) * viewGap / 2)
    const visibleViews = (revision) => {
      if (!(revision.parents || []).length || !revision.revision_diff) return revision.scene.views
      const changed = new Set((revision.revision_diff.views || [])
        .filter((view) => view.changed).map((view) => view.layout))
      return revision.scene.views.filter((view) => changed.has(view.layout))
    }
    const resultNodes = revisions.flatMap((revision) =>
      visibleViews(revision).map((view, index) => ({
        id: `view-r${revision.revision}-${view.layout}`,
        type: 'tree',
        title: `${view.layout} · r${revision.revision} · ${revision.branch}`,
        layout: view.layout,
        revision: revision.revision,
        branch: revision.branch,
        current: revision.current,
        variant: preferredVariant(view.layout, revision.revision),
        x: (workspaceArtifacts.length ? 600 : 80) + depthOf(revision) * revisionGap,
        y: viewStartY + (branchLane.get(revision.branch) || 0) * laneHeight + index * viewGap,
        w: 430,
        h: 330,
      })))
    const derivedRevisions = revisions.filter((revision) => (revision.parents || []).length > 0)
    const revisionActionNodes = derivedRevisions.flatMap((revision) => {
      const actions = [
        ...(revision.applied_annotations?.annotations || []).map((item) => ({ kind: 'feedback', item })),
        ...(revision.applied_plan ? [{
          kind: revision.applied_plan.operations?.some((operation) => operation.op === 'merge-branch') ? 'merge' : 'plan',
          item: revision.applied_plan,
        }] : []),
      ]
      if (!actions.length) actions.push({ kind: revision.parents.length > 1 ? 'merge' : 'feedback', item: null })
      return actions.map((action, index) => ({
        id: `action-r${revision.revision}-${index + 1}`,
        type: 'revision-feedback',
        title: action.kind === 'merge' ? `合并 · ${shortInstruction(action.item?.rationale || `revision ${revision.revision}`)}`
          : `修改 · ${shortInstruction(action.kind === 'feedback' ? action.item?.instruction : action.item?.prompt || action.item?.rationale)}`,
        instruction: action.kind === 'feedback'
          ? action.item?.instruction
          : action.item?.prompt || action.item?.rationale,
        revision: revision.revision,
        branch: revision.branch,
        feedbackItems: action.kind === 'feedback' && action.item ? [action.item] : [],
        planOperations: action.kind !== 'feedback' && action.item ? (action.item.operations || []) : [],
        sourceLayout: action.kind === 'feedback'
          ? action.item?.view_id?.replace(/^view:/, '')
          : action.item?.source_view_id?.replace(/^view:/, ''),
        x: 80 + depthOf(revision) * revisionGap - 280,
        y: centerY(revision) - (actions.length - 1) * 105 + index * 210 + 55,
        w: 230,
        h: 190,
      }))
    })
    const currentDepth = depthOf(currentRevisionData)
    const actionX = 80 + (currentDepth + 1) * revisionGap - 280
    const currentViewById = new Map(currentRevisionData.scene.views.map((view) => [view.id, view]))
    const draftFeedbackNodes = annotations.annotations.map((annotation, index) => {
      const view = currentViewById.get(annotation.view_id) || currentRevisionData.scene.views[0]
      return {
        id: `draft-feedback-${annotation.id}`,
        type: 'draft-feedback',
        title: `待修改 · ${shortInstruction(annotation.instruction)}`,
        revision: currentRevisionData.revision,
        branch: currentRevisionData.branch,
        annotation,
        layout: view.layout,
        sourceNodeId: `view-r${currentRevisionData.revision}-${view.layout}`,
        x: actionX,
        y: centerY(currentRevisionData) + index * 210,
        w: 260,
        h: 190,
      }
    })
    const draftPlanNodes = pendingPlan?.operations?.length ? (() => {
      const view = currentRevisionData.scene.views.find((candidate) => candidate.id === pendingPlan.source_view_id)
        || currentRevisionData.scene.views[0]
      return [{
        id: 'draft-plan-1',
        type: 'draft-plan',
        title: `待修改 · ${shortInstruction(pendingPlan.prompt || pendingPlan.rationale)}`,
        revision: currentRevisionData.revision,
        branch: currentRevisionData.branch,
        operations: pendingPlan.operations,
        prompt: pendingPlan.prompt || pendingPlan.rationale,
        sourceNodeId: `view-r${currentRevisionData.revision}-${view.layout}`,
        x: actionX + (draftFeedbackNodes.length ? 290 : 0),
        y: centerY(currentRevisionData) + draftFeedbackNodes.length * 210,
        w: 280,
        h: 210,
      }]
    })() : []
    const workspaceArtifactNodes = workspaceArtifacts.map((artifact, index) => ({
      id: `workspace-artifact-${artifact.id}`,
      type: 'external-artifact',
      title: artifact.label,
      artifact,
      x: 80 + (index % 3) * 480,
      y: viewStartY + Math.floor(index / 3) * 360,
      w: artifact.data_uri ? 430 : 390,
      h: artifact.data_uri ? 330 : artifact.text ? 230 : 180,
      current: true,
    }))
    const protocolNodes = []
    const protocolEdges = []
    const protocolNodeById = new Map([...resultNodes, ...workspaceArtifactNodes].map((node) => [node.id, node]))
    for (const action of protocolActions) {
      const requestedSources = action.sources?.length ? action.sources : [action.source]
      const sourceEntries = requestedSources.map((source) => {
        let id = source.kind === 'revision-view'
          ? `view-r${source.revision}-${source.layout}`
          : source.kind === 'workspace-artifact'
            ? `workspace-artifact-${source.artifact?.id || source.artifact_id}`
            : `agent-artifact-${source.artifact?.id || source.artifact_id}`
        let node = protocolNodeById.get(id)
        if (!node && source.kind === 'revision-view') {
          node = [...resultNodes].reverse().find((candidate) => candidate.layout === source.layout)
          id = node?.id
        }
        return node ? { id, node } : null
      }).filter(Boolean)
      if (!sourceEntries.length) continue
      const sourceRight = Math.max(...sourceEntries.map(({ node }) => node.x + node.w))
      const sourceCenterY = sourceEntries.reduce((sum, { node }) => sum + node.y + node.h / 2, 0) / sourceEntries.length
      const actionNode = {
        id: `agent-action-${action.id}`,
        type: 'protocol-action',
        title: 'Agent 任务',
        action,
        x: sourceRight + 250,
        y: sourceCenterY - 95,
        w: 300,
        h: ['pending', 'claimed', 'running'].includes(action.status) && action.progress?.preview ? 310 : 220,
      }
      protocolNodes.push(actionNode)
      protocolNodeById.set(actionNode.id, actionNode)
      sourceEntries.forEach(({ id }) => {
        protocolEdges.push({ from: id, to: actionNode.id, label: 'agent action' })
      })
      ;(action.outputs || []).forEach((artifact, index) => {
        const artifactNode = {
          id: `agent-artifact-${artifact.id}`,
          type: 'external-artifact',
          title: artifact.label,
          artifact,
          actionId: action.id,
          x: actionNode.x + actionNode.w + 250,
          y: actionNode.y + index * 360 - ((action.outputs.length - 1) * 180),
          w: artifact.data_uri ? 430 : 390,
          h: artifact.data_uri ? 330 : artifact.text ? 230 : 180,
          current: true,
        }
        protocolNodes.push(artifactNode)
        protocolNodeById.set(artifactNode.id, artifactNode)
        protocolEdges.push({ from: actionNode.id, to: artifactNode.id, label: 'agent output' })
      })
    }
    const nodes = [
      ...workspaceArtifactNodes,
      ...resultNodes,
      ...revisionActionNodes,
      ...draftFeedbackNodes,
      ...draftPlanNodes,
      ...protocolNodes,
    ]
    const lineageEdges = derivedRevisions.flatMap((revision) => {
      const actionNodes = revisionActionNodes.filter((node) => node.revision === revision.revision)
      return actionNodes.flatMap((actionNode) => {
        const incoming = (revision.parents || []).flatMap((parentId) => {
          const parent = revisionMap.get(parentId)
          if (!parent) return []
          return parent.scene.views
            .filter((view) => !actionNode.sourceLayout || view.layout === actionNode.sourceLayout)
            .map((view) => ({
            from: `view-r${parent.revision}-${view.layout}`,
            to: actionNode.id,
            label: revision.parents.length > 1 ? 'merge input' : 'feedback input',
          }))
        })
        const outgoing = revision.scene.views.map((view) => ({
          from: actionNode.id,
          to: `view-r${revision.revision}-${view.layout}`,
          label: revision.parents.length > 1 ? 'merge output' : 'feedback output',
        }))
        return [...incoming, ...outgoing]
      })
    })
    const draftEdges = [...draftFeedbackNodes, ...draftPlanNodes].map((node) => ({
      from: node.sourceNodeId,
      to: node.id,
      label: 'draft action',
    }))
    const edges = [
      ...lineageEdges,
      ...draftEdges,
      ...protocolEdges,
    ]
    return { nodes, edges }
  }

  let graph = makeNodes()
  const workflowLayoutKey = `ggtree-air:${payload.workspace.id || scene.scene_id}:workflow-layout`
  try {
    const savedLayout = JSON.parse(localStorage.getItem(workflowLayoutKey) || '{}')
    for (const node of graph.nodes) {
      const saved = savedLayout[node.id]
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
        node.x = saved.x
        node.y = saved.y
      }
    }
  } catch { /* file:// may deny storage */ }
  let nodeById = new Map(graph.nodes.map((node) => [node.id, node]))

  function rebuildGraph() {
    const positions = new Map(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]))
    graph = makeNodes()
    for (const node of graph.nodes) {
      const position = positions.get(node.id)
      if (position) { node.x = position.x; node.y = position.y }
    }
    nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  }

  function annotationCount() {
    return annotations.annotations.length
  }

  function revisionData(revision) {
    return revisions.find((candidate) => candidate.revision === Number(revision)) || currentRevisionData
  }

  function variantsFor(layout, revision) {
    return revisionData(revision).variants[layout] || {}
  }

  function validLocalEnvelope(value) {
    if (!value || value.scene_id !== scene.scene_id || !Array.isArray(value.annotations)) return null
    const valid = value.annotations.every((item) => {
      const view = scene.views.find((candidate) => candidate.id === item.view_id)
      return view && item.artifact_hash === view.artifact?.md5 && item.selector && item.instruction
    })
    return valid ? value : null
  }

  if (!liveApi) {
    try {
      annotations = validLocalEnvelope(JSON.parse(localStorage.getItem(storageKey))) || annotations
    } catch { /* ignore malformed browser state */ }
  }
  rebuildGraph()

  function nodeBody(node) {
    if (node.type === 'input') {
      return `<div class="source-name" title="${escapeHtml(payload.run_metadata?.input?.path)}">${escapeHtml(sourcePath())}</div>
        <div class="fact-list">
          <div class="fact-row"><span>输入路线</span><strong>${escapeHtml(payload.run_metadata?.input?.route)}</strong></div>
          <div class="fact-row"><span>Tips</span><strong>${scene.tree.tips}</strong></div>
          <div class="fact-row"><span>内部节点</span><strong>${scene.tree.internal_nodes}</strong></div>
          <div class="fact-row"><span>输入校验</span><code>${shortHash(scene.tree.input.md5)}</code></div>
          ${payload.workspace.metadata_source ? `<div class="fact-row"><span>关联数据</span><strong title="${escapeHtml(payload.workspace.metadata_source)}">${escapeHtml(payload.workspace.metadata_source.split(/[\\/]/).pop())}</strong></div>` : ''}
          <div class="fact-row"><span>根状态</span><strong>${scene.tree.rooted ? '已定根' : '未定根'}</strong></div>
        </div>`
    }
    if (node.type === 'route') {
      const statuses = payload.run_metadata?.intent_status || []
      const rows = statuses.length ? statuses.map((item) => `<div class="intent-row">
        <div><span class="status-dot ${item.status === 'applied' ? '' : 'skipped'}"></span>${escapeHtml(item.goal)}</div>
        <div class="intent-note">${escapeHtml(item.note)}</div></div>`).join('') : '<div class="intent-note">本轮未配置视觉意图</div>'
      return `<div class="intent-list">${rows}</div>`
    }
    if (node.type === 'tree') {
      const selected = node.variant || 'base'
      const nodeVariants = variantsFor(node.layout, node.revision)
      const source = nodeVariants[selected]?.data_uri || nodeVariants.base?.data_uri
      return `<img class="tree-preview" src="${source}" alt="${escapeHtml(node.layout)} tree revision ${node.revision}">`
    }
    if (node.type === 'draft-feedback') {
      const target = node.annotation.selector?.label
        || (node.annotation.selector?.node ? `clade ${node.annotation.selector.node}`
          : node.annotation.selector?.kind === 'region' ? '框选区域'
            : node.annotation.selector?.kind === 'stroke' ? '自由涂鸦'
              : node.layout)
      return `<div class="action-request"><span>${escapeHtml(target)}</span><blockquote>${escapeHtml(node.annotation.instruction)}</blockquote></div><div class="feedback-actions"><button class="primary-button" data-run-workflow>生成新产物</button><button class="secondary-button" data-feedback-action="open">编辑</button></div>`
    }
    if (node.type === 'draft-plan') {
      return `<div class="action-request"><span>修改要求</span><blockquote>${escapeHtml(node.prompt || '自然语言修改')}</blockquote></div><ul class="action-summary">${node.operations.slice(0, 4).map((operation) => `<li>${escapeHtml(humanizeOperation(operation))}</li>`).join('')}</ul><div class="feedback-actions"><button class="primary-button" data-run-workflow>生成新产物</button></div>`
    }
    if (node.type === 'protocol-action') {
      const statusText = {
        pending: '等待 Agent', claimed: `已由 ${node.action.claim?.agent_id || 'Agent'} 接收`,
        running: `${node.action.claim?.agent_id || 'Agent'} 正在处理`,
        completed: `已生成 ${node.action.outputs?.length || 0} 个产物`, failed: '执行失败',
      }[node.action.status] || node.action.status
      const progress = node.action.progress || {}
      const active = ['pending', 'claimed', 'running'].includes(node.action.status)
      const recentEvents = active
        ? (node.action.events || []).filter((event) => event.type === 'progress').slice(-2)
        : []
      return `<div class="action-request"><span>用户要求</span><blockquote>${escapeHtml(node.action.instruction)}</blockquote></div>${active && progress.preview ? `<img class="agent-preview" src="/api/actions/${node.action.id}/preview?t=${encodeURIComponent(progress.updated || '')}" alt="Agent preview">` : ''}<div class="agent-action-status status-${escapeHtml(node.action.status)}">${node.action.status === 'running' ? '<i></i>' : ''}${escapeHtml(progress.message || statusText)}</div>${Number.isFinite(Number(progress.percent)) && active && node.action.status !== 'pending' ? `<div class="agent-progress"><span style="width:${Math.max(0, Math.min(100, Number(progress.percent)))}%"></span></div>` : ''}${recentEvents.length ? `<ul class="agent-events">${recentEvents.map((event) => `<li>${escapeHtml(event.message)}</li>`).join('')}</ul>` : ''}${node.action.error ? `<p class="feedback-copy">${escapeHtml(node.action.error.message)}</p>` : ''}`
    }
    if (node.type === 'external-artifact') {
      const artifact = node.artifact
      if (artifact.data_uri) {
        return `<img class="tree-preview artifact-image-preview" src="${artifact.data_uri}" alt="${escapeHtml(artifact.label)}">`
      }
      const mediaType = String(artifact.media_type || 'application/octet-stream')
      const text = String(artifact.text || '')
      const lines = text.split(/\r?\n/).filter((line) => line.trim())
      const isTable = mediaType.includes('csv') || mediaType.includes('tab-separated')
      const isCode = mediaType.includes('r-source') || /\.(r|py|js|ts)$/i.test(artifact.label)
      const isTree = mediaType.includes('newick')
      const format = isTable ? (mediaType.includes('tab-separated') ? 'TSV' : 'CSV')
        : isCode ? 'CODE' : isTree ? 'NEWICK' : 'FILE'
      const detail = isTable && lines.length
        ? `${Math.max(0, lines.length - 1)} 行 · ${lines[0].split(mediaType.includes('tab-separated') ? '\t' : ',').length} 列`
        : `${formatBytes(artifact.bytes)} · ${shortHash(artifact.md5)}`
      const preview = isTable
        ? lines.slice(0, 5).join('\n')
        : text.slice(0, isCode ? 1200 : 520)
      return `<div class="artifact-file-body"><div class="artifact-file-meta"><span>${format}</span><small>${escapeHtml(detail)}</small></div>${preview ? `<pre class="${isCode ? 'code-preview' : 'data-preview'}">${escapeHtml(preview)}</pre>` : `<div class="artifact-file-empty">${icon(artifactIconName(artifact))}<span>${escapeHtml(mediaType)}</span></div>`}</div>`
    }
    if (node.type === 'revision-feedback') {
      const items = node.feedbackItems || []
      const operations = node.planOperations || []
      const score = revisionData(node.revision).revision_score?.score
      const instruction = node.instruction || items[0]?.instruction || '生成这一版结果'
      return `<div class="action-request"><span>${operations.some((operation) => operation.op === 'merge-branch') ? '合并要求' : '用户要求'}</span><blockquote>${escapeHtml(instruction)}</blockquote></div>${operations.length ? `<ul class="action-summary">${operations.slice(0, 4).map((operation) => `<li>${escapeHtml(humanizeOperation(operation))}</li>`).join('')}</ul>` : ''}${Number.isFinite(score) ? `<div class="action-score">已完成 · 工作流评分 ${score}</div>` : ''}`
    }
    if (node.type === 'feedback') {
      const applied = (payload.feedback_status?.items || []).filter((item) => item.status === 'applied').length
      return `<div class="feedback-count" data-feedback-count>${annotationCount()}</div>
        <div class="feedback-copy">${applied ? `上一轮已生成 ${applied} 个反馈产物。` : ''}${pendingPlan ? `已准备 ${pendingPlan.operations.length} 个自然语言计划操作。` : ''}点击任意结果节点，选择 tip / clade 并写下修改要求。</div>
        <div class="feedback-actions"><button class="secondary-button" data-feedback-action="open">查看反馈</button><button class="secondary-button" data-feedback-action="export">导出 JSON</button></div>`
    }
    const caveats = payload.caveats || []
    return `<ul class="science-list">${caveats.slice(0, 5).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
  }

  function footerStatus(node) {
    if (node.type.startsWith('draft-')) return '等待生成下游节点'
    if (node.type === 'protocol-action') return {
      pending: '等待 Agent', claimed: 'Agent 已接收', running: 'Agent 正在处理',
      completed: '已完成', failed: '失败',
    }[node.action.status] || node.action.status
    if (node.type === 'revision-feedback') return '已消费动作'
    if (node.type === 'tree' && !node.current) return '历史产物'
    if (node.type === 'external-artifact') {
      if (node.artifact.role === 'reference' || node.artifact.role === 'paper-reference') return '参考输入'
      if (node.artifact.role === 'user-input') return '任务输入'
      if (node.artifact.role === 'agent-output') return '已完成'
      return '已导入'
    }
    return '已完成'
  }

  function exitNodeFullscreen() {
    if (!maximizedNode) return false
    const { article, parent, nextSibling } = maximizedNode
    article.classList.remove('node-maximized')
    article.removeAttribute('data-node-fullscreen')
    const button = article.querySelector('[data-fullscreen-node]')
    if (button) {
      button.innerHTML = icon('maximize')
      button.title = '节点全屏'
      button.setAttribute('aria-label', '节点全屏')
    }
    if (nextSibling?.parentNode === parent) parent.insertBefore(article, nextSibling)
    else parent.appendChild(article)
    maximizedNode = null
    return true
  }

  function toggleNodeFullscreen(article) {
    if (maximizedNode?.article === article) {
      exitNodeFullscreen()
      return
    }
    exitNodeFullscreen()
    maximizedNode = { article, parent: article.parentNode, nextSibling: article.nextSibling }
    document.querySelector('.app-shell').appendChild(article)
    article.classList.add('node-maximized')
    article.setAttribute('data-node-fullscreen', 'true')
    const button = article.querySelector('[data-fullscreen-node]')
    if (button) {
      button.innerHTML = icon('minimize')
      button.title = '退出节点全屏'
      button.setAttribute('aria-label', '退出节点全屏')
      button.focus()
    }
  }

  function renderNodes() {
    exitNodeFullscreen()
    nodeLayer.innerHTML = ''
    for (const node of graph.nodes) {
      const article = document.createElement('article')
      const imageArtifact = node.type === 'external-artifact' && Boolean(node.artifact.data_uri)
      const fileArtifact = node.type === 'external-artifact' && !imageArtifact
      const actionNode = node.type === 'protocol-action'
      article.className = `canvas-node${selectedNodeId === node.id ? ' selected' : ''}${node.type === 'tree' && !node.current ? ' history-node' : ''}${imageArtifact ? ' image-node' : ''}${fileArtifact ? ' file-node' : ''}${actionNode ? ' action-node' : ''}${node.type.startsWith('draft-') ? ' draft-action-node' : ''}`
      article.dataset.nodeId = node.id
      article.style.cssText = `left:${node.x}px;top:${node.y}px;width:${node.w}px;height:${node.h}px;z-index:${selectedNodeId === node.id ? 10 : 2}`
      const canCreateTask = node.type === 'tree' || node.type === 'external-artifact'
      const toolbar = `<div class="node-actions" role="group" aria-label="${escapeHtml(node.title)}节点操作">${canCreateTask ? `<button class="icon-button" type="button" data-edit-node title="创建 Agent 任务" aria-label="创建 Agent 任务">${icon('feedback')}</button>` : ''}<button class="icon-button" type="button" data-fullscreen-node title="节点全屏" aria-label="节点全屏">${icon('maximize')}</button><button class="icon-button" type="button" data-open-node title="打开" aria-label="打开">${icon('open')}</button></div>`
      const footerTone = actionNode && node.action.status === 'failed' ? 'danger'
        : actionNode && ['pending', 'claimed', 'running'].includes(node.action.status) ? 'active'
          : node.type === 'external-artifact' && node.artifact.role !== 'agent-output' ? 'neutral' : 'success'
      const statusMark = footerTone === 'active' ? '<i class="activity-spinner"></i>'
        : footerTone === 'danger' ? '!' : footerTone === 'neutral' ? '•' : '✓'
      const initialInput = node.type === 'external-artifact'
        && ['reference', 'paper-reference', 'user-input'].includes(node.artifact.role)
        && protocolActions.length === 0
      const footerAction = actionNode
        ? '<button type="button" class="activity-link" data-open-run>查看过程</button>'
        : node.type === 'external-artifact' && node.actionId
          ? '<button type="button" class="activity-link" data-open-parent-run>查看过程</button>'
          : initialInput ? '<button type="button" class="activity-link start-task-link" data-start-task>开始任务</button>' : ''
      article.innerHTML = `<header class="node-header" data-drag-handle>
          <span class="node-icon">${icon(nodeIconName(node))}</span><span class="node-title">${escapeHtml(actionNode ? 'Agent 任务' : node.title)}</span>
          <span class="node-kicker">${node.type === 'tree' ? shortHash(revisionData(node.revision).scene.views.find((v) => v.layout === node.layout)?.artifact?.md5) : ''}</span>
        </header>${toolbar}
        <div class="node-body ${node.type === 'tree' || imageArtifact ? 'no-inset' : ''}">${nodeBody(node)}</div>
        <footer class="node-footer"><span class="activity-state ${footerTone}">${statusMark}<span>${escapeHtml(footerStatus(node))}</span></span>${footerAction}</footer>`
      article.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button')) return
        selectedNodeId = node.id
        renderNodes()
      })
      article.querySelector('[data-fullscreen-node]').addEventListener('click', (event) => {
        event.stopPropagation()
        toggleNodeFullscreen(article)
      })
      article.querySelectorAll('[data-open-node]').forEach((button) => button.addEventListener('click', (event) => {
        event.stopPropagation()
        openNode(node)
      }))
      article.querySelector('[data-start-task]')?.addEventListener('click', (event) => {
        event.stopPropagation()
        openNodeComposer(node)
      })
      article.querySelector('[data-open-run]')?.addEventListener('click', (event) => {
        event.stopPropagation()
        void openActionRunDrawer(node)
      })
      article.querySelector('[data-open-parent-run]')?.addEventListener('click', (event) => {
        event.stopPropagation()
        const action = protocolActions.find((candidate) => candidate.id === node.actionId)
        if (action) void openActionRunDrawer({ action })
      })
      article.querySelectorAll('[data-edit-node]').forEach((button) => button.addEventListener('click', (event) => {
        event.stopPropagation()
        if (node.type === 'external-artifact' || node.current) openNodeComposer(node)
        else openView(node.layout, preferredVariant(node.layout, node.revision), node.revision)
      }))
      article.querySelector('.tree-preview')?.addEventListener('dblclick', (event) => {
        event.stopPropagation()
        if (node.type === 'external-artifact') openExternalArtifact(node)
        else openView(node.layout, preferredVariant(node.layout, node.revision), node.revision)
      })
      article.querySelector('[data-drag-handle]').addEventListener('pointerdown', (event) => beginNodeDrag(event, node))
      article.querySelector('[data-feedback-action="open"]')?.addEventListener('click', openFeedbackDrawer)
      article.querySelector('[data-feedback-action="export"]')?.addEventListener('click', exportAnnotations)
      article.querySelectorAll('[data-run-workflow]').forEach((button) => button.addEventListener('click', rerun))
      nodeLayer.appendChild(article)
    }
    const hint = document.querySelector('.canvas-hint')
    if (hint) hint.textContent = protocolActions.length === 0 && workspaceArtifacts.length
      ? '点击任一输入节点的“开始任务”，描述你要生成的第一张图'
      : '拖动空白平移 · 滚轮缩放 · 拖动节点整理'
    updateEdges()
    updateNodeComposerPosition()
  }

  function renderNodeComposer() {
    const composer = document.getElementById('node-composer')
    const node = nodeById.get(composerNodeId)
    if (!node) { composer.hidden = true; return }
    composer.hidden = false
    const selectionLabel = composerSelection?.selector?.kind === 'tip' ? composerSelection.selector.label
      : composerSelection?.selector?.kind === 'clade' ? `clade ${composerSelection.selector.node}`
        : composerSelection?.selector?.kind === 'region' ? '框选区域'
          : composerSelection?.selector?.kind === 'stroke' ? '自由涂鸦' : null
    const sourceTitle = node.layout || node.artifact?.label || '当前产物'
    const contextChoices = workspaceArtifacts.length > 1
      ? `<div class="composer-context-block"><span>任务输入</span><div class="composer-context" aria-label="Agent 输入资源">${workspaceArtifacts.map((artifact) => `<label><input type="checkbox" data-composer-source="${escapeHtml(artifact.id)}" checked><span>${escapeHtml(artifact.label)}</span></label>`).join('')}</div></div>`
      : ''
    composer.innerHTML = `<div class="node-composer-head"><div><strong>新建 Agent 任务</strong><small>来源 · ${escapeHtml(sourceTitle)}</small></div><button type="button" data-composer-close aria-label="关闭">×</button></div>${selectionLabel ? `<button type="button" class="selection-chip" data-composer-clear-selection>${escapeHtml(selectionLabel)} ×</button>` : ''}${contextChoices}<div class="node-composer-surface"><div class="node-composer-row">${node.type === 'tree' ? `<button type="button" class="composer-annotate" data-composer-annotate title="在图上选择区域">${icon('brush')}</button>` : ''}<textarea rows="2" placeholder="告诉 Agent 要完成的具体任务…" id="node-composer-input"></textarea><button type="button" class="composer-send" data-composer-send aria-label="发送">↑</button></div></div><div class="node-composer-footer"><span>${workspaceArtifacts.length || 1} 个上下文资源</span><span>⌘/Ctrl + Enter</span></div>`
    composer.querySelector('[data-composer-close]').addEventListener('click', () => {
      composerNodeId = null; composerSelection = null; renderNodeComposer()
    })
    composer.querySelector('[data-composer-clear-selection]')?.addEventListener('click', () => {
      composerSelection = null; renderNodeComposer()
    })
    composer.querySelector('[data-composer-annotate]')?.addEventListener('click', () => {
      openView(node.layout, preferredVariant(node.layout, node.revision), node.revision)
      annotationMode = 'select'
      draftTarget = { selector: { kind: 'view', point: { x: 0.5, y: 0.5 } }, center: { x: 0.5, y: 0.5 } }
      renderViewDrawer()
    })
    const input = composer.querySelector('#node-composer-input')
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault(); void submitNodeComposer()
      }
    })
    composer.querySelector('[data-composer-send]').addEventListener('click', () => void submitNodeComposer())
    updateNodeComposerPosition()
    input.focus()
  }

  function updateNodeComposerPosition() {
    const composer = document.getElementById('node-composer')
    const node = nodeById.get(composerNodeId)
    if (!node || composer.hidden) return
    const left = camera.x + (node.x + node.w / 2) * camera.zoom
    const top = camera.y + (node.y + node.h) * camera.zoom + 12
    composer.style.left = `${Math.max(220, Math.min(stage.clientWidth - 220, left))}px`
    composer.style.top = `${Math.max(12, Math.min(stage.clientHeight - 300, top))}px`
  }

  function openNodeComposer(node) {
    composerNodeId = node.id
    composerSelection = null
    selectedNodeId = node.id
    renderNodes()
    renderNodeComposer()
  }

  async function submitNodeComposer() {
    const node = nodeById.get(composerNodeId)
    const input = document.querySelector('#node-composer-input')
    const prompt = input?.value.trim()
    if (!node || !prompt) { showToast('请描述想怎么改'); return }
    const send = document.querySelector('[data-composer-send]')
    send.disabled = true
    send.textContent = '…'
    try {
      const source = node.type === 'external-artifact'
        ? node.artifact.action_id
          ? { kind: 'action-artifact', artifact_id: node.artifact.id }
          : { kind: 'workspace-artifact', artifact_id: node.artifact.id }
        : { kind: 'revision-view', revision: node.revision, layout: node.layout }
      const selectedWorkspaceSources = [...document.querySelectorAll('[data-composer-source]:checked')]
        .map((checkbox) => ({ kind: 'workspace-artifact', artifact_id: checkbox.dataset.composerSource }))
      const sources = [source, ...selectedWorkspaceSources]
        .filter((candidate, index, values) => values.findIndex((value) =>
          value.kind === candidate.kind && value.artifact_id === candidate.artifact_id
          && value.revision === candidate.revision && value.layout === candidate.layout) === index)
      const action = await apiFetch('/api/actions', {
        method: 'POST',
        body: JSON.stringify({
          sources,
          instruction: prompt,
          selection: composerSelection?.selector?.kind === 'view'
            ? null : composerSelection?.selector || null,
        }),
      })
      protocolActions.push(action)
      composerNodeId = null
      composerSelection = null
      rebuildGraph()
      renderNodes()
      focusPendingActions()
      showToast('已创建任务，正在启动真实 Agent')
    } catch (error) {
      showToast(`修改失败：${error.message}`)
      send.disabled = false
      send.textContent = '↑'
    }
  }

  function updateEdges() {
    const definitions = '<defs><marker id="workflow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8FB3E8"/></marker></defs>'
    edgeLayer.innerHTML = definitions + graph.edges.map((edge) => {
      const from = nodeById.get(edge.from)
      const to = nodeById.get(edge.to)
      if (!from || !to) return ''
      const start = { x: from.x + from.w, y: from.y + from.h / 2 }
      const end = { x: to.x, y: to.y + to.h / 2 }
      const bend = Math.max(70, Math.abs(end.x - start.x) * .45)
      const path = `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`
      const lineage = edge.label.startsWith('feedback') || edge.label.startsWith('merge')
      const draft = edge.label === 'draft action'
      const agentEdge = edge.label.startsWith('agent')
      const label = edge.label === 'feedback output' ? `<text x="${(start.x + end.x) / 2}" y="${(start.y + end.y) / 2 - 8}" text-anchor="middle" fill="#526176" font-size="10">生成新产物</text>` : edge.label === 'merge output' ? `<text x="${(start.x + end.x) / 2}" y="${(start.y + end.y) / 2 - 8}" text-anchor="middle" fill="#526176" font-size="10">合并产物</text>` : ''
      return `<path d="${path}" fill="none" stroke="${draft ? '#E8A23A' : agentEdge ? '#5B91DF' : lineage ? '#9AB9E6' : '#B4C1D2'}" stroke-width="${lineage || draft || agentEdge ? '1.35' : '1.15'}" stroke-dasharray="${draft ? '6 4' : ''}" marker-end="url(#workflow-arrow)" vector-effect="non-scaling-stroke"/>${draft ? `<text x="${(start.x + end.x) / 2}" y="${(start.y + end.y) / 2 - 8}" text-anchor="middle" fill="#9A6700" font-size="10">待生成动作</text>` : label}`
    }).join('')
  }

  function saveWorkflowLayout() {
    try {
      localStorage.setItem(workflowLayoutKey, JSON.stringify(Object.fromEntries(
        graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
      )))
    } catch { /* browser storage is optional */ }
  }

  function beginNodeDrag(event, node) {
    if (maximizedNode) return
    if (event.button !== 0) return
    event.stopPropagation()
    selectedNodeId = node.id
    draggingNode = { node, pointerId: event.pointerId, sx: event.clientX, sy: event.clientY, x: node.x, y: node.y }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    renderNodes()
  }

  function applyCamera() {
    world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`
    stage.style.backgroundSize = `${26 * camera.zoom}px ${26 * camera.zoom}px`
    stage.style.backgroundPosition = `${camera.x}px ${camera.y}px`
    document.getElementById('zoom-value').textContent = `${Math.round(camera.zoom * 100)}%`
    updateNodeComposerPosition()
  }

  function setZoom(next, point = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }) {
    const zoom = Math.min(1.8, Math.max(.35, next))
    const worldX = (point.x - camera.x) / camera.zoom
    const worldY = (point.y - camera.y) / camera.zoom
    camera.x = point.x - worldX * zoom
    camera.y = point.y - worldY * zoom
    camera.zoom = zoom
    applyCamera()
  }

  function fitNodes(nodes = graph.nodes) {
    if (!nodes.length) { applyCamera(); return }
    const padding = 110
    const left = Math.min(...nodes.map((node) => node.x))
    const top = Math.min(...nodes.map((node) => node.y))
    const right = Math.max(...nodes.map((node) => node.x + node.w))
    const bottom = Math.max(...nodes.map((node) => node.y + node.h))
    const zoom = Math.min(1.1, Math.max(.35, Math.min(
      (stage.clientWidth - padding * 2) / Math.max(1, right - left),
      (stage.clientHeight - padding * 2) / Math.max(1, bottom - top),
    )))
    camera.zoom = zoom
    camera.x = (stage.clientWidth - (right - left) * zoom) / 2 - left * zoom
    camera.y = (stage.clientHeight - (bottom - top) * zoom) / 2 - top * zoom
    applyCamera()
  }

  function openNode(node) {
    if (node.type === 'tree') openView(node.layout, node.variant || 'base', node.revision)
    else if (node.type === 'revision-feedback') openRevisionFeedbackDrawer(node)
    else if (node.type === 'draft-feedback' || node.type === 'draft-plan') openFeedbackDrawer()
    else if (node.type === 'science') openScienceDrawer()
    else if (node.type === 'protocol-action') void openActionRunDrawer(node)
    else if (node.type === 'external-artifact' && node.artifact.data_uri) openExternalArtifact(node)
    else openInfoDrawer(node)
  }

  function sceneView(layout, revision = currentRevision) {
    return revisionData(revision).scene.views.find((view) => view.layout === layout)
  }

  function centerForAnnotation(annotation) {
    const view = scene.views.find((candidate) => candidate.id === annotation.view_id)
    if (!view) return null
    if (annotation.selector.kind === 'view') return annotation.selector.point
    if (annotation.selector.kind === 'region') {
      const region = annotation.selector.region
      return { x: region.x + region.width / 2, y: region.y + region.height / 2 }
    }
    if (annotation.selector.kind === 'stroke') {
      const points = annotation.selector.points
      return points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 })
    }
    if (annotation.selector.kind === 'tip' || annotation.selector.kind === 'clade') {
      return view.nodes.find((node) => node.node === annotation.selector.node)?.artifact_coordinate || null
    }
    return null
  }

  function openExternalArtifact(node) {
    drawerFullscreen = false
    const role = node.artifact.role === 'reference' || node.artifact.role === 'paper-reference'
      ? '参考输入' : node.artifact.role === 'user-input' ? '任务输入' : 'Agent 产物'
    drawer.innerHTML = `<div class="drawer-header"><div class="node-icon">${icon(artifactIconName(node.artifact))}</div><div class="drawer-heading"><h2>${escapeHtml(node.artifact.label)}</h2><p>${role} · ${formatBytes(node.artifact.bytes)} · ${shortHash(node.artifact.md5)}</p></div><div class="drawer-header-actions"><button class="icon-button" data-drawer-task title="创建 Agent 任务" aria-label="创建 Agent 任务">${icon('feedback')}</button><a class="icon-button" href="${node.artifact.data_uri || ''}" download="${escapeHtml(node.artifact.label)}" title="下载" aria-label="下载">${icon('download')}</a><button class="icon-button" data-drawer-fullscreen title="产物面板全屏" aria-label="产物面板全屏">${icon('maximize')}</button><button class="icon-button" data-close title="关闭">${icon('close')}</button></div></div><div class="drawer-canvas"><div class="image-frame"><img src="${node.artifact.data_uri || ''}" alt="${escapeHtml(node.artifact.label)}"></div></div>`
    drawer.querySelector('[data-close]').addEventListener('click', closeDrawer)
    drawer.querySelector('[data-drawer-task]').addEventListener('click', () => {
      closeDrawer()
      setTimeout(() => openNodeComposer(node), 190)
    })
    bindDrawerFullscreen()
    openDrawer({ artifactViewer: true })
  }

  function openView(layout, variant = 'base', revision = payload.workspace.revision) {
    drawerFullscreen = false
    currentLayout = layout
    currentRevision = Number(revision)
    const revisionVariants = variantsFor(layout, currentRevision)
    currentVariant = revisionVariants[variant] ? variant : 'base'
    annotationMode = 'none'
    drawingGesture = null
    draftTarget = currentRevision === payload.workspace.revision
      ? { selector: { kind: 'view', point: { x: 0.5, y: 0.5 } }, center: { x: 0.5, y: 0.5 } }
      : null
    renderViewDrawer()
    openDrawer({ artifactViewer: true })
  }

  function renderViewDrawer() {
    const revision = revisionData(currentRevision)
    const historical = !revision.current
    const view = sceneView(currentLayout, currentRevision)
    const revisionVariants = variantsFor(currentLayout, currentRevision)
    const image = revisionVariants[currentVariant] || revisionVariants.base
    const sceneEnabled = currentVariant === (view.variant || preferredVariant(currentLayout, currentRevision))
    drawer.innerHTML = `<div class="drawer-header">
        <div class="node-icon">${icon('tree')}</div><div class="drawer-heading"><h2>${escapeHtml(currentLayout)} · revision ${currentRevision}</h2><p>${historical ? '历史产物 · 只读' : '当前工作流产物'} · ${escapeHtml(image.path)} · ${shortHash(view.artifact?.md5)}</p></div>
        <div class="drawer-header-actions">${historical ? '' : `<button class="icon-button" data-export title="导出反馈">${icon('download')}</button><button class="icon-button" data-import title="导入反馈">${icon('upload')}</button>`}<button class="icon-button" data-drawer-fullscreen title="产物面板全屏" aria-label="产物面板全屏">${icon('maximize')}</button><button class="icon-button" data-close title="关闭">${icon('close')}</button></div>
      </div>
      <div class="drawer-toolbar"><span class="drawer-view-label">${annotationMode === 'none' ? '推荐成图' : '选择修改范围'}</span><span style="flex:1"></span>${!historical && annotationMode === 'none' ? `<button class="secondary-button" id="toggle-selection-mode">${icon('cursor')} 选择区域</button>` : ''}${!historical && annotationMode !== 'none' ? `<div class="annotation-tools" role="group" aria-label="标注工具"><button class="tool-button ${annotationMode === 'select' ? 'active' : ''}" data-annotation-mode="select" title="智能点选 tip/clade">${icon('cursor')}<span>点选</span></button><button class="tool-button ${annotationMode === 'region' ? 'active' : ''}" data-annotation-mode="region" title="拖动框选区域">${icon('box')}<span>框选</span></button><button class="tool-button ${annotationMode === 'draw' ? 'active' : ''}" data-annotation-mode="draw" title="自由涂鸦">${icon('brush')}<span>画笔</span></button></div><button class="secondary-button" id="finish-selection-mode">完成</button>` : ''}</div>
      <div class="drawer-canvas"><div class="image-frame show-scene mode-${annotationMode}" id="image-frame"><img id="drawer-image" src="${image.data_uri}" alt="${escapeHtml(currentLayout)} tree"><svg class="drawing-layer" id="drawing-layer" viewBox="0 0 1 1" preserveAspectRatio="none"></svg><div class="marker-layer" id="marker-layer"></div></div></div>
      ${historical
        ? `<section class="annotation-panel"><div class="historical-derive"><div><strong>基于这个旧产物继续</strong><p>系统会从 revision ${currentRevision} 自动创建新分支，旧节点保持不变。</p></div><button type="button" class="primary-button" id="derive-from-history">从此节点创建修改</button></div></section>`
        : ''}`
    drawer.querySelector('[data-close]').addEventListener('click', closeDrawer)
    bindDrawerFullscreen()
    drawer.querySelector('[data-export]')?.addEventListener('click', exportAnnotations)
    drawer.querySelector('[data-import]')?.addEventListener('click', () => importInput.click())
    drawer.querySelector('#toggle-selection-mode')?.addEventListener('click', () => {
      annotationMode = 'select'
      draftTarget = { selector: { kind: 'view', point: { x: 0.5, y: 0.5 } }, center: { x: 0.5, y: 0.5 } }
      renderViewDrawer()
    })
    drawer.querySelector('#finish-selection-mode')?.addEventListener('click', () => {
      if (draftTarget && draftTarget.selector.kind !== 'view') composerSelection = structuredClone(draftTarget)
      annotationMode = 'none'
      drawingGesture = null
      closeDrawer()
      renderNodeComposer()
    })
    drawer.querySelectorAll('[data-annotation-mode]').forEach((button) => button.addEventListener('click', () => {
      annotationMode = button.dataset.annotationMode
      drawingGesture = null
      if (annotationMode === 'select') {
        draftTarget = { selector: { kind: 'view', point: { x: 0.5, y: 0.5 } }, center: { x: 0.5, y: 0.5 } }
      }
      renderViewDrawer()
    }))
    const imageFrame = drawer.querySelector('#image-frame')
    imageFrame.addEventListener('pointerdown', onDrawingStart)
    imageFrame.addEventListener('pointermove', onDrawingMove)
    imageFrame.addEventListener('pointerup', onDrawingEnd)
    imageFrame.addEventListener('pointercancel', onDrawingEnd)
    drawer.querySelector('#add-annotation')?.addEventListener('click', addAnnotationFromComposer)
    drawer.querySelector('#instruction-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void addAnnotationFromComposer()
      }
    })
    drawer.querySelector('#target-chip')?.addEventListener('click', () => {
      draftTarget = { selector: { kind: 'view', point: { x: 0.5, y: 0.5 } }, center: { x: 0.5, y: 0.5 } }
      const chip = drawer.querySelector('#target-chip')
      chip.hidden = true
      chip.textContent = ''
      renderDrawingLayer()
    })
    drawer.querySelector('#derive-from-history')?.addEventListener('click', async () => {
      const button = drawer.querySelector('#derive-from-history')
      const branchName = `from-r${currentRevision}-${Date.now().toString(36)}`
      button.disabled = true
      button.textContent = '正在创建分支…'
      try {
        await apiFetch('/api/branches', {
          method: 'POST', body: JSON.stringify({ name: branchName, from_revision: currentRevision }),
        })
        await apiFetch('/api/branches/switch', {
          method: 'POST', body: JSON.stringify({ name: branchName }),
        })
        sessionStorage.setItem('ggtree-air-open-composer-layout', currentLayout)
        location.replace(`/?branch=${encodeURIComponent(branchName)}&t=${Date.now()}`)
      } catch (error) {
        showToast(`无法从历史节点创建分支：${error.message}`)
        button.disabled = false
        button.textContent = '从此节点创建修改'
      }
    })
    renderViewMarkers()
    renderAnnotationList()
  }

  function renderViewMarkers() {
    const layer = drawer.querySelector('#marker-layer')
    const boundVariant = sceneView(currentLayout, currentRevision)?.variant
      || preferredVariant(currentLayout, currentRevision)
    if (!layer || currentVariant !== boundVariant) return
    const revision = revisionData(currentRevision)
    const view = sceneView(currentLayout, currentRevision)
    const sceneMarkers = annotationMode === 'select' ? view.nodes.map((node) => {
      const center = node.artifact_coordinate
      const label = node.kind === 'tip' ? node.label : `clade ${node.node}`
      return `<button type="button" class="scene-marker ${node.kind === 'tip' ? '' : 'internal'}" style="left:${center.x * 100}%;top:${center.y * 100}%" data-scene-node="${node.node}" title="${escapeHtml(label)}"></button>`
    }).join('') : ''
    const annotationMarkers = revision.current ? annotations.annotations.map((annotation, index) => {
      if (annotation.view_id !== view.id) return ''
      const center = centerForAnnotation(annotation)
      if (!center) return ''
      return `<button type="button" class="annotation-marker" style="left:${center.x * 100}%;top:${center.y * 100}%" data-annotation-id="${escapeHtml(annotation.id)}" title="${escapeHtml(annotation.instruction)}">${index + 1}</button>`
    }).join('') : ''
    layer.innerHTML = sceneMarkers + annotationMarkers
    layer.querySelectorAll('[data-scene-node]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation()
      const node = view.nodes.find((candidate) => candidate.node === Number(button.dataset.sceneNode))
      if (!revision.current) {
        showToast(`${node.kind === 'tip' ? node.label : `clade ${node.node}`} · 历史节点只读`)
        return
      }
      chooseTarget(node.selector, node.artifact_coordinate)
    }))
    layer.querySelectorAll('[data-annotation-id]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation()
      const annotation = annotations.annotations.find((item) => item.id === button.dataset.annotationId)
      if (!annotation) return
      chooseTarget(annotation.selector, centerForAnnotation(annotation))
    }))
    renderDrawingLayer()
  }

  function normalizedImagePoint(event) {
    const rect = drawer.querySelector('#drawer-image').getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }

  function onDrawingStart(event) {
    const boundVariant = sceneView(currentLayout, currentRevision)?.variant
      || preferredVariant(currentLayout, currentRevision)
    if (currentRevision !== payload.workspace.revision || currentVariant !== boundVariant
        || annotationMode === 'none' || annotationMode === 'select'
        || event.target.closest('button')) return
    event.preventDefault()
    const point = normalizedImagePoint(event)
    drawingGesture = annotationMode === 'region'
      ? { pointerId: event.pointerId, kind: 'region', start: point, current: point }
      : { pointerId: event.pointerId, kind: 'stroke', points: [point] }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    renderDrawingLayer()
  }

  function onDrawingMove(event) {
    if (!drawingGesture || drawingGesture.pointerId !== event.pointerId) return
    event.preventDefault()
    const point = normalizedImagePoint(event)
    if (drawingGesture.kind === 'region') drawingGesture.current = point
    else {
      const previous = drawingGesture.points.at(-1)
      if (Math.hypot(point.x - previous.x, point.y - previous.y) > 0.004
          && drawingGesture.points.length < 500) drawingGesture.points.push(point)
    }
    renderDrawingLayer()
  }

  function onDrawingEnd(event) {
    if (!drawingGesture || drawingGesture.pointerId !== event.pointerId) return
    event.preventDefault()
    const gesture = drawingGesture
    drawingGesture = null
    if (gesture.kind === 'region') {
      const x = Math.min(gesture.start.x, gesture.current.x)
      const y = Math.min(gesture.start.y, gesture.current.y)
      const width = Math.abs(gesture.current.x - gesture.start.x)
      const height = Math.abs(gesture.current.y - gesture.start.y)
      if (width > 0.01 && height > 0.01) {
        chooseTarget({ kind: 'region', region: { x, y, width, height } },
          { x: x + width / 2, y: y + height / 2 })
      }
    } else if (gesture.points.length >= 2) {
      const center = gesture.points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 })
      center.x /= gesture.points.length
      center.y /= gesture.points.length
      chooseTarget({ kind: 'stroke', points: gesture.points }, center)
    }
    renderDrawingLayer()
  }

  function renderDrawingLayer() {
    const layer = drawer.querySelector('#drawing-layer')
    if (!layer) return
    const view = sceneView(currentLayout, currentRevision)
    const selectors = annotations.annotations
      .filter((annotation) => annotation.view_id === view.id
        && ['region', 'stroke'].includes(annotation.selector.kind))
      .map((annotation) => annotation.selector)
    if (draftTarget && ['region', 'stroke'].includes(draftTarget.selector.kind)) selectors.push(draftTarget.selector)
    if (drawingGesture?.kind === 'region') {
      const x = Math.min(drawingGesture.start.x, drawingGesture.current.x)
      const y = Math.min(drawingGesture.start.y, drawingGesture.current.y)
      selectors.push({ kind: 'region', region: {
        x, y, width: Math.abs(drawingGesture.current.x - drawingGesture.start.x),
        height: Math.abs(drawingGesture.current.y - drawingGesture.start.y),
      } })
    } else if (drawingGesture?.kind === 'stroke') selectors.push({ kind: 'stroke', points: drawingGesture.points })
    layer.innerHTML = selectors.map((selector) => {
      if (selector.kind === 'region') {
        const region = selector.region
        return `<rect x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" rx="0.008" fill="rgba(23,105,224,.08)" stroke="#1769E0" stroke-width="0.004" stroke-dasharray="0.012 0.008"/>`
      }
      const path = selector.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
      return `<path d="${path}" fill="none" stroke="#1769E0" stroke-width="0.007" stroke-linecap="round" stroke-linejoin="round"/>`
    }).join('')
  }

  function chooseTarget(selector, center) {
    draftTarget = { selector: structuredClone(selector), center }
    const chip = drawer.querySelector('#target-chip')
    const label = selector.kind === 'tip' ? selector.label
      : selector.kind === 'clade' ? `clade ${selector.node}`
        : selector.kind === 'region' ? '框选区域'
          : selector.kind === 'stroke' ? '自由涂鸦'
            : '整个产物'
    composerSelection = structuredClone(draftTarget)
    if (chip) {
      chip.hidden = false
      chip.textContent = `${label}  ×`
    }
    drawer.querySelector('#add-annotation')?.removeAttribute('disabled')
    drawer.querySelectorAll('.scene-marker').forEach((marker) => marker.classList.toggle('active', Number(marker.dataset.sceneNode) === selector.node))
    renderDrawingLayer()
    drawer.querySelector('#instruction-input')?.focus()
  }

  function inferFeedbackIntent(instruction, selector) {
    const text = instruction.toLowerCase()
    if (/隐藏|hide|remove/.test(text)) return 'hide'
    if (/标签|命名|label|name/.test(text)) return 'label'
    if (/颜色|着色|color|colour/.test(text)) return 'color'
    if (/对比|比较|compare/.test(text)) return 'compare'
    if (/解释|为什么|explain|why|question/.test(text)) return 'question'
    if (/高亮|突出|highlight|emphas/.test(text)) return 'highlight'
    return selector.kind === 'tip' || selector.kind === 'clade' ? 'highlight' : 'other'
  }

  async function addAnnotationFromComposer() {
    const instruction = drawer.querySelector('#instruction-input').value.trim()
    if (!draftTarget || !instruction) { showToast('请填写修改要求'); return }
    if (draftTarget.selector.kind === 'view' && liveApi) {
      const button = drawer.querySelector('#add-annotation')
      button.disabled = true
      button.textContent = '正在解析动作…'
      try {
        const action = await apiFetch('/api/actions', {
          method: 'POST', body: JSON.stringify({
            sources: [{ kind: 'revision-view', revision: payload.workspace.revision, layout: currentLayout }],
            instruction,
          }),
        })
        protocolActions.push(action)
        drawer.querySelector('#instruction-input').value = ''
        rebuildGraph()
        renderNodes()
        focusPendingActions()
        showToast('已创建任务，正在启动真实 Agent')
      } catch (error) {
        showToast(`无法解析整图修改：${error.message}。可点击具体 tip/clade 后重试。`)
      } finally {
        button.disabled = false
        button.textContent = '添加动作节点'
      }
      return
    }
    if (annotationCount() >= 200) { showToast('单个 revision 最多保存 200 条反馈'); return }
    const view = sceneView(currentLayout, payload.workspace.revision)
    annotations.annotations.push({
      id: crypto.randomUUID?.() || `feedback-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      created: new Date().toISOString(),
      artifact_hash: view.artifact.md5,
      view_id: view.id,
      selector: draftTarget.selector,
      intent: inferFeedbackIntent(instruction, draftTarget.selector),
      instruction,
      preserve: [],
      avoid: [],
    })
    annotations.updated = new Date().toISOString()
    draftTarget = { selector: { kind: 'view', point: { x: 0.5, y: 0.5 } }, center: { x: 0.5, y: 0.5 } }
    drawer.querySelector('#instruction-input').value = ''
    drawer.querySelector('#target-chip').textContent = ''
    drawer.querySelector('#target-chip').hidden = true
    drawer.querySelector('#add-annotation').disabled = false
    persistAnnotations()
    renderViewMarkers()
    renderAnnotationList()
    updateFeedbackCount()
    focusPendingActions()
    showToast('反馈动作节点已创建')
  }

  function renderAnnotationList() {
    const list = drawer.querySelector('#annotation-list')
    if (!list) return
    const items = annotations.annotations.filter((item) => item.view_id === sceneView(currentLayout, payload.workspace.revision)?.id)
    if (!items.length) { list.innerHTML = '<div class="annotation-empty">这个视图还没有反馈。点击图中的 tip / clade 开始。</div>'; return }
    list.innerHTML = items.map((item) => {
      const globalIndex = annotations.annotations.indexOf(item)
      return `<div class="annotation-item"><span class="annotation-number">${globalIndex + 1}</span><span class="annotation-intent">${escapeHtml(item.intent)}</span><span class="annotation-text" title="${escapeHtml(item.instruction)}">${escapeHtml(item.instruction)}</span><button type="button" data-delete-annotation="${escapeHtml(item.id)}" title="删除">${icon('trash')}</button></div>`
    }).join('')
    list.querySelectorAll('[data-delete-annotation]').forEach((button) => button.addEventListener('click', () => {
      annotations.annotations = annotations.annotations.filter((item) => item.id !== button.dataset.deleteAnnotation)
      annotations.updated = new Date().toISOString()
      persistAnnotations()
      renderViewMarkers()
      renderAnnotationList()
      updateFeedbackCount()
    }))
  }

  function updateFeedbackCount() {
    document.querySelectorAll('[data-feedback-count]').forEach((element) => { element.textContent = annotationCount() })
    rerunButton.disabled = annotationCount() === 0 && !pendingPlan
    if (nodeLayer.children.length > 0) {
      rebuildGraph()
      renderNodes()
    }
  }

  function focusPendingActions() {
    const drafts = graph.nodes.filter((node) => node.type.startsWith('draft-'))
    if (!drafts.length) return
    const sourceIds = new Set(drafts.map((node) => node.sourceNodeId))
    const sources = graph.nodes.filter((node) => sourceIds.has(node.id))
    requestAnimationFrame(() => fitNodes([...sources, ...drafts]))
  }

  async function apiFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'content-type': 'application/json', 'x-ggtree-air-token': apiToken, ...(options.headers || {}) },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`)
    return body
  }

  function persistAnnotations() {
    try { localStorage.setItem(storageKey, JSON.stringify(annotations)) } catch { /* file:// may deny storage */ }
    if (!liveApi) return Promise.resolve(annotations)
    const snapshot = structuredClone(annotations)
    savePromise = savePromise.catch(() => undefined).then(async () => {
      try {
        annotations = await apiFetch('/api/annotations', {
          method: 'PUT', body: JSON.stringify(snapshot),
        })
        return annotations
      } catch (error) {
        showToast(`后端保存失败：${error.message}`)
        return annotations
      }
    })
    return savePromise
  }

  function exportAnnotations() {
    const blob = new Blob([`${JSON.stringify(annotations, null, 2)}\n`], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'annotations.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    showToast('已导出 annotations.json')
  }

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0]
    if (!file) return
    try {
      const value = validLocalEnvelope(JSON.parse(await file.text()))
      if (!value) throw new Error('scene 或 artifact hash 不匹配')
      annotations = value
      await persistAnnotations()
      updateFeedbackCount()
      if (currentLayout) { renderViewMarkers(); renderAnnotationList() }
      showToast(`已导入 ${annotationCount()} 条反馈`)
    } catch (error) { showToast(`导入失败：${error.message}`) }
    importInput.value = ''
  })

  async function openActionRunDrawer(node) {
    const action = node.action
    drawer.dataset.actionId = action.id
    const processEvents = (action.events || []).filter((event) => ['created', 'claimed', 'running', 'progress', 'completed', 'failed', 'interrupted'].includes(event.type))
    drawer.innerHTML = `<div class="drawer-header"><div class="node-icon">${icon('feedback')}</div><div class="drawer-heading"><h2>Agent 运行过程</h2><p>${escapeHtml(action.claim?.agent_id || '等待 Agent')} · ${escapeHtml(action.status)}</p></div><div class="drawer-header-actions"><button class="icon-button" data-close>${icon('close')}</button></div></div><div class="info-drawer"><section class="info-section"><h3>用户要求</h3><p>${escapeHtml(action.instruction)}</p></section><section class="info-section"><h3>过程</h3><ol class="agent-process-list">${processEvents.map((event) => `<li><time>${escapeHtml(new Date(event.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</time><span>${escapeHtml(event.message)}</span></li>`).join('')}</ol></section><section class="info-section"><h3>详细工具日志</h3><div id="agent-run-activity"><p>正在读取 Agent 日志…</p></div></section></div>`
    drawer.querySelector('[data-close]').addEventListener('click', closeDrawer)
    openDrawer()
    try {
      const response = await apiFetch(`/api/actions/${action.id}/log`)
      if (drawer.dataset.actionId !== action.id) return
      const activity = response.activity || []
      drawer.querySelector('#agent-run-activity').innerHTML = activity.length
        ? `<div class="agent-run-log">${activity.map((entry) => `<article class="agent-log-entry ${escapeHtml(entry.kind)}"><strong>${escapeHtml(entry.kind === 'tool-call' ? `调用 ${entry.name}` : entry.kind === 'tool-result' ? `${entry.name} 返回` : '警告')}</strong>${entry.input ? `<pre>${escapeHtml(JSON.stringify(entry.input, null, 2))}</pre>` : ''}${entry.text ? `<pre>${escapeHtml(entry.text)}</pre>` : ''}</article>`).join('')}</div>`
        : '<p>这个 Action 尚无 Agent 工具调用记录。</p>'
    } catch (error) {
      if (drawer.dataset.actionId === action.id) drawer.querySelector('#agent-run-activity').innerHTML = `<p>日志读取失败：${escapeHtml(error.message)}</p>`
    }
  }

  function openRevisionFeedbackDrawer(node) {
    const items = node.feedbackItems || []
    const operations = node.planOperations || []
    const revision = revisionData(node.revision)
    const score = revision.revision_score
    const diff = revision.revision_diff
    drawer.innerHTML = `<div class="drawer-header"><div class="node-icon">${icon('feedback')}</div><div class="drawer-heading"><h2>反馈 · revision ${node.revision}</h2><p>这个节点记录从上一版产物到新产物的修改指令</p></div><div class="drawer-header-actions"><button class="icon-button" data-close>${icon('close')}</button></div></div><div class="info-drawer"><section class="info-section"><h3>已消费的反馈</h3>${items.length ? `<ol>${items.map((item) => `<li><strong>${escapeHtml(item.intent)}</strong> · ${escapeHtml(item.selector?.label || item.selector?.kind)} — ${escapeHtml(item.instruction)}</li>`).join('')}</ol>` : '<p>没有结构化图上反馈。</p>'}</section>${node.instruction ? `<section class="info-section"><h3>原始修改要求</h3><p>“${escapeHtml(node.instruction)}”</p></section>` : ''}${operations.length ? `<section class="info-section"><h3>系统执行了</h3><ul>${operations.map((operation) => `<li>${escapeHtml(humanizeOperation(operation))}</li>`).join('')}</ul><details><summary>查看技术详情</summary><pre>${escapeHtml(JSON.stringify(operations, null, 2))}</pre></details></section>` : ''}${score ? `<section class="info-section"><h3>Revision 工作流评分：${score.score}</h3><p>${escapeHtml(score.interpretation)}</p><p>应用 ${score.metrics.feedback_applied} · 延后 ${score.metrics.feedback_deferred} · 跳过 ${score.metrics.feedback_skipped} · 变化视图 ${score.metrics.changed_views}</p></section>` : ''}${diff ? `<section class="info-section"><h3>产物差异</h3><ul>${diff.views.map((view) => `<li>${escapeHtml(view.layout)}：${view.changed ? '生成了不同产物' : '内容哈希未变化'}</li>`).join('')}</ul></section>` : ''}<section class="info-section"><p>该反馈节点和上下游产物节点均为历史工作流记录，不会被原位覆盖。</p></section></div>`
    drawer.querySelector('[data-close]').addEventListener('click', closeDrawer)
    openDrawer()
  }

  async function waitForJob(jobId, onProgress = () => undefined) {
    let job = await apiFetch(`/api/jobs/${jobId}`)
    while (!['succeeded', 'failed', 'cancelled'].includes(job.status)) {
      onProgress(job)
      await new Promise((resolve) => setTimeout(resolve, 450))
      job = await apiFetch(`/api/jobs/${jobId}`)
    }
    return job
  }

  function openWorkspacePanel() {
    const inputs = workspaceArtifacts.length
      ? workspaceArtifacts.map((artifact) => `<div class="branch-row"><div><strong>${escapeHtml(artifact.label)}</strong><small>${escapeHtml(artifact.role || 'input')} · ${escapeHtml(artifact.media_type)}</small></div></div>`).join('')
      : '<p class="workspace-loading">尚未导入输入资源。</p>'
    drawer.innerHTML = `<div class="drawer-header"><div class="node-icon">${icon('folder')}</div><div class="drawer-heading"><h2>工作空间</h2><p>真实输入与 Agent 产物</p></div><div class="drawer-header-actions"><button class="icon-button" data-close>${icon('close')}</button></div></div><div class="workspace-panel"><section><h3>当前任务</h3><div class="workspace-current"><strong>${escapeHtml(payload.workspace.title)}</strong><span>${workspaceArtifacts.length} 个输入 · ${protocolActions.length} 次真实 Agent 运行</span></div></section><section><div class="workspace-section-head"><h3>输入资源</h3></div><div class="branch-list">${inputs}</div></section><section class="info-section"><p>平台不会预生成 Demo 或伪造完成历史。节点上提交的要求会创建真实 Action，并由已连接的外部 Agent 执行。</p></section></div>`
    drawer.querySelector('[data-close]').addEventListener('click', closeDrawer)
    openDrawer()
  }

  function openBranchDrawer() {
    const branches = Object.values(payload.workspace.branches || {})
    const current = payload.workspace.current_branch || 'main'
    drawer.innerHTML = `<div class="drawer-header"><div class="node-icon">${icon('branches')}</div><div class="drawer-heading"><h2>工作流分支与合并</h2><p>当前分支 ${escapeHtml(current)} · revision ${payload.workspace.revision}</p></div><div class="drawer-header-actions"><button class="icon-button" data-close>${icon('close')}</button></div></div><div class="info-drawer"><section class="info-section"><h3>创建分支</h3><div class="branch-create"><input id="branch-name" placeholder="例如 experiment-labels"><button class="primary-button" id="branch-create-button">创建</button></div></section><section class="info-section"><h3>分支</h3><div class="branch-list">${branches.map((branch) => `<div class="branch-row"><div><strong>${escapeHtml(branch.name)}</strong><small>head r${branch.head_revision}${branch.name === current ? ' · 当前' : ''}</small></div><div>${branch.name === current ? '' : `<button class="secondary-button" data-switch-branch="${escapeHtml(branch.name)}">切换</button><button class="secondary-button" data-merge-branch="${escapeHtml(branch.name)}">合并到当前</button>`}</div></div>`).join('')}</div></section><section class="info-section"><p>分支共享不可变历史节点。合并会执行三方参数合并并生成一个双父节点 revision；冲突不会被静默覆盖。</p></section></div>`
    drawer.querySelector('[data-close]').addEventListener('click', closeDrawer)
    drawer.querySelector('#branch-create-button').addEventListener('click', async () => {
      const name = drawer.querySelector('#branch-name').value.trim()
      if (!name) return
      try {
        await apiFetch('/api/branches', { method: 'POST', body: JSON.stringify({ name }) })
        showToast(`已创建分支 ${name}`)
        setTimeout(() => location.reload(), 250)
      } catch (error) { showToast(`创建失败：${error.message}`) }
    })
    drawer.querySelectorAll('[data-switch-branch]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const result = await apiFetch('/api/branches/switch', {
          method: 'POST', body: JSON.stringify({ name: button.dataset.switchBranch }),
        })
        location.replace(`/?branch=${encodeURIComponent(result.workspace.current_branch)}&t=${Date.now()}`)
      } catch (error) { showToast(`切换失败：${error.message}`) }
    }))
    drawer.querySelectorAll('[data-merge-branch]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true
      button.textContent = '合并中…'
      try {
        const accepted = await apiFetch('/api/branches/merge', {
          method: 'POST', body: JSON.stringify({ source: button.dataset.mergeBranch, strategy: 'auto' }),
        })
        const job = await waitForJob(accepted.job.id)
        if (job.status !== 'succeeded') throw new Error(job.error?.message || `merge ${job.status}`)
        location.replace(`/?revision=${job.result.revision}&t=${Date.now()}`)
      } catch (error) {
        showToast(`合并失败：${error.message}`)
        button.disabled = false
        button.textContent = '合并到当前'
      }
    }))
    openDrawer()
  }

  function openFeedbackDrawer() {
    drawer.innerHTML = `<div class="drawer-header"><div class="node-icon">${icon('feedback')}</div><div class="drawer-heading"><h2>人类反馈</h2><p>${annotationCount()} 条 · ${escapeHtml(scene.scene_id)}</p></div><div class="drawer-header-actions"><button class="icon-button" data-export>${icon('download')}</button><button class="icon-button" data-import>${icon('upload')}</button><button class="icon-button" data-close>${icon('close')}</button></div></div>
      <div class="info-drawer"><section class="info-section"><h3>闭环状态</h3><p>${liveApi ? '已连接本地后端。反馈会原子写入 annotations.json，并可触发新 revision。' : '当前以离线文件打开。反馈保存在浏览器中，请导出 annotations.json；通过 backend serve 打开可直接回写与重绘。'}</p></section>
      <section class="info-section"><h3>本轮反馈</h3>${annotations.annotations.length ? `<ol>${annotations.annotations.map((item) => `<li><strong>${escapeHtml(item.intent)}</strong> · ${escapeHtml(item.selector.label || item.selector.kind)} — ${escapeHtml(item.instruction)}</li>`).join('')}</ol>` : '<p>尚无反馈。</p>'}</section>
      <section class="info-section"><h3>上一轮应用结果</h3>${feedbackStatusHtml()}</section>
      <div class="feedback-actions"><button class="secondary-button" data-export>导出 JSON</button><button class="secondary-button" data-import>导入 JSON</button></div></div>`
    drawer.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', closeDrawer))
    drawer.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', exportAnnotations))
    drawer.querySelectorAll('[data-import]').forEach((button) => button.addEventListener('click', () => importInput.click()))
    openDrawer()
  }

  function feedbackStatusHtml() {
    const items = payload.feedback_status?.items || []
    if (!items.length) return '<p>这是首轮结果，还没有已应用反馈。</p>'
    return `<ul>${items.map((item) => `<li><strong>${escapeHtml(item.status)}</strong> — ${escapeHtml(item.note)}</li>`).join('')}</ul>`
  }

  function openScienceDrawer() {
    drawer.innerHTML = `<div class="drawer-header"><div class="node-icon">${icon('science')}</div><div class="drawer-heading"><h2>科学解释边界</h2><p>这些约束属于结果的一部分</p></div><div class="drawer-header-actions"><button class="icon-button" data-close>${icon('close')}</button></div></div><div class="info-drawer"><section class="info-section"><h3>解释前必须确认</h3><ul>${(payload.caveats || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section><section class="info-section"><h3>可追溯性</h3><p>输入 <code>${shortHash(scene.tree.input.md5)}</code> · 树 <code>${shortHash(scene.tree.hash)}</code> · scene schema ${escapeHtml(scene.schema_version)}</p></section></div>`
    drawer.querySelector('[data-close]').addEventListener('click', closeDrawer)
    openDrawer()
  }

  function openInfoDrawer(node) {
    const artifactViewer = node.type === 'external-artifact'
    if (artifactViewer) drawerFullscreen = false
    const artifact = node.artifact
    const content = artifactViewer && artifact.text
      ? `<pre class="artifact-text-viewer ${artifactIconName(artifact) === 'code' ? 'code' : ''}">${escapeHtml(artifact.text)}</pre>`
      : `<section class="info-section">${nodeBody(node)}</section>`
    const detail = artifactViewer
      ? `${escapeHtml(artifact.media_type)} · ${formatBytes(artifact.bytes)} · ${shortHash(artifact.md5)}`
      : `运行 revision ${payload.workspace.revision}`
    drawer.innerHTML = `<div class="drawer-header"><div class="node-icon">${icon(artifactViewer ? artifactIconName(artifact) : node.type)}</div><div class="drawer-heading"><h2>${escapeHtml(node.title)}</h2><p>${detail}</p></div><div class="drawer-header-actions">${artifactViewer ? `<button class="icon-button" data-drawer-task title="创建 Agent 任务" aria-label="创建 Agent 任务">${icon('feedback')}</button><button class="icon-button" data-drawer-fullscreen title="产物面板全屏" aria-label="产物面板全屏">${icon('maximize')}</button>` : ''}<button class="icon-button" data-close>${icon('close')}</button></div></div><div class="info-drawer artifact-info-drawer">${content}</div>`
    drawer.querySelector('[data-close]').addEventListener('click', closeDrawer)
    drawer.querySelector('[data-drawer-task]')?.addEventListener('click', () => {
      closeDrawer()
      setTimeout(() => openNodeComposer(node), 190)
    })
    if (artifactViewer) bindDrawerFullscreen()
    openDrawer({ artifactViewer })
  }

  function setDrawerFullscreen(value) {
    drawerFullscreen = Boolean(value)
    drawer.classList.toggle('fullscreen', drawerFullscreen)
    backdrop.classList.toggle('fullscreen', drawerFullscreen)
    drawer.querySelectorAll('[data-drawer-fullscreen]').forEach((button) => {
      button.innerHTML = icon(drawerFullscreen ? 'minimize' : 'maximize')
      button.title = drawerFullscreen ? '退出产物面板全屏' : '产物面板全屏'
      button.setAttribute('aria-label', button.title)
      button.setAttribute('aria-pressed', String(drawerFullscreen))
    })
  }

  function bindDrawerFullscreen() {
    drawer.querySelectorAll('[data-drawer-fullscreen]').forEach((button) => {
      button.addEventListener('click', () => setDrawerFullscreen(!drawerFullscreen))
    })
    setDrawerFullscreen(drawerFullscreen)
  }

  function openDrawer({ artifactViewer = false } = {}) {
    exitNodeFullscreen()
    drawer.classList.toggle('artifact-viewer', artifactViewer)
    if (!artifactViewer) setDrawerFullscreen(false)
    else setDrawerFullscreen(drawerFullscreen)
    drawer.classList.add('open')
    drawer.setAttribute('aria-hidden', 'false')
    backdrop.hidden = false
  }

  function closeDrawer() {
    drawer.classList.remove('open')
    drawer.classList.remove('artifact-viewer')
    setDrawerFullscreen(false)
    drawer.setAttribute('aria-hidden', 'true')
    backdrop.hidden = true
    delete drawer.dataset.actionId
    currentLayout = null
    currentRevision = payload.workspace.revision
    setTimeout(() => { if (!drawer.classList.contains('open')) drawer.innerHTML = '' }, 180)
  }

  function showToast(message) {
    const toast = document.getElementById('toast')
    toast.textContent = message
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600)
  }

  async function rerun() {
    if (activeJobId) {
      rerunButton.disabled = true
      rerunButton.textContent = '正在取消…'
      try {
        await apiFetch(`/api/jobs/${activeJobId}`, { method: 'DELETE' })
      } catch (error) {
        showToast(`取消失败：${error.message}`)
      }
      return
    }
    if (!annotationCount() && !pendingPlan) { showToast('请先添加反馈或自然语言运行计划'); return }
    if (!liveApi) { exportAnnotations(); showToast('离线模式已导出反馈；启动 backend serve 后可生成下游节点'); return }
    rerunButton.disabled = true
    const previous = rerunButton.textContent
    rerunButton.textContent = '正在启动工作流…'
    try {
      await persistAnnotations()
      const accepted = await apiFetch('/api/rerun', { method: 'POST', body: '{}' })
      activeJobId = accepted.job.id
      rerunButton.disabled = false
      rerunButton.textContent = '取消生成'
      let job = accepted.job
      while (!['succeeded', 'failed', 'cancelled'].includes(job.status)) {
        await new Promise((resolve) => setTimeout(resolve, 450))
        job = await apiFetch(`/api/jobs/${activeJobId}`)
        if (job.status === 'running') rerunButton.title = `工作流运行中 · ${job.last_sequence} 个事件`
      }
      if (job.status === 'succeeded') {
        const revision = job.result.workspace.revision
        showToast(`下游 revision ${revision} 节点已生成`)
        setTimeout(() => location.replace(`/?revision=${revision}&t=${Date.now()}`), 350)
        return
      }
      if (job.status === 'cancelled') showToast('已取消生成，当前 revision 保持不变')
      else throw new Error(job.error?.message || '工作流失败')
    } catch (error) {
      showToast(`生成失败：${error.message}`)
    } finally {
      activeJobId = null
      rerunButton.title = ''
      rerunButton.disabled = annotationCount() === 0 && !pendingPlan
      rerunButton.textContent = previous
    }
  }

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('.canvas-node,.canvas-toolbar,.zoom-controls,.node-composer,.right-drawer')) return
    panning = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y }
    stage.classList.add('panning')
    stage.setPointerCapture?.(event.pointerId)
    selectedNodeId = null
    composerNodeId = null
    composerSelection = null
    renderNodes()
    renderNodeComposer()
  })
  window.addEventListener('pointermove', (event) => {
    if (draggingNode && event.pointerId === draggingNode.pointerId) {
      draggingNode.node.x = draggingNode.x + (event.clientX - draggingNode.sx) / camera.zoom
      draggingNode.node.y = draggingNode.y + (event.clientY - draggingNode.sy) / camera.zoom
      const element = nodeLayer.querySelector(`[data-node-id="${draggingNode.node.id}"]`)
      if (element) { element.style.left = `${draggingNode.node.x}px`; element.style.top = `${draggingNode.node.y}px` }
      updateEdges()
    }
    if (panning && event.pointerId === panning.pointerId) {
      camera.x = panning.cx + event.clientX - panning.x
      camera.y = panning.cy + event.clientY - panning.y
      applyCamera()
    }
  })
  window.addEventListener('pointerup', (event) => {
    if (draggingNode?.pointerId === event.pointerId) {
      draggingNode = null
      saveWorkflowLayout()
    }
    if (panning?.pointerId === event.pointerId) { panning = null; stage.classList.remove('panning') }
  })
  stage.addEventListener('wheel', (event) => {
    event.preventDefault()
    const rect = stage.getBoundingClientRect()
    setZoom(camera.zoom * Math.exp(-event.deltaY * .0012), { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }, { passive: false })
  backdrop.addEventListener('click', closeDrawer)
  document.getElementById('zoom-in').addEventListener('click', () => setZoom(camera.zoom * 1.12))
  document.getElementById('zoom-out').addEventListener('click', () => setZoom(camera.zoom / 1.12))
  document.querySelector('[data-tool="fit"]').innerHTML = icon('fit')
  document.querySelector('[data-tool="workspaces"]').innerHTML = icon('folder')
  document.querySelector('[data-tool="fit"]').addEventListener('click', () => fitNodes())
  document.querySelector('[data-tool="workspaces"]').addEventListener('click', () => void openWorkspacePanel())
  rerunButton.addEventListener('click', rerun)
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (maximizedNode) { exitNodeFullscreen(); return }
    if (!drawer.classList.contains('open')) return
    if (drawerFullscreen) setDrawerFullscreen(false)
    else closeDrawer()
  })

  document.getElementById('project-title').textContent = payload.workspace.title
  document.getElementById('project-subtitle').textContent = payload.workspace.subtitle || `revision ${payload.workspace.revision}`
  document.getElementById('run-summary').innerHTML = payload.workspace.kind === 'artifact-canvas'
    ? `<span class="summary-pill">${workspaceArtifacts.length} inputs</span><span class="summary-pill">${protocolActions.length} Agent runs</span>`
    : `<span class="summary-pill">${scene.tree.tips} tips</span><span class="summary-pill">${scene.views.length} layouts</span><span class="summary-pill">${revisions.length} workflow revisions</span><span class="summary-pill">branch: ${escapeHtml(payload.workspace.current_branch || 'main')}</span><span class="summary-pill">${scene.tree.rooted ? 'rooted' : 'unrooted'}</span>`
  const connection = document.getElementById('connection-status')
  connection.textContent = liveApi ? '后端已连接 · 正在检查 Agent' : '离线报告'
  connection.classList.toggle('live', liveApi)
  if (liveApi) {
    apiFetch('/api/agents').then((response) => {
      const available = Boolean(response.selected_agent)
      connection.textContent = available ? 'Agent 已连接' : 'Agent 未连接'
      connection.classList.toggle('live', available)
    }).catch(() => {
      connection.textContent = 'Agent 状态不可用'
      connection.classList.remove('live')
    })
  }
  updateFeedbackCount()
  renderNodes()
  applyCamera()
  try {
    const composerLayout = sessionStorage.getItem('ggtree-air-open-composer-layout')
    if (composerLayout && currentRevisionData.scene.views.some((view) => view.layout === composerLayout)) {
      sessionStorage.removeItem('ggtree-air-open-composer-layout')
      const node = graph.nodes.find((candidate) => candidate.type === 'tree'
        && candidate.revision === payload.workspace.revision && candidate.layout === composerLayout)
      if (node) requestAnimationFrame(() => openNodeComposer(node))
    }
  } catch { /* session storage is optional */ }
  if (liveApi) {
    let actionSnapshot = new Map(protocolActions.map((action) => [action.id, `${action.status}:${action.updated}`]))
    setInterval(async () => {
      try {
        const response = await apiFetch('/api/actions')
        const nextActions = response.actions || []
        const completedChanged = nextActions.some((action) =>
          action.status === 'completed' && !String(actionSnapshot.get(action.id) || '').startsWith('completed:'))
        const changed = nextActions.some((action) => actionSnapshot.get(action.id) !== `${action.status}:${action.updated}`)
          || nextActions.length !== protocolActions.length
        if (changed) {
          protocolActions = nextActions
          actionSnapshot = new Map(nextActions.map((action) => [action.id, `${action.status}:${action.updated}`]))
          rebuildGraph()
          renderNodes()
          if (completedChanged) {
            setTimeout(() => location.replace(`/?activity=${Date.now()}`), 350)
          }
        }
      } catch { /* transient service restarts are tolerated */ }
    }, 800)
    setInterval(async () => {
      if (activeJobId) return
      try {
        const workspace = await apiFetch('/api/workspace')
        if (workspace.revision !== payload.workspace.revision
            || workspace.current_branch !== (payload.workspace.current_branch || 'main')) {
          location.replace(`/?revision=${workspace.revision}&branch=${encodeURIComponent(workspace.current_branch || 'main')}&t=${Date.now()}`)
        }
      } catch { /* transient service restarts are tolerated */ }
    }, 2500)
  }

  requestAnimationFrame(() => {
    const initialNodes = revisions.length > 1
      ? graph.nodes.filter((node) => node.type === 'tree'
          ? node.revision >= payload.workspace.revision - 1
          : node.type.startsWith('draft-')
            || (node.type === 'revision-feedback' && node.revision >= payload.workspace.revision))
      : graph.nodes
    fitNodes(initialNodes)
  })
})()
