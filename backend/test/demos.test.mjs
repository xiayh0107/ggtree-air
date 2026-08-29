import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { listPaperDemos } from '../src/demos.mjs'
import { PROJECT_ROOT } from '../src/paths.mjs'

test('built-in demo gallery is grounded in real papers and workflows', async () => {
  const demos = await listPaperDemos()
  assert.deepEqual(demos.map((demo) => demo.id), ['hmp-body-sites'])
  for (const demo of demos) {
    assert.match(demo.paper.doi, /^10\./)
    assert.ok(demo.paper.title.length > 20)
    assert.ok(demo.story.length > 20)
    assert.equal(demo.status, 'verified')
    assert.equal(demo.quality_gate, 'manually-reviewed-4200px')
    assert.ok(demo.actions.length >= 1)
    const image = await readFile(path.join(PROJECT_ROOT, 'examples', demo.reference_asset))
    assert.equal(image.subarray(1, 4).toString(), 'PNG')
    assert.equal(image.readUInt32BE(16), 4200)
    assert.equal(image.readUInt32BE(20), 4200)
    assert.ok(image.byteLength > 1_000_000)
    assert.equal(createHash('sha256').update(image).digest('hex'), demo.recording.output_sha256)
  }
})
