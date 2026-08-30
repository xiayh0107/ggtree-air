const CACHE_MS = 5_000
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export class AgentBridgeRegistry {
  constructor(adapters, { preference = ['pi', 'codex', 'claude'] } = {}) {
    this.adapters = new Map()
    for (const adapter of adapters) {
      if (!AGENT_ID.test(adapter.id)) throw new Error(`Invalid Agent adapter id: ${adapter.id}`)
      if (this.adapters.has(adapter.id)) throw new Error(`Duplicate Agent adapter id: ${adapter.id}`)
      this.adapters.set(adapter.id, adapter)
    }
    this.preference = preference.filter((id) => this.adapters.has(id))
    this.cache = null
  }

  get(id) {
    return this.adapters.get(normalizeAgentId(id)) || null
  }

  async list({ refresh = false } = {}) {
    if (!refresh && this.cache?.expires > Date.now()) return structuredClone(this.cache.descriptors)
    const descriptors = await Promise.all([...this.adapters.values()].map(async (adapter) => {
      try { return await adapter.probe() }
      catch (error) {
        return {
          id: adapter.id, label: adapter.label, transport: adapter.id,
          available: false, auth_status: 'unknown', detail: error.message,
        }
      }
    }))
    this.cache = { expires: Date.now() + CACHE_MS, descriptors }
    return structuredClone(descriptors)
  }

  async select(requested = 'auto') {
    const normalized = normalizeAgentId(requested)
    if (normalized === 'none') return null
    const descriptors = await this.list()
    const ids = normalized === 'auto' ? this.preference : [normalized]
    for (const id of ids) {
      const descriptor = descriptors.find((candidate) => candidate.id === id)
      const adapter = this.adapters.get(id)
      if (descriptor?.available && adapter) return { adapter, descriptor }
    }
    return null
  }
}

export function normalizeAgentId(value) {
  const id = String(value || 'auto').trim().toLowerCase()
  if (id === 'claude-code' || id === 'claudecode') return 'claude'
  return id
}
