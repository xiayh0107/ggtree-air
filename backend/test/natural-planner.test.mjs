import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { normalizeRunSpec } from '../src/contracts.mjs'
import { planNaturalLanguage } from '../src/natural-planner.mjs'
import { PROJECT_ROOT } from '../src/paths.mjs'

const fixture = path.join(PROJECT_ROOT, 'renderer/r/fixtures/easy_input.dist.tsv')

test('Chinese natural-language instructions compile to bounded run-plan operations', async () => {
  const spec = await normalizeRunSpec({ dist: fixture, layouts: ['rectangular'], intents: ['treescale'] })
  const workspace = { revision: 3, spec }
  const annotations = {
    annotations: [{ id: 'a1', selector: { kind: 'clade', node: 9, label: null } }],
  }
  const plan = await planNaturalLanguage({
    prompt: '增加圆形布局，隐藏 tip 标签，显示 bootstrap support，并把刚选中的 clade 命名为耐药分支',
    workspace,
    annotations,
    scene: { scene_id: 'tree:test', tree: { tips: 6, internal_nodes: 4 }, views: [{ layout: 'rectangular' }] },
  })
  assert.equal(plan.provider, 'deterministic')
  assert.ok(plan.operations.some((operation) => operation.op === 'set-layouts'
    && operation.values.includes('circular')))
  assert.ok(plan.operations.some((operation) => operation.op === 'set-tip-labels'
    && operation.value === 'hide'))
  assert.ok(plan.operations.some((operation) => operation.op === 'set-intents'
    && operation.values.includes('support')))
  assert.ok(plan.operations.some((operation) => operation.op === 'add-clade'
    && operation.node === 9 && operation.label.includes('耐药分支')))
})

test('plain aesthetic complaints resolve to palette/theme operations', async () => {
  const spec = await normalizeRunSpec({ dist: fixture, palette: 'colorblind' })
  const plan = await planNaturalLanguage({
    prompt: '这个配色太丑了，改得更专业一点',
    workspace: { revision: 1, spec }, annotations: { annotations: [] },
    scene: { scene_id: 'tree:test', tree: { tips: 6, internal_nodes: 4 }, views: [] },
    source_view_id: 'view:rectangular',
  })
  assert.ok(plan.operations.some((operation) => operation.op === 'set-palette'
    && operation.layout === 'rectangular'))
  assert.ok(plan.operations.some((operation) => operation.op === 'set-theme'))
})

test('layout-scoped visual complaints only patch the selected artifact layout', async () => {
  const spec = await normalizeRunSpec({ dist: fixture, heatmap_width: 0.34 })
  const plan = await planNaturalLanguage({
    prompt: '色块太大了，占据了过多的视觉注意力',
    workspace: { revision: 1, spec }, annotations: { annotations: [] },
    scene: { scene_id: 'tree:test', tree: { tips: 6, internal_nodes: 4 }, views: [] },
    source_view_id: 'view:rectangular',
  })
  assert.ok(plan.operations.some((operation) => operation.op === 'set-heatmap-width'
    && operation.layout === 'rectangular' && operation.value < 0.2))
  assert.equal(plan.next_spec.layout_overrides.rectangular.heatmap_width, 0.16)
})

test('unresolved free text is rejected instead of inventing an operation', async () => {
  const spec = await normalizeRunSpec({ dist: fixture })
  await assert.rejects(() => planNaturalLanguage({
    prompt: '让它更有灵魂', workspace: { revision: 1, spec }, annotations: { annotations: [] },
    scene: { scene_id: 'tree:test', tree: { tips: 6, internal_nodes: 4 }, views: [] },
  }), /No safe visualization operation/)
})
