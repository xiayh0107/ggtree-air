import { spawn } from 'node:child_process'
import { normalizeRunPlan } from './contracts.mjs'

function unique(values) {
  return [...new Set(values)]
}

function selectedClade(annotations) {
  return [...(annotations?.annotations || [])].reverse()
    .find((annotation) => annotation.selector?.kind === 'clade')?.selector
}

function deterministicOperations(prompt, workspace, annotations, sourceViewId = null) {
  const text = prompt.toLowerCase()
  const layouts = new Set(workspace.spec.layouts || [])
  const intents = new Set(workspace.spec.intents || [])
  const operations = []
  const mentionedLayouts = []
  if (/圆形|环形|circular|circle/.test(text)) mentionedLayouts.push('circular')
  if (/扇形|\bfan\b/.test(text)) mentionedLayouts.push('fan')
  if (/矩形|rectangular/.test(text)) mentionedLayouts.push('rectangular')
  if (/无根|unrooted|daylight/.test(text)) mentionedLayouts.push('daylight')
  if (mentionedLayouts.length) {
    const replacement = /只要|仅保留|only/.test(text)
      ? unique(mentionedLayouts)
      : unique([...layouts, ...mentionedLayouts])
    operations.push({ op: 'set-layouts', values: replacement })
  }

  const sourceLayout = sourceViewId?.replace(/^view:/, '') || null
  if (/色块.*(?:太大|过大)|占据.*(?:注意力|空间)|heatmap.*(?:too large|too wide)|shrink.*heatmap/.test(text)) {
    operations.push({ op: 'set-heatmap-width', value: 0.16, layout: sourceLayout })
  } else if (/色块.*(?:太小|过小)|heatmap.*(?:too small|too narrow)|enlarge.*heatmap/.test(text)) {
    operations.push({ op: 'set-heatmap-width', value: 0.45, layout: sourceLayout })
  }

  if (/配色|颜色.*(?:难看|太丑|不好看)|color\s*(?:scheme|palette)|palette|换.*颜色/.test(text)) {
    let palette = /viridis/.test(text) ? 'viridis'
      : /柔和|淡雅|pastel/.test(text) ? 'pastel'
        : /高对比|鲜明|vivid/.test(text) ? 'vivid'
          : /暖色|warm/.test(text) ? 'warm'
            : /冷色|cool/.test(text) ? 'cool'
              : /黑白|单色|monochrome/.test(text) ? 'monochrome'
                : /色盲|无障碍|color.?blind/.test(text) ? 'colorblind'
                  : ({ colorblind: 'viridis', viridis: 'pastel', pastel: 'vivid', vivid: 'colorblind' }[workspace.spec.palette] || 'colorblind')
    operations.push({ op: 'set-palette', value: palette, layout: sourceLayout })
  }
  if (/更专业|更简洁|美化|publication|minimal|compact/.test(text)) {
    const theme = /紧凑|compact/.test(text) ? 'compact'
      : /极简|minimal|更简洁/.test(text) ? 'minimal' : 'publication'
    operations.push({ op: 'set-theme', value: theme, layout: sourceLayout })
  }

  if (/隐藏.*(?:tip|标签)|hide.*(?:tip|label)/.test(text)) {
    operations.push({ op: 'set-tip-labels', value: 'hide' })
  } else if (/显示.*(?:tip|标签)|show.*(?:tip|label)/.test(text)) {
    operations.push({ op: 'set-tip-labels', value: 'show' })
  }

  if (/bootstrap|posterior|支持度|support/.test(text)) intents.add('support')
  if (/比例尺|树尺|tree.?scale|branch.?length/.test(text)) intents.add('treescale')
  if (/热图|heatmap/.test(text)) intents.add('heatmap')
  if (/分组|group|着色|color.*tip/.test(text)) intents.add('tipcolor')
  if (/高亮|highlight/.test(text)) intents.add('hilight')
  if (/clade.*标签|label.*clade|分支标签/.test(text)) intents.add('cladelabel')
  if (!sameSet(intents, new Set(workspace.spec.intents || []))) {
    operations.push({ op: 'set-intents', values: [...intents] })
  }

  const nodeMatch = prompt.match(/(?:node|节点|clade)\s*[#:]?\s*(\d+)/i)
  const clade = nodeMatch ? { node: Number(nodeMatch[1]) } : selectedClade(annotations)
  if (clade && /高亮|highlight|clade.*标签|label.*clade|命名/.test(text)) {
    const labelMatch = prompt.match(/(?:命名为|叫做|label(?:led)?\s+as)\s*[“"']?([^”"'，,。]+)[”"']?/i)
    operations.push({
      op: 'add-clade',
      node: clade.node,
      label: labelMatch?.[1]?.trim() || clade.label || `clade ${clade.node}`,
    })
  }
  if (nodeMatch && /移除.*(?:clade|分支)|remove.*clade/.test(text)) {
    operations.push({ op: 'remove-clade', node: Number(nodeMatch[1]) })
  }

  const heatmapMatch = prompt.match(/(?:heatmap|热图)(?:列|columns?)?\s*[:：]\s*([\w.,\-\s]+)/i)
  if (heatmapMatch) {
    const values = heatmapMatch[1].split(/[,，\s]+/).filter(Boolean)
    if (values.length) operations.push({ op: 'set-heatmap-columns', values })
  }
  return operations
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every((value) => b.has(value))
}

function callExternalPlanner(command, context, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('External natural-language planner timed out'))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`External planner failed: ${stderr}`))
      else {
        try { resolve(JSON.parse(stdout)) }
        catch { reject(new Error('External planner returned invalid JSON')) }
      }
    })
    child.stdin.end(`${JSON.stringify(context)}\n`)
  })
}

export async function planNaturalLanguage({ prompt, workspace, annotations, scene, source_view_id = null }) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt must be non-empty')
  let operations = deterministicOperations(prompt, workspace, annotations, source_view_id)
  let provider = 'deterministic'
  let rationale = `Parsed bounded visualization operations from: ${prompt.trim()}`
  const externalCommand = process.env.GGTREE_AIR_PLANNER_COMMAND
  if (operations.length === 0 && externalCommand) {
    const external = await callExternalPlanner(externalCommand, {
      schema_version: '1.0.0',
      prompt,
      workspace: { revision: workspace.revision, spec: workspace.spec },
      annotations,
      scene_summary: {
        scene_id: scene.scene_id,
        layouts: scene.views.map((view) => view.layout),
        tips: scene.tree.tips,
        internal_nodes: scene.tree.internal_nodes,
      },
      allowed_operations: [
        'set-layouts', 'set-intents', 'set-tip-labels', 'set-heatmap-columns',
        'set-heatmap-width', 'set-palette', 'set-theme', 'add-clade', 'remove-clade',
      ],
    })
    operations = external.operations || []
    rationale = external.rationale || rationale
    provider = 'external-command'
  }
  if (operations.length === 0) {
    const error = new Error('No safe visualization operation could be resolved from the instruction')
    error.code = 'PLAN_UNRESOLVED'
    throw error
  }
  const plan = await normalizeRunPlan({
    base_revision: workspace.revision,
    operations,
    rationale,
    feedback_ids: (annotations?.annotations || []).map((annotation) => annotation.id),
  }, workspace)
  return { ...plan, provider, prompt: prompt.trim() }
}
