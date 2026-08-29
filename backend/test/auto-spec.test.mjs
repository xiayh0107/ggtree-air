import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { inferRunSpec } from '../src/auto-spec.mjs'
import { PROJECT_ROOT } from '../src/paths.mjs'

test('automatic spec inspection chooses bounded layouts and metadata mappings', { timeout: 120_000 }, async () => {
  const inferred = await inferRunSpec({
    dist: path.join(PROJECT_ROOT, 'renderer/r/fixtures/easy_input.dist.tsv'),
    metadata: path.join(PROJECT_ROOT, 'renderer/r/fixtures/group_table.tsv'),
  })
  assert.deepEqual(inferred.spec.layouts, ['rectangular', 'circular'])
  assert.equal(inferred.spec.tip_labels, 'show')
  assert.equal(inferred.spec.tip_column, 'tip')
  assert.equal(inferred.spec.group_column, 'group')
  assert.ok(inferred.spec.intents.includes('tipcolor'))
})
