import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { normalizeRunSpec, normalizeRunPlan, createAnnotationEnvelope, normalizeAnnotationEnvelope } from '../src/contracts.mjs'
import { PROJECT_ROOT } from '../src/paths.mjs'
import { listRecipes } from '../src/recipes.mjs'

const fixture = path.join(PROJECT_ROOT, 'renderer/r/fixtures/easy_input.dist.tsv')

test('run specs enforce one input and normalize rendering', async () => {
  await assert.rejects(() => normalizeRunSpec({}), /exactly one input/)
  const spec = await normalizeRunSpec({ dist: fixture, layouts: ['rectangular'], render: { formats: ['pdf'] } })
  assert.equal(spec.dist, fixture)
  assert.deepEqual(spec.render.formats, ['pdf', 'png'])
  assert.equal(spec.title, 'ggtree-air report')
})

test('bounded agent run plans change only allow-listed visualization parameters', async () => {
  const spec = await normalizeRunSpec({ dist: fixture, layouts: ['rectangular'] })
  const plan = await normalizeRunPlan({
    base_revision: 2,
    rationale: 'Add a circular comparison and label a selected clade',
    operations: [
      { op: 'set-layouts', values: ['rectangular', 'circular'] },
      { op: 'add-clade', node: 9, label: 'target clade' },
    ],
  }, { revision: 2, spec })
  assert.deepEqual(plan.next_spec.layouts, ['rectangular', 'circular'])
  assert.deepEqual(plan.next_spec.clade_nodes, [9])
  assert.equal(plan.next_spec.clade_labels[0], 'target clade')
  await assert.rejects(() => normalizeRunPlan({
    base_revision: 2, operations: [{ op: 'replace-input', value: '/tmp/evil' }],
  }, { revision: 2, spec }), /Unsupported run-plan operation/)
})

test('source-backed recipe registry exposes the complex book cases', async () => {
  const recipes = await listRecipes()
  assert.deepEqual(recipes.map((recipe) => recipe.id), ['mammal-traits', 'candida-auris', 'hmp-microbiome', 'salmonella-typhi', 'hpv58'])
})

test('annotation envelopes are bound to scene node and artifact hashes', () => {
  const scene = {
    scene_id: 'tree:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    views: [{
      id: 'view:rectangular', artifact: { md5: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      nodes: [{ node: 1, kind: 'tip', label: 'A' }, { node: 4, kind: 'internal_node', label: null }],
      edges: [],
    }],
  }
  const envelope = createAnnotationEnvelope(scene)
  envelope.annotations.push({
    id: 'a1', artifact_hash: scene.views[0].artifact.md5, view_id: 'view:rectangular',
    selector: { kind: 'clade', node: 4 }, intent: 'highlight', instruction: 'Highlight this clade',
  })
  const normalized = normalizeAnnotationEnvelope(envelope, scene)
  assert.equal(normalized.annotations[0].selector.node, 4)
  const drawn = createAnnotationEnvelope(scene)
  drawn.annotations.push(
    { id: 'region', artifact_hash: scene.views[0].artifact.md5, view_id: 'view:rectangular', selector: { kind: 'region', region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } }, intent: 'highlight', instruction: 'Emphasize this region' },
    { id: 'stroke', artifact_hash: scene.views[0].artifact.md5, view_id: 'view:rectangular', selector: { kind: 'stroke', points: [{ x: 0.1, y: 0.2 }, { x: 0.2, y: 0.3 }] }, intent: 'other', instruction: 'Follow this hand-drawn path' },
  )
  assert.equal(normalizeAnnotationEnvelope(drawn, scene).annotations.length, 2)
  assert.throws(() => normalizeAnnotationEnvelope({ ...envelope, scene_id: 'stale' }, scene), /stale/)
  envelope.annotations[0].artifact_hash = 'cccccccccccccccccccccccccccccccc'
  assert.throws(() => normalizeAnnotationEnvelope(envelope, scene), /artifact hash is stale/)
})
