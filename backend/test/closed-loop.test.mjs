import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeRunSpec } from '../src/contracts.mjs'
import { PROJECT_ROOT, pathExists, readJson } from '../src/paths.mjs'
import { createWorkspace } from '../src/workspace.mjs'
import { startWorkspaceServer } from '../src/server.mjs'

const fixture = path.join(PROJECT_ROOT, 'renderer/r/fixtures/easy_input.dist.tsv')
const groups = path.join(PROJECT_ROOT, 'renderer/r/fixtures/group_table.tsv')

test('annotation API creates a new rendered revision and archives provenance', { timeout: 180_000 }, async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-node-'))
  const root = path.join(parent, 'workspace')
  let service
  try {
    const spec = await normalizeRunSpec({
      dist: fixture, groups, layouts: ['rectangular'], intents: ['treescale'],
      render: { width: 5, height: 4, dpi: 72, formats: ['png'] },
      title: 'closed loop test',
    })
    const first = await createWorkspace({ root, spec })
    assert.equal(first.revision, 1)
    assert.equal(await pathExists(path.join(root, 'report.html')), true)

    service = await startWorkspaceServer({ root, port: 0, agentAdapter: 'none', onLog: () => undefined })
    const report = await (await fetch(service.url)).text()
    assert.match(report, /canvas-stage/)
    assert.doesNotMatch(report, /__GGTREE_AIR_TOKEN_VALUE__/)

    const scene = await (await fetch(`${service.url}/api/scene`)).json()
    const view = scene.views[0]
    const clade = view.nodes.find((node) => node.kind === 'internal_node')
    const envelope = await (await fetch(`${service.url}/api/annotations`)).json()
    envelope.annotations.push({
      id: 'feedback-1', created: new Date().toISOString(),
      artifact_hash: view.artifact.md5, view_id: view.id,
      selector: { kind: 'clade', node: clade.node },
      intent: 'highlight', instruction: 'Highlight this clade in blue', preserve: [], avoid: [],
    })
    const saveResponse = await fetch(`${service.url}/api/annotations`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-ggtree-air-token': service.token },
      body: JSON.stringify(envelope),
    })
    assert.equal(saveResponse.status, 200)

    const rerunResponse = await fetch(`${service.url}/api/rerun`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ggtree-air-token': service.token },
      body: '{}',
    })
    assert.equal(rerunResponse.status, 202)
    const accepted = await rerunResponse.json()
    let job = accepted.job
    for (let attempt = 0; attempt < 240 && !['succeeded', 'failed', 'cancelled'].includes(job.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      job = await (await fetch(`${service.url}/api/jobs/${job.id}`)).json()
    }
    assert.equal(job.status, 'succeeded')
    assert.equal(job.result.workspace.revision, 2)

    const workspace = await readJson(path.join(root, 'workspace.json'))
    const currentAnnotations = await readJson(path.join(root, 'annotations.json'))
    const feedbackStatus = await readJson(path.join(root, 'feedback_status.json'))
    const revisionDiff = await readJson(path.join(root, 'revision_diff.json'))
    const revisionScore = await readJson(path.join(root, 'revision_score.json'))
    assert.equal(workspace.revision, 2)
    assert.equal(currentAnnotations.annotations.length, 0)
    assert.equal(feedbackStatus.items[0].status, 'applied')
    assert.equal(revisionDiff.parent_revision, 1)
    assert.equal(revisionDiff.feedback.applied, 1)
    assert.equal(revisionScore.metrics.feedback_applied, 1)
    assert.ok(revisionScore.score > 0)
    assert.equal(await pathExists(path.join(root, 'applied_annotations.json')), true)
    assert.equal(await pathExists(path.join(root, '.ggtree-air/revisions/r0001/report.html')), true)
    assert.match(await readFile(path.join(root, 'report.html'), 'utf8'), /"revision":2/)

    const noEffectPlan = await fetch(`${service.url}/api/plan`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-ggtree-air-token': service.token },
      body: JSON.stringify({
        base_revision: 2,
        operations: [{ op: 'set-layouts', values: ['rectangular'] }],
      }),
    })
    assert.equal(noEffectPlan.status, 200)
    const noEffectAccepted = await (await fetch(`${service.url}/api/rerun`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ggtree-air-token': service.token },
      body: '{}',
    })).json()
    let noEffectJob = noEffectAccepted.job
    for (let attempt = 0; attempt < 240 && !['succeeded', 'failed', 'cancelled'].includes(noEffectJob.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      noEffectJob = await (await fetch(`${service.url}/api/jobs/${noEffectJob.id}`)).json()
    }
    assert.equal(noEffectJob.status, 'failed')
    assert.match(noEffectJob.error.message, /no visible artifact difference/)
    assert.equal((await (await fetch(`${service.url}/api/workspace`)).json()).revision, 2)
  } finally {
    if (service) await new Promise((resolve) => service.server.close(resolve))
    await rm(parent, { recursive: true, force: true })
  }
})
