import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { isoNow } from './paths.mjs'

const MAX_EVENTS = 500

export class JobManager {
  #jobs = new Map()

  create(kind, executor) {
    const id = randomUUID()
    const controller = new AbortController()
    const emitter = new EventEmitter()
    emitter.setMaxListeners(100)
    const job = {
      id,
      kind,
      status: 'queued',
      created: isoNow(),
      started: null,
      finished: null,
      result: null,
      error: null,
      events: [],
      controller,
      emitter,
    }
    this.#jobs.set(id, job)
    this.#emit(job, 'queued', { message: 'Job queued' })
    queueMicrotask(async () => {
      if (controller.signal.aborted) {
        job.status = 'cancelled'
        job.finished = isoNow()
        this.#emit(job, 'cancelled', { error: { code: 'JOB_CANCELLED', message: 'Job cancelled' } })
        return
      }
      job.status = 'running'
      job.started = isoNow()
      this.#emit(job, 'running', { message: 'Job started' })
      try {
        job.result = await executor({
          signal: controller.signal,
          progress: (phase, detail = {}) => this.#emit(job, 'progress', { phase, ...detail }),
          log: (message) => this.#emit(job, 'log', { message: String(message) }),
        })
        if (controller.signal.aborted) throw Object.assign(new Error('Job cancelled'), { code: 'JOB_CANCELLED' })
        job.status = 'succeeded'
        job.finished = isoNow()
        this.#emit(job, 'succeeded', { result: job.result })
      } catch (error) {
        job.status = controller.signal.aborted || error?.code === 'JOB_CANCELLED' ? 'cancelled' : 'failed'
        job.finished = isoNow()
        job.error = { code: error?.code || 'JOB_FAILED', message: error?.message || String(error) }
        this.#emit(job, job.status, { error: job.error })
      }
    })
    return this.snapshot(id)
  }

  #emit(job, type, data) {
    const event = {
      sequence: (job.events.at(-1)?.sequence ?? 0) + 1,
      time: isoNow(),
      type,
      data,
    }
    job.events.push(event)
    if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS)
    job.emitter.emit('event', event)
  }

  get(id) {
    return this.#jobs.get(id) || null
  }

  snapshot(id) {
    const job = this.get(id)
    if (!job) return null
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      created: job.created,
      started: job.started,
      finished: job.finished,
      result: job.result,
      error: job.error,
      last_sequence: job.events.at(-1)?.sequence ?? 0,
    }
  }

  events(id, after = 0) {
    const job = this.get(id)
    if (!job) return null
    return job.events.filter((event) => event.sequence > after)
  }

  subscribe(id, listener) {
    const job = this.get(id)
    if (!job) return null
    job.emitter.on('event', listener)
    return () => job.emitter.off('event', listener)
  }

  cancel(id) {
    const job = this.get(id)
    if (!job) return null
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return this.snapshot(id)
    job.controller.abort()
    this.#emit(job, 'cancelling', { message: 'Cancellation requested' })
    return this.snapshot(id)
  }
}
