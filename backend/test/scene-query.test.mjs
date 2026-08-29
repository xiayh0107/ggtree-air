import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateScenePredicate, pageSceneObjects } from '../src/scene-query.mjs'

const scene = {
  scene_id: 'tree:test',
  views: [{
    id: 'view:rectangular',
    nodes: [
      { node: 1, parent: 4, kind: 'tip', label: 'A', group: 'g1', selector: { kind: 'tip', node: 1, label: 'A' } },
      { node: 2, parent: 4, kind: 'tip', label: 'B', group: 'g2', selector: { kind: 'tip', node: 2, label: 'B' } },
      { node: 3, parent: 5, kind: 'tip', label: 'C', group: 'g1', selector: { kind: 'tip', node: 3, label: 'C' } },
      { node: 4, parent: 5, kind: 'internal_node', label: null, group: null, selector: { kind: 'clade', node: 4 } },
      { node: 5, parent: 5, kind: 'internal_node', label: null, group: null, selector: { kind: 'clade', node: 5 } },
    ],
    edges: [],
  }],
}

test('scene objects are filtered and paginated', () => {
  const page = pageSceneObjects(scene, { view_id: 'view:rectangular', kind: 'tip', group: 'g1', limit: 1 })
  assert.equal(page.total, 2)
  assert.equal(page.objects.length, 1)
  assert.equal(page.next_offset, 1)
})

test('scene predicates resolve descendants without returning the whole scene', () => {
  const result = evaluateScenePredicate(scene, {
    view_id: 'view:rectangular', predicate: { descendants_of: 4, kind: 'tip' },
  })
  assert.equal(result.count, 2)
  assert.deepEqual(result.selectors.map((selector) => selector.node), [1, 2])
})
