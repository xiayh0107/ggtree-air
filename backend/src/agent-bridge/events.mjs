function tag(value) {
  return String(value || '').trim().toLowerCase().replace(/[.\-/\s]+/g, '_')
}

function textFrom(value, depth = 0) {
  if (depth > 5 || value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((item) => textFrom(item, depth + 1)).filter(Boolean).join('\n')
  if (typeof value !== 'object') return String(value)
  for (const key of ['text', 'output', 'result', 'content', 'message', 'delta', 'aggregated_output']) {
    if (value[key] !== undefined) {
      const text = textFrom(value[key], depth + 1)
      if (text) return text
    }
  }
  try { return JSON.stringify(value) } catch { return String(value) }
}

function compactResult(value) {
  return textFrom(value).slice(0, 3000)
}

function piActivity(event, time) {
  if (event.type === 'tool_execution_start') {
    return [{ time, kind: 'tool-call', tool_id: event.toolCallId, name: event.toolName || 'tool', input: event.args || {} }]
  }
  if (event.type === 'tool_execution_end') {
    return [{
      time, kind: 'tool-result', tool_id: event.toolCallId, name: event.toolName || 'tool',
      error: Boolean(event.result?.isError), text: compactResult(event.result?.content || event.result),
    }]
  }
  return []
}

function codexActivity(event, time) {
  const type = tag(event.type || event.event)
  if (!['item_started', 'item_updated', 'item_completed'].includes(type)) return []
  const item = event.item && typeof event.item === 'object' ? event.item : {}
  const kind = tag(item.type || item.kind)
  const completed = type === 'item_completed'
  if (['command_execution', 'command'].includes(kind)) {
    return completed
      ? [{ time, kind: 'tool-result', tool_id: item.id, name: 'command', error: tag(item.status) === 'failed', text: compactResult(item) }]
      : [{ time, kind: 'tool-call', tool_id: item.id, name: 'command', input: { command: item.command || item.input || '' } }]
  }
  if (['mcp_tool_call', 'tool_call', 'function_call', 'web_search'].includes(kind)) {
    const name = item.name || item.tool || (kind === 'web_search' ? 'web_search' : 'tool')
    return completed
      ? [{ time, kind: 'tool-result', tool_id: item.id, name, error: tag(item.status) === 'failed', text: compactResult(item) }]
      : [{ time, kind: 'tool-call', tool_id: item.id, name, input: item.arguments || item.input || item.args || {} }]
  }
  if (['file_change', 'file_write'].includes(kind) && completed) {
    return [{ time, kind: 'tool-result', name: 'file-write', error: false, text: compactResult(item) }]
  }
  return []
}

function claudeActivity(event, time) {
  if (event.type === 'assistant') {
    const blocks = Array.isArray(event.message?.content) ? event.message.content : []
    return blocks.filter((block) => block?.type === 'tool_use').map((block) => ({
      time, kind: 'tool-call', tool_id: block.id, name: block.name || 'tool', input: block.input || {},
    }))
  }
  if (event.type === 'user') {
    const blocks = Array.isArray(event.message?.content) ? event.message.content : []
    return blocks.filter((block) => block?.type === 'tool_result').map((block) => ({
      time, kind: 'tool-result', tool_id: block.tool_use_id, name: block.name || block.tool_use_id || 'tool',
      error: Boolean(block.is_error), text: compactResult(block.content),
    }))
  }
  if (event.type === 'result' && event.is_error) {
    return [{ time, kind: 'warning', text: compactResult(event.result || event.error || event) }]
  }
  return []
}

export function normalizeAgentActivity(event, time) {
  if (!event || typeof event !== 'object') return []
  const pi = piActivity(event, time)
  if (pi.length) return pi
  const codex = codexActivity(event, time)
  if (codex.length) return codex
  return claudeActivity(event, time)
}
