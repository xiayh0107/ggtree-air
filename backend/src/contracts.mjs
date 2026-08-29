import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { isoNow } from './paths.mjs'

const LAYOUTS = new Set([
  'rectangular', 'roundrect', 'ellipse', 'slanted', 'circular', 'fan',
  'inward_circular', 'radial', 'equal_angle', 'daylight', 'dendrogram', 'ape',
])
const INTENTS = new Set([
  'label', 'branchlen', 'support', 'tipcolor', 'branchcolor', 'circular',
  'hilight', 'hilight_unrooted', 'balance', 'cladelabel', 'strip', 'taxalink',
  'range', 'treescale', 'image', 'explore', 'rotate', 'heatmap', 'msa',
  'facet', 'inset', 'extra', 'manip',
])
const FEEDBACK_INTENTS = new Set(['highlight', 'label', 'color', 'hide', 'compare', 'question', 'other'])

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`)
  return value
}

async function existingFile(value, name) {
  if (value == null) return null
  const absolute = path.resolve(nonEmptyString(value, name))
  const info = await stat(absolute).catch(() => null)
  if (!info?.isFile()) throw new Error(`${name} does not exist or is not a file: ${absolute}`)
  return absolute
}

export async function normalizeRunSpec(input) {
  const sources = ['tree', 'dist', 'fasta'].filter((key) => input[key] != null)
  if (sources.length !== 1) throw new Error('Choose exactly one input: tree, dist, or fasta')
  const source = sources[0]
  const layouts = [...new Set((input.layouts ?? ['rectangular', 'circular']).map(String))]
  if (layouts.length === 0 || layouts.some((layout) => !LAYOUTS.has(layout))) {
    throw new Error(`Unsupported layout. Allowed: ${[...LAYOUTS].join(', ')}`)
  }
  const intents = [...new Set((input.intents ?? ['treescale']).map(String))]
  if (intents.some((intent) => !INTENTS.has(intent))) {
    throw new Error(`Unsupported intent. Allowed: ${[...INTENTS].join(', ')}`)
  }
  const render = {
    width: Number(input.render?.width ?? 10),
    height: Number(input.render?.height ?? 8),
    dpi: Number(input.render?.dpi ?? 180),
    formats: [...new Set((input.render?.formats ?? ['png']).map(String))],
  }
  if (![render.width, render.height, render.dpi].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Render width, height, and dpi must be positive numbers')
  }
  if (render.formats.some((format) => !['png', 'pdf', 'svg'].includes(format))) {
    throw new Error('Render formats may only contain png, pdf, and svg')
  }
  if (!render.formats.includes('png')) render.formats.push('png')

  const sequenceType = String(input.sequence_type ?? 'auto').toLowerCase()
  if (!['auto', 'dna', 'rna', 'protein'].includes(sequenceType)) {
    throw new Error('sequence_type must be auto, dna, rna, or protein')
  }
  const spec = {
    schema_version: '1.0.0',
    tree: source === 'tree' ? await existingFile(input.tree, 'tree') : null,
    dist: source === 'dist' ? await existingFile(input.dist, 'dist') : null,
    fasta: source === 'fasta' ? await existingFile(input.fasta, 'fasta') : null,
    sequence_type: sequenceType,
    groups: await existingFile(input.groups, 'groups'),
    metadata: await existingFile(input.metadata, 'metadata'),
    tip_column: input.tip_column == null ? null : nonEmptyString(input.tip_column, 'tip_column'),
    group_column: input.group_column == null ? null : nonEmptyString(input.group_column, 'group_column'),
    size_column: input.size_column == null ? null : nonEmptyString(input.size_column, 'size_column'),
    shape_column: input.shape_column == null ? null : nonEmptyString(input.shape_column, 'shape_column'),
    heatmap_columns: [...new Set((input.heatmap_columns ?? []).map(String).filter(Boolean))],
    heatmap_width: Number(input.heatmap_width ?? 0.34),
    layout_overrides: input.layout_overrides && typeof input.layout_overrides === 'object'
      ? structuredClone(input.layout_overrides) : {},
    tip_labels: String(input.tip_labels ?? 'auto').toLowerCase(),
    palette: String(input.palette ?? 'colorblind').toLowerCase(),
    plot_theme: String(input.plot_theme ?? 'publication').toLowerCase(),
    repair_tip_labels: Boolean(input.repair_tip_labels),
    layouts,
    intents,
    clade_nodes: (input.clade_nodes ?? []).map(Number).filter(Number.isInteger),
    clade_labels: (input.clade_labels ?? []).map(String).filter(Boolean),
    support_var: input.support_var == null ? null : nonEmptyString(input.support_var, 'support_var'),
    outgroup: (input.outgroup ?? []).map(String).filter(Boolean),
    render,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : 'ggtree-air report',
    subtitle: typeof input.subtitle === 'string' && input.subtitle.trim() ? input.subtitle.trim() : null,
  }
  if (spec.clade_labels.length > 0 && spec.clade_labels.length !== spec.clade_nodes.length) {
    throw new Error('clade_labels must have one value per clade node')
  }
  if (!['auto', 'show', 'hide'].includes(spec.tip_labels)) {
    throw new Error('tip_labels must be auto, show, or hide')
  }
  if (!['colorblind', 'viridis', 'pastel', 'vivid', 'warm', 'cool', 'monochrome'].includes(spec.palette)) {
    throw new Error('palette is not supported')
  }
  if (!['publication', 'minimal', 'compact'].includes(spec.plot_theme)) {
    throw new Error('plot_theme is not supported')
  }
  if (spec.group_column && !spec.groups && !spec.metadata) {
    throw new Error('group_column requires groups or metadata input')
  }
  if (spec.heatmap_columns.length && !spec.metadata) {
    throw new Error('heatmap_columns requires metadata input')
  }
  if (!Number.isFinite(spec.heatmap_width) || spec.heatmap_width < 0.05 || spec.heatmap_width > 0.6) {
    throw new Error('heatmap_width must be between 0.05 and 0.6')
  }
  for (const [layout, override] of Object.entries(spec.layout_overrides)) {
    if (!LAYOUTS.has(layout) || !override || typeof override !== 'object') {
      throw new Error(`invalid layout override: ${layout}`)
    }
    if (override.heatmap_width != null) {
      const width = Number(override.heatmap_width)
      if (!Number.isFinite(width) || width < 0.05 || width > 0.6) {
        throw new Error(`invalid heatmap_width override for ${layout}`)
      }
      override.heatmap_width = width
    }
    if (override.palette != null
        && !['colorblind', 'viridis', 'pastel', 'vivid', 'warm', 'cool', 'monochrome'].includes(override.palette)) {
      throw new Error(`invalid palette override for ${layout}`)
    }
    if (override.plot_theme != null
        && !['publication', 'minimal', 'compact'].includes(override.plot_theme)) {
      throw new Error(`invalid plot_theme override for ${layout}`)
    }
  }
  return spec
}

export async function normalizeRunPlan(input, workspace) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.operations)) {
    throw new Error('run plan must contain an operations array')
  }
  if (Number(input.base_revision) !== workspace.revision) {
    throw new Error(`run plan base_revision must equal current revision ${workspace.revision}`)
  }
  if (input.operations.length === 0 || input.operations.length > 50) {
    throw new Error('run plan must contain 1..50 operations')
  }
  const spec = structuredClone(workspace.spec)
  spec.clade_nodes = Array.isArray(spec.clade_nodes) ? spec.clade_nodes : []
  spec.clade_labels = Array.isArray(spec.clade_labels) ? spec.clade_labels : []
  spec.layout_overrides = spec.layout_overrides && typeof spec.layout_overrides === 'object'
    ? spec.layout_overrides : {}
  if (spec.clade_labels.length === 0 && spec.clade_nodes.length > 0) {
    spec.clade_labels = spec.clade_nodes.map((node) => `clade ${node}`)
  }
  const operations = input.operations.map((operation, index) => {
    if (!operation || typeof operation !== 'object') throw new Error(`operations[${index}] must be an object`)
    switch (operation.op) {
      case 'set-layouts':
        spec.layouts = [...new Set((operation.values ?? []).map(String))]
        return { op: operation.op, values: spec.layouts }
      case 'set-intents':
        spec.intents = [...new Set((operation.values ?? []).map(String))]
        return { op: operation.op, values: spec.intents }
      case 'set-tip-labels':
        spec.tip_labels = String(operation.value)
        return { op: operation.op, value: spec.tip_labels }
      case 'set-heatmap-columns':
        spec.heatmap_columns = [...new Set((operation.values ?? []).map(String))]
        return { op: operation.op, values: spec.heatmap_columns }
      case 'set-heatmap-width': {
        const value = Number(operation.value)
        const layout = operation.layout == null ? null : String(operation.layout)
        if (layout) {
          spec.layout_overrides[layout] = { ...(spec.layout_overrides[layout] || {}), heatmap_width: value }
        } else spec.heatmap_width = value
        return { op: operation.op, value, layout }
      }
      case 'set-palette': {
        const value = String(operation.value)
        const layout = operation.layout == null ? null : String(operation.layout)
        if (layout) spec.layout_overrides[layout] = { ...(spec.layout_overrides[layout] || {}), palette: value }
        else spec.palette = value
        return { op: operation.op, value, layout }
      }
      case 'set-theme': {
        const value = String(operation.value)
        const layout = operation.layout == null ? null : String(operation.layout)
        if (layout) spec.layout_overrides[layout] = { ...(spec.layout_overrides[layout] || {}), plot_theme: value }
        else spec.plot_theme = value
        return { op: operation.op, value, layout }
      }
      case 'add-clade': {
        const node = Number(operation.node)
        if (!Number.isInteger(node)) throw new Error(`operations[${index}].node must be an integer`)
        const label = nonEmptyString(operation.label ?? `clade ${node}`, `operations[${index}].label`)
        const existing = spec.clade_nodes.indexOf(node)
        if (existing < 0) {
          spec.clade_nodes.push(node)
          spec.clade_labels.push(label)
        } else spec.clade_labels[existing] = label
        return { op: operation.op, node, label }
      }
      case 'remove-clade': {
        const node = Number(operation.node)
        const existing = spec.clade_nodes.indexOf(node)
        if (existing >= 0) {
          spec.clade_nodes.splice(existing, 1)
          spec.clade_labels.splice(existing, 1)
        }
        return { op: operation.op, node }
      }
      default:
        throw new Error(`Unsupported run-plan operation: ${operation.op}`)
    }
  })
  const nextSpec = await normalizeRunSpec(spec)
  return {
    schema_version: '1.0.0',
    base_revision: workspace.revision,
    created: isoNow(),
    operations,
    rationale: typeof input.rationale === 'string' ? input.rationale.slice(0, 8000) : null,
    feedback_ids: Array.isArray(input.feedback_ids) ? input.feedback_ids.map(String).slice(0, 200) : [],
    next_spec: nextSpec,
  }
}

export function createAnnotationEnvelope(scene) {
  const now = isoNow()
  return {
    schema_version: '1.0.0',
    scene_id: scene.scene_id,
    created: now,
    updated: now,
    annotations: [],
  }
}

function selectorForScene(selector, view) {
  if (!selector || typeof selector !== 'object') throw new Error('selector must be an object')
  if (!['tip', 'clade', 'edge', 'view', 'region', 'stroke'].includes(selector.kind)) throw new Error('selector.kind is invalid')
  if (selector.kind === 'tip' || selector.kind === 'clade') {
    const node = Number(selector.node)
    const sceneNode = view.nodes.find((candidate) => candidate.node === node)
    if (!sceneNode) throw new Error(`selector node ${selector.node} is absent from ${view.id}`)
    if (selector.kind === 'tip' && sceneNode.kind !== 'tip') throw new Error('tip selector points to an internal node')
    if (selector.kind === 'clade' && sceneNode.kind !== 'internal_node') throw new Error('clade selector points to a tip')
    return { kind: selector.kind, node, label: sceneNode.label ?? null }
  }
  if (selector.kind === 'view') {
    const x = Number(selector.point?.x)
    const y = Number(selector.point?.y)
    if (![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new Error('view selector point must be normalized to [0,1]')
    }
    return { kind: 'view', point: { x, y } }
  }
  if (selector.kind === 'region') {
    const region = {
      x: Number(selector.region?.x), y: Number(selector.region?.y),
      width: Number(selector.region?.width), height: Number(selector.region?.height),
    }
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite)
        || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
        || region.x + region.width > 1 || region.y + region.height > 1) {
      throw new Error('region selector must be a positive normalized rectangle inside [0,1]')
    }
    return { kind: 'region', region }
  }
  if (selector.kind === 'stroke') {
    if (!Array.isArray(selector.points) || selector.points.length < 2 || selector.points.length > 500) {
      throw new Error('stroke selector needs 2..500 normalized points')
    }
    const points = selector.points.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
        || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) {
      throw new Error('stroke points must be normalized to [0,1]')
    }
    return { kind: 'stroke', points }
  }
  const edgeId = nonEmptyString(selector.edge_id, 'selector.edge_id')
  if (!view.edges.some((edge) => edge.id === edgeId)) throw new Error(`edge ${edgeId} is absent from ${view.id}`)
  return { kind: 'edge', edge_id: edgeId }
}

export function normalizeAnnotationEnvelope(input, scene) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('annotations payload must be an object')
  if (input.scene_id !== scene.scene_id) throw new Error('scene_id is stale or belongs to another tree')
  if (!Array.isArray(input.annotations)) throw new Error('annotations must be an array')
  if (input.annotations.length > 200) throw new Error('annotations may contain at most 200 items')
  const seen = new Set()
  const annotations = input.annotations.map((raw, index) => {
    const view = scene.views.find((candidate) => candidate.id === raw.view_id)
    if (!view) throw new Error(`annotations[${index}] references an unknown view`)
    if (raw.artifact_hash !== view.artifact?.md5) throw new Error(`annotations[${index}] artifact hash is stale`)
    const id = typeof raw.id === 'string' && raw.id ? raw.id : randomUUID()
    if (seen.has(id)) throw new Error(`duplicate annotation id: ${id}`)
    seen.add(id)
    const intent = String(raw.intent ?? '')
    if (!FEEDBACK_INTENTS.has(intent)) throw new Error(`annotations[${index}] intent is invalid`)
    const instruction = nonEmptyString(raw.instruction, `annotations[${index}].instruction`).trim()
    if (instruction.length > 4000) throw new Error(`annotations[${index}] instruction is too long`)
    return {
      id,
      created: typeof raw.created === 'string' ? raw.created : isoNow(),
      artifact_hash: raw.artifact_hash,
      view_id: view.id,
      selector: selectorForScene(raw.selector, view),
      intent,
      instruction,
      preserve: Array.isArray(raw.preserve) ? raw.preserve.map(String).filter(Boolean).slice(0, 50) : [],
      avoid: Array.isArray(raw.avoid) ? raw.avoid.map(String).filter(Boolean).slice(0, 50) : [],
    }
  })
  return {
    schema_version: '1.0.0',
    scene_id: scene.scene_id,
    created: typeof input.created === 'string' ? input.created : isoNow(),
    updated: isoNow(),
    annotations,
  }
}
