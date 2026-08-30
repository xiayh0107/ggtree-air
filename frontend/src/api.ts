import type { ActionRecord } from './types'

const token = window.__GGTREE_AIR_API_TOKEN__
export const liveApi = typeof token === 'string' && !token.includes('__GGTREE_AIR_')

export async function apiFetch<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-ggtree-air-token': token || '',
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`)
  return body as T
}

export async function listActions(): Promise<ActionRecord[]> {
  const response = await apiFetch<{ actions: ActionRecord[] }>('/api/actions')
  return response.actions || []
}
