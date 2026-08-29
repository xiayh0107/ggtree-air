import path from 'node:path'
import { spawn } from 'node:child_process'
import { normalizeRunSpec } from './contracts.mjs'
import { callRWorker } from './r-worker.mjs'
import { createWorkspace, createWorkspaceBranch, listWorkspaceBranches, mergeWorkspaceBranch, refreshWorkspacePresentation, rerunWorkspace, saveNaturalLanguagePlan, saveWorkspacePlan, switchWorkspaceBranch, workspaceSummary } from './workspace.mjs'
import { PROJECT_ROOT, readJson } from './paths.mjs'
import { startWorkspaceServer } from './server.mjs'
import { listRecipes, runRecipe } from './recipes.mjs'
import { openWorkspaceService, readServiceState, registerService, stopWorkspaceService, unregisterService } from './service-manager.mjs'
import { inferRunSpec } from './auto-spec.mjs'
import {
  claimAction, commitActionArtifacts, createAction, failAction, getAction,
  listActions, markActionRunning, updateActionProgress, waitForAction,
} from './actions.mjs'
import { bundledSkillPath, installBundledSkill, listBundledSkills } from './skill-manager.mjs'
import { createPaperDemo, listPaperDemos, openPaperDemo } from './demos.mjs'

const VERSION = '0.5.0'

function usage() {
  console.log(`ggtree-air ${VERSION} — Node orchestration + isolated R renderer

Usage:
  ggtree-air check
  ggtree-air setup-r [--with-msa] [--with-recipes]
  ggtree-air skills list|path|install
  ggtree-air demos list|create|open
  ggtree-air recipes list
  ggtree-air recipes run CASE --out WORKSPACE [--force]
  ggtree-air auto --input TREE_OR_FASTA [--metadata TABLE] [--out WORKSPACE]
  ggtree-air actions create|wait|next|list|show|claim|running|progress|fail ...
  ggtree-air artifacts commit ACTION --workspace WORKSPACE --file OUTPUT [--file OUTPUT]
  ggtree-air run --dist MATRIX --out WORKSPACE [options]
  ggtree-air run --tree TREE --out WORKSPACE [options]
  ggtree-air open --workspace WORKSPACE [--no-browser]
  ggtree-air service status|stop --workspace WORKSPACE
  ggtree-air serve --workspace WORKSPACE [--port 0]
  ggtree-air refresh --workspace WORKSPACE

Run input (exactly one):
  --dist PATH             labeled distance matrix
  --tree PATH             Newick, NEXUS, or PhyloXML
  --fasta PATH            FASTA; optional R MSA packages required

Run options:
  --groups PATH           tip/group table
  --metadata PATH         associated tip metadata table
  --tip-column NAME       metadata taxon id column
  --group-column NAME     metadata grouping column
  --size-column NAME      numeric tip-point size metadata
  --shape-column NAME     categorical tip-point shape metadata
  --heatmap-columns CSV   metadata columns aligned as a heatmap
  --tip-labels MODE       auto,show,hide (default auto)
  --repair-tip-labels     explicitly name missing/duplicate source tips
  --layout CSV            default: rectangular,circular
  --intent CSV            default: treescale
  --clade-nodes CSV       internal node ids
  --clade-labels CSV      labels corresponding to clade node ids
  --support-var NAME      support column
  --sequence-type TYPE    auto,dna,rna,protein (FASTA; default auto)
  --outgroup CSV          explicit outgroup labels
  --format CSV            png,pdf,svg (PNG is always added for the UI)
  --width NUMBER          inches, default 10
  --height NUMBER         inches, default 8
  --dpi NUMBER            default 180
  --title TEXT            workspace/report title
  --subtitle TEXT         optional context
  --out PATH              workspace directory
  --force                 replace a non-empty output directory

Serve options:
  --workspace PATH        generated workspace
  --host 127.0.0.1        loopback only
  --port NUMBER           default 0 (automatically chooses a free port)
`)
}

function parseArgs(tokens, booleans = new Set()) {
  const output = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
    const equals = token.indexOf('=')
    const key = token.slice(2, equals > -1 ? equals : undefined).replaceAll('-', '_')
    if (booleans.has(key)) {
      output[key] = true
      continue
    }
    const value = equals > -1 ? token.slice(equals + 1) : tokens[++index]
    if (value == null || value.startsWith('--')) throw new Error(`--${key.replaceAll('_', '-')} needs a value`)
    output[key] = value
  }
  return output
}

function assertKnownOptions(options, allowed) {
  const unknown = Object.keys(options).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error(`Unknown option(s): ${unknown.map((key) => `--${key.replaceAll('_', '-')}`).join(', ')}`)
}

function csv(value) {
  if (value == null || value === '') return []
  return String(value).split(',').map((item) => item.trim()).filter(Boolean)
}

function numberOption(value, fallback, name) {
  if (value == null) return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`--${name} must be a positive number`)
  return number
}

async function skills(tokens) {
  const [action = 'list', nameOrOption, ...rest] = tokens
  if (action === 'list') {
    console.log(JSON.stringify(listBundledSkills(), null, 2))
    return 0
  }
  if (action === 'path') {
    console.log(bundledSkillPath(nameOrOption && !nameOrOption.startsWith('--') ? nameOrOption : undefined))
    return 0
  }
  if (action === 'install') {
    const args = [nameOrOption, ...rest].filter(Boolean)
    const name = args[0] && !args[0].startsWith('--') ? args.shift() : 'ggtree-phylo'
    const options = parseArgs(args, new Set(['force']))
    assertKnownOptions(options, ['target', 'agent', 'force'])
    console.log(JSON.stringify(await installBundledSkill(name, {
      target: options.target, agent: options.agent || 'pi', force: Boolean(options.force),
    }), null, 2))
    return 0
  }
  throw new Error('skills action must be list, path, or install')
}

async function setupR(tokens) {
  const options = parseArgs(tokens, new Set(['with_msa', 'with_recipes', 'all']))
  assertKnownOptions(options, ['with_msa', 'with_recipes', 'all'])
  const args = [path.join(PROJECT_ROOT, 'renderer', 'r', 'install-dependencies.R')]
  if (options.with_msa || options.all) args.push('--with-msa')
  if (options.with_recipes || options.all) args.push('--with-recipes')
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.env.GGTREE_AIR_RSCRIPT || 'Rscript', args, { stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', resolve)
  })
  if (status !== 0) throw new Error(`R dependency setup failed with exit code ${status}`)
  return check()
}

async function demos(tokens) {
  const [action = 'list', id, ...rest] = tokens
  if (action === 'list') {
    const values = await listPaperDemos()
    console.log(values.map((demo) =>
      `${demo.id.padEnd(20)} ${demo.installed ? 'installed' : 'available'}  ${demo.title}\n${''.padEnd(21)}${demo.paper.authors}, ${demo.paper.journal} ${demo.paper.year} · ${demo.paper.doi}`
    ).join('\n'))
    return 0
  }
  if (!id || !['create', 'open'].includes(action)) {
    throw new Error('Use `demos list`, `demos create ID`, or `demos open ID`')
  }
  const options = parseArgs(rest, new Set(['force', 'no_browser']))
  assertKnownOptions(options, ['force', 'no_browser'])
  const result = action === 'open'
    ? await openPaperDemo(id, {
      force: Boolean(options.force), browser: !options.no_browser,
      onLog: (chunk) => process.stderr.write(chunk),
    })
    : await createPaperDemo(id, {
      force: Boolean(options.force), onLog: (chunk) => process.stderr.write(chunk),
    })
  console.log(JSON.stringify({
    id: result.demo.id, root: result.root, url: result.service?.url || null,
  }, null, 2))
  return 0
}

async function recipes(tokens) {
  const [action = 'list', id, ...rest] = tokens
  if (action === 'list') {
    for (const recipe of await listRecipes()) {
      console.log(`${recipe.id.padEnd(18)} ${recipe.title}`)
      console.log(`${''.padEnd(19)}${recipe.description}`)
    }
    return 0
  }
  if (action !== 'run' || !id) throw new Error('Use `recipes list` or `recipes run CASE --out PATH`')
  const options = parseArgs(rest, new Set(['force']))
  assertKnownOptions(options, ['out', 'force'])
  if (!options.out) throw new Error('--out is required')
  const result = await runRecipe({
    id,
    outputDir: options.out,
    force: Boolean(options.force),
    onLog: (chunk) => process.stderr.write(chunk),
  })
  console.log(`Recipe ${result.recipe.id} created revision ${result.workspace.revision}`)
  console.log(`Open with: ggtree-air open --workspace ${JSON.stringify(path.resolve(options.out))}`)
  return 0
}

async function check() {
  const response = await callRWorker('dependencies.check')
  console.log(`Node orchestrator ${process.version}`)
  console.log('R renderer dependencies')
  console.log('=======================')
  let missing = false
  for (const item of response.packages) {
    const status = item.installed ? 'OK' : item.required ? 'MISSING' : 'optional'
    if (item.required && !item.installed) missing = true
    console.log(`${item.package.padEnd(12)} ${status.padEnd(9)} ${(item.version || '—').padEnd(12)} ${item.feature}`)
  }
  return missing ? 1 : 0
}

function detectedInput(value) {
  const extension = path.extname(value).toLowerCase()
  if (['.fa', '.fasta', '.fna', '.faa', '.fas'].includes(extension)) return { fasta: value }
  if (/\.dist(?:\.|$)|\.matrix(?:\.|$)/i.test(path.basename(value))) return { dist: value }
  return { tree: value }
}

async function auto(tokens) {
  const options = parseArgs(tokens, new Set(['force', 'no_open', 'no_browser', 'repair_tip_labels']))
  assertKnownOptions(options, [
    'input', 'tree', 'dist', 'fasta', 'metadata', 'out', 'title', 'subtitle',
    'sequence_type', 'outgroup', 'force', 'no_open', 'no_browser',
    'repair_tip_labels', 'width', 'height', 'dpi', 'format',
  ])
  const route = options.input ? detectedInput(options.input) : {
    tree: options.tree, dist: options.dist, fasta: options.fasta,
  }
  const inputPath = route.tree || route.dist || route.fasta
  if (!inputPath) throw new Error('--input or one of --tree/--dist/--fasta is required')
  const defaultName = path.basename(inputPath).replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-') || 'phylogeny'
  const root = path.resolve(options.out || path.join('results', defaultName))
  const inferred = await inferRunSpec({
    ...route,
    metadata: options.metadata,
    title: options.title,
    subtitle: options.subtitle,
    sequence_type: options.sequence_type,
    outgroup: csv(options.outgroup),
    repair_tip_labels: Boolean(options.repair_tip_labels),
    render: {
      width: numberOption(options.width, 11, 'width'),
      height: numberOption(options.height, 8, 'height'),
      dpi: numberOption(options.dpi, 180, 'dpi'),
      formats: csv(options.format || 'png'),
    },
  }, { onLog: (chunk) => process.stderr.write(chunk) })
  const workspace = await createWorkspace({
    root, spec: inferred.spec, force: Boolean(options.force),
    onLog: (chunk) => process.stderr.write(chunk),
  })
  console.log(JSON.stringify({
    workspace: root,
    revision: workspace.revision,
    inferred: inferred.decisions,
  }, null, 2))
  if (!options.no_open) {
    const serviceState = await openWorkspaceService(root, { browser: !options.no_browser })
    console.log(`Opened ${serviceState.url}`)
  }
  return 0
}

function extractRepeatedFiles(tokens) {
  const files = []
  const remaining = []
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === '--file') {
      const value = tokens[++index]
      if (!value) throw new Error('--file needs a value')
      files.push(value)
    } else remaining.push(tokens[index])
  }
  return { files, remaining }
}

async function actions(tokens) {
  const [action = 'list', id, ...rest] = tokens
  if (action === 'create') {
    const options = parseArgs([id, ...rest].filter(Boolean))
    assertKnownOptions(options, ['workspace', 'revision', 'layout', 'artifact', 'instruction'])
    if (!options.workspace || !options.instruction) throw new Error('--workspace and --instruction are required')
    const root = path.resolve(options.workspace)
    const source = options.artifact
      ? { kind: 'action-artifact', artifact_id: options.artifact }
      : { kind: 'revision-view', revision: Number(options.revision), layout: options.layout }
    const created = await createAction(root, { source, instruction: options.instruction })
    await refreshWorkspacePresentation(root)
    console.log(JSON.stringify(created, null, 2))
    return 0
  }
  if (['list', 'next', 'wait'].includes(action)) {
    const options = parseArgs([id, ...rest].filter(Boolean), new Set(['json', 'no_claim']))
    assertKnownOptions(options, ['workspace', 'status', 'json', 'timeout', 'agent', 'no_claim'])
    if (!options.workspace) throw new Error('--workspace is required')
    if (action === 'wait') {
      const result = await waitForAction(path.resolve(options.workspace), {
        timeoutMs: Math.max(1, Number(options.timeout || 3600)) * 1000,
        agentId: options.agent || 'external-agent',
        claim: !options.no_claim,
      })
      console.log(JSON.stringify(result, null, 2))
      return result ? 0 : 2
    }
    const values = await listActions(path.resolve(options.workspace), {
      status: action === 'next' ? 'pending' : options.status,
    })
    const result = action === 'next' ? values[0] || null : values
    console.log(options.json || action === 'next' ? JSON.stringify(result, null, 2)
      : values.map((item) => `${item.id}  ${item.status.padEnd(9)}  ${item.instruction}`).join('\n'))
    return result ? 0 : action === 'next' ? 2 : 0
  }
  if (!id) throw new Error(`actions ${action} requires an action id`)
  const options = parseArgs(rest)
  assertKnownOptions(options, ['workspace', 'agent', 'message', 'phase', 'percent', 'preview'])
  if (!options.workspace) throw new Error('--workspace is required')
  const root = path.resolve(options.workspace)
  let result
  if (action === 'show') result = await getAction(root, id)
  else if (action === 'claim') result = await claimAction(root, id, options.agent)
  else if (action === 'running') result = await markActionRunning(root, id, options.agent)
  else if (action === 'progress') result = await updateActionProgress(root, id, {
    phase: options.phase, message: options.message, percent: options.percent,
    preview: options.preview, agentId: options.agent,
  })
  else if (action === 'fail') result = await failAction(root, id, options.message)
  else throw new Error('actions command must be next, list, show, claim, running, progress, or fail')
  if (action !== 'show') await refreshWorkspacePresentation(root)
  console.log(JSON.stringify(result, null, 2))
  return 0
}

async function artifacts(tokens) {
  const [action, id, ...rest] = tokens
  if (action !== 'commit' || !id) throw new Error('Use `artifacts commit ACTION_ID --workspace PATH --file OUTPUT`')
  const extracted = extractRepeatedFiles(rest)
  const options = parseArgs(extracted.remaining)
  assertKnownOptions(options, ['workspace', 'agent'])
  if (!options.workspace || extracted.files.length === 0) {
    throw new Error('--workspace and at least one --file are required')
  }
  const root = path.resolve(options.workspace)
  const result = await commitActionArtifacts(root, id, extracted.files, { agentId: options.agent })
  await refreshWorkspacePresentation(root)
  console.log(JSON.stringify(result, null, 2))
  return 0
}

async function run(tokens) {
  const options = parseArgs(tokens, new Set(['force', 'repair_tip_labels']))
  assertKnownOptions(options, [
    'tree', 'dist', 'fasta', 'groups', 'metadata', 'tip_column', 'group_column',
    'size_column', 'shape_column', 'heatmap_columns', 'tip_labels', 'repair_tip_labels', 'layout', 'intent', 'clade_nodes',
    'clade_labels', 'support_var', 'sequence_type', 'outgroup', 'format', 'width', 'height',
    'dpi', 'title', 'subtitle', 'out', 'force',
  ])
  if (!options.out) throw new Error('--out is required')
  const spec = await normalizeRunSpec({
    tree: options.tree,
    dist: options.dist,
    fasta: options.fasta,
    groups: options.groups,
    metadata: options.metadata,
    tip_column: options.tip_column,
    group_column: options.group_column,
    size_column: options.size_column,
    shape_column: options.shape_column,
    heatmap_columns: csv(options.heatmap_columns),
    tip_labels: options.tip_labels,
    repair_tip_labels: options.repair_tip_labels,
    layouts: csv(options.layout || 'rectangular,circular'),
    intents: csv(options.intent || 'treescale'),
    clade_nodes: csv(options.clade_nodes),
    clade_labels: csv(options.clade_labels),
    support_var: options.support_var,
    sequence_type: options.sequence_type,
    outgroup: csv(options.outgroup),
    render: {
      width: numberOption(options.width, 10, 'width'),
      height: numberOption(options.height, 8, 'height'),
      dpi: numberOption(options.dpi, 180, 'dpi'),
      formats: csv(options.format || 'png'),
    },
    title: options.title,
    subtitle: options.subtitle,
  })
  const root = path.resolve(options.out)
  const workspace = await createWorkspace({
    root,
    spec,
    force: Boolean(options.force),
    onLog: (chunk) => process.stderr.write(chunk),
  })
  console.log(`\n🌱 Workspace revision ${workspace.revision} is ready`)
  console.log(`   Report: ${path.join(root, 'report.html')}`)
  console.log(`   Open:   ggtree-air open --workspace ${JSON.stringify(root)}`)
  return 0
}

async function openWorkspace(tokens) {
  const options = parseArgs(tokens, new Set(['no_browser']))
  assertKnownOptions(options, ['workspace', 'no_browser'])
  if (!options.workspace) throw new Error('--workspace is required')
  const state = await openWorkspaceService(path.resolve(options.workspace), {
    browser: !options.no_browser,
  })
  console.log(JSON.stringify(state, null, 2))
  return 0
}

async function service(tokens) {
  const [action = 'status', ...rest] = tokens
  const options = parseArgs(rest)
  assertKnownOptions(options, ['workspace'])
  if (!options.workspace) throw new Error('--workspace is required')
  const root = path.resolve(options.workspace)
  if (action === 'status') {
    console.log(JSON.stringify(await readServiceState(root) || { status: 'stopped' }, null, 2))
    return 0
  }
  if (action === 'stop') {
    console.log(JSON.stringify(await stopWorkspaceService(root), null, 2))
    return 0
  }
  throw new Error('service action must be status or stop')
}

async function serve(tokens) {
  const options = parseArgs(tokens)
  assertKnownOptions(options, ['workspace', 'host', 'port'])
  if (!options.workspace) throw new Error('--workspace is required')
  const service = await startWorkspaceServer({
    root: path.resolve(options.workspace),
    host: options.host || '127.0.0.1',
    port: options.port == null ? 0 : Number(options.port),
    onLog: (chunk) => process.stderr.write(chunk),
  })
  await registerService(path.resolve(options.workspace), service)
  console.log(`ggtree-air workspace server listening on ${service.url}`)
  console.log('Open this URL to annotate and rerun. Press Ctrl+C to stop.')
  try {
    await new Promise((resolve) => {
      const stop = () => service.server.close(resolve)
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
  } finally {
    await unregisterService(path.resolve(options.workspace))
  }
  return 0
}

async function branch(tokens) {
  const [action, name, ...rest] = tokens
  if (action === 'list') {
    const options = parseArgs([name, ...rest].filter(Boolean))
    assertKnownOptions(options, ['workspace'])
    if (!options.workspace) throw new Error('--workspace is required')
    console.log(JSON.stringify(await listWorkspaceBranches(path.resolve(options.workspace)), null, 2))
    return 0
  }
  if (!['create', 'switch', 'merge'].includes(action) || !name) {
    throw new Error('Use branch list|create|switch|merge')
  }
  const options = parseArgs(rest)
  assertKnownOptions(options, ['workspace', 'strategy', 'from'])
  if (!options.workspace) throw new Error('--workspace is required')
  const root = path.resolve(options.workspace)
  if (action === 'create') {
    const created = await createWorkspaceBranch(root, name, options.from == null ? null : Number(options.from))
    console.log(`Created branch ${created.name} at revision ${created.head_revision}`)
  } else if (action === 'switch') {
    const workspace = await switchWorkspaceBranch(root, name)
    console.log(`Switched to ${workspace.current_branch} at revision ${workspace.revision}`)
  } else {
    const workspace = await mergeWorkspaceBranch(root, name, {
      strategy: options.strategy || 'auto',
      onLog: (chunk) => process.stderr.write(chunk),
    })
    console.log(`Merged ${name} into ${workspace.current_branch} as revision ${workspace.revision}`)
  }
  return 0
}

async function plan(tokens) {
  const [action, ...rest] = tokens
  const options = parseArgs(rest)
  if (action === 'apply') {
    assertKnownOptions(options, ['workspace', 'file'])
    if (!options.workspace || !options.file) throw new Error('--workspace and --file are required')
    const value = await saveWorkspacePlan(path.resolve(options.workspace), await readJson(path.resolve(options.file)))
    console.log(`Validated ${value.operations.length} operation(s) for revision ${value.base_revision}`)
    return 0
  }
  if (action === 'natural') {
    assertKnownOptions(options, ['workspace', 'prompt'])
    if (!options.workspace || !options.prompt) throw new Error('--workspace and --prompt are required')
    const value = await saveNaturalLanguagePlan(path.resolve(options.workspace), options.prompt)
    console.log(JSON.stringify(value, null, 2))
    return 0
  }
  throw new Error('Use `plan natural ...` or `plan apply ...`')
}

async function refresh(tokens) {
  const options = parseArgs(tokens)
  assertKnownOptions(options, ['workspace'])
  if (!options.workspace) throw new Error('--workspace is required')
  const root = path.resolve(options.workspace)
  const workspace = await refreshWorkspacePresentation(root)
  console.log(`Refreshed node-based workflow presentation for revision ${workspace.revision}`)
  return 0
}

async function rerun(tokens) {
  const options = parseArgs(tokens)
  assertKnownOptions(options, ['workspace'])
  if (!options.workspace) throw new Error('--workspace is required')
  const root = path.resolve(options.workspace)
  const workspace = await rerunWorkspace(root, { onLog: (chunk) => process.stderr.write(chunk) })
  console.log(`Revision ${workspace.revision} is ready at ${path.join(root, 'report.html')}`)
  return 0
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...tokens] = argv
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage()
    return 0
  }
  if (command === 'check') return check()
  if (command === 'skills') return skills(tokens)
  if (command === 'setup-r') return setupR(tokens)
  if (command === 'demos') return demos(tokens)
  if (command === 'recipes') return recipes(tokens)
  if (command === 'auto') return auto(tokens)
  if (command === 'actions') return actions(tokens)
  if (command === 'artifacts') return artifacts(tokens)
  if (command === 'run') return run(tokens)
  if (command === 'open') return openWorkspace(tokens)
  if (command === 'service') return service(tokens)
  if (command === 'serve') return serve(tokens)
  if (command === 'plan') return plan(tokens)
  if (command === 'branch') return branch(tokens)
  if (command === 'rerun') return rerun(tokens)
  if (command === 'refresh') return refresh(tokens)
  if (command === 'status') {
    const options = parseArgs(tokens)
    assertKnownOptions(options, ['workspace'])
    if (!options.workspace) throw new Error('--workspace is required')
    console.log(JSON.stringify(await workspaceSummary(path.resolve(options.workspace)), null, 2))
    return 0
  }
  throw new Error(`Unknown command: ${command}`)
}
