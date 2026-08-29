function viewById(scene, viewId) {
  const view = scene.views.find((candidate) => candidate.id === viewId)
  if (!view) throw Object.assign(new Error(`Unknown scene view: ${viewId}`), { statusCode: 404 })
  return view
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.min(maximum, Math.max(minimum, number))
}

export function pageSceneObjects(scene, query = {}) {
  const view = viewById(scene, query.view_id || scene.views[0]?.id)
  const kind = query.kind || 'node'
  let objects
  if (kind === 'edge') objects = view.edges
  else {
    objects = view.nodes
    if (kind === 'tip') objects = objects.filter((node) => node.kind === 'tip')
    else if (kind === 'clade' || kind === 'internal_node') {
      objects = objects.filter((node) => node.kind === 'internal_node')
    } else if (kind !== 'node') throw new Error('kind must be node, tip, clade, or edge')
    if (query.group) objects = objects.filter((node) => node.group === query.group)
    if (query.label) {
      const needle = String(query.label).toLowerCase()
      objects = objects.filter((node) => String(node.label || '').toLowerCase().includes(needle))
    }
  }
  const offset = boundedInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = boundedInteger(query.limit, 100, 1, 500)
  return {
    schema_version: '1.0.0',
    scene_id: scene.scene_id,
    view_id: view.id,
    kind,
    total: objects.length,
    offset,
    limit,
    next_offset: offset + limit < objects.length ? offset + limit : null,
    objects: objects.slice(offset, offset + limit),
  }
}

export function evaluateScenePredicate(scene, input = {}) {
  const view = viewById(scene, input.view_id || scene.views[0]?.id)
  const predicate = input.predicate || {}
  let nodes = view.nodes
  if (predicate.kind === 'tip' || predicate.kind === 'clade') {
    nodes = nodes.filter((node) => node.kind === (predicate.kind === 'tip' ? 'tip' : 'internal_node'))
  }
  if (predicate.group != null) nodes = nodes.filter((node) => node.group === String(predicate.group))
  if (predicate.label_contains != null) {
    const needle = String(predicate.label_contains).toLowerCase()
    nodes = nodes.filter((node) => String(node.label || '').toLowerCase().includes(needle))
  }
  if (predicate.node != null) nodes = nodes.filter((node) => node.node === Number(predicate.node))
  if (predicate.descendants_of != null) {
    const root = Number(predicate.descendants_of)
    const children = new Map()
    for (const node of view.nodes) {
      if (node.node === node.parent) continue
      const values = children.get(node.parent) || []
      values.push(node.node)
      children.set(node.parent, values)
    }
    const descendants = new Set()
    const queue = [...(children.get(root) || [])]
    while (queue.length) {
      const node = queue.shift()
      if (descendants.has(node)) continue
      descendants.add(node)
      queue.push(...(children.get(node) || []))
    }
    nodes = nodes.filter((node) => descendants.has(node.node))
  }
  return {
    schema_version: '1.0.0',
    scene_id: scene.scene_id,
    view_id: view.id,
    predicate,
    count: nodes.length,
    selectors: nodes.map((node) => node.selector),
  }
}
