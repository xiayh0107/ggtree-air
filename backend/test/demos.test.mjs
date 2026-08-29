import test from 'node:test'
import assert from 'node:assert/strict'
import { listPaperDemos } from '../src/demos.mjs'

test('built-in demo gallery is grounded in real papers and workflows', async () => {
  const demos = await listPaperDemos()
  assert.deepEqual(demos.map((demo) => demo.id), [
    'associated-data', 'candida-resistance', 'hmp-body-sites', 'typhi-h58',
    'hpv58-lineages',
  ])
  for (const demo of demos) {
    assert.match(demo.paper.doi, /^10\./)
    assert.ok(demo.paper.title.length > 20)
    assert.ok(demo.story.length > 20)
    assert.ok(demo.actions.length >= 1)
  }
})
