import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { PROJECT_ROOT, readJson } from './paths.mjs'
import { normalizeRunSpec } from './contracts.mjs'
import { createWorkspace } from './workspace.mjs'

const EXAMPLE_ROOT = path.join(PROJECT_ROOT, 'examples', 'treedata-book')
const WORKFLOWS_PATH = path.join(EXAMPLE_ROOT, 'workflows.json')
const DATA_ROOT = process.env.GGTREE_AIR_CACHE_DIR
  ? path.resolve(process.env.GGTREE_AIR_CACHE_DIR, 'treedata-book')
  : path.join(os.homedir(), '.cache', 'ggtree-air', 'treedata-book')

async function catalog() {
  const value = await readJson(WORKFLOWS_PATH)
  if (value.schema_version !== '1.0.0' || !Array.isArray(value.recipes)) {
    throw new Error('Unsupported recipe catalog schema')
  }
  return value.recipes
}

export async function listRecipes() {
  return (await catalog()).map(({ id, title, description, source_case }) => ({
    id, title, description, source_case,
  }))
}

function runNodeScript(script, args = [], onLog = () => undefined) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(EXAMPLE_ROOT, script), ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, GGTREE_AIR_EXAMPLE_DATA_DIR: DATA_ROOT },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', onLog)
    child.stderr.on('data', onLog)
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${script} failed with exit code ${code}`)))
  })
}

export async function runRecipe({ id, outputDir, force = false, onLog = process.stderr.write.bind(process.stderr) }) {
  const recipe = (await catalog()).find((candidate) => candidate.id === id)
  if (!recipe) throw new Error(`Unknown recipe: ${id}`)
  await runNodeScript('fetch.mjs', [recipe.source_case], onLog)
  if (recipe.prepare) await runNodeScript(recipe.prepare, [], onLog)
  const input = structuredClone(recipe.spec)
  for (const key of ['tree', 'dist', 'fasta', 'groups', 'metadata']) {
    if (input[key]) input[key] = path.join(DATA_ROOT, input[key])
  }
  input.title = recipe.title
  const spec = await normalizeRunSpec(input)
  const workspace = await createWorkspace({
    root: path.resolve(outputDir), spec, force, onLog,
  })
  return { recipe: { id: recipe.id, title: recipe.title }, workspace }
}
