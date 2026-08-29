import test from 'node:test'
import assert from 'node:assert/strict'
import { JobManager } from '../src/jobs.mjs'

async function waitFor(manager, id, terminal = new Set(['succeeded', 'failed', 'cancelled'])) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = manager.snapshot(id)
    if (terminal.has(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('job did not reach a terminal state')
}

test('jobs publish progress and complete', async () => {
  const manager = new JobManager()
  const accepted = manager.create('example', async ({ progress }) => {
    progress('rendering', { percent: 50 })
    return { revision: 2 }
  })
  const job = await waitFor(manager, accepted.id)
  assert.equal(job.status, 'succeeded')
  assert.equal(job.result.revision, 2)
  assert.ok(manager.events(job.id).some((event) => event.type === 'progress'))
})

test('jobs can cancel cooperative work', async () => {
  const manager = new JobManager()
  const accepted = manager.create('example', ({ signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 10_000)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(Object.assign(new Error('cancelled'), { code: 'JOB_CANCELLED' }))
    }, { once: true })
  }))
  await new Promise((resolve) => setTimeout(resolve, 10))
  manager.cancel(accepted.id)
  const job = await waitFor(manager, accepted.id)
  assert.equal(job.status, 'cancelled')
})
