import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile, copyFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const R_WORKER_PATH = path.join(PROJECT_ROOT, 'renderer', 'r', 'worker.R')
export const FRONTEND_ROOT = path.join(PROJECT_ROOT, 'frontend')

export async function pathExists(target) {
  try {
    await stat(target)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function readJson(target) {
  return JSON.parse(await readFile(target, 'utf8'))
}

export async function atomicWriteFile(target, content) {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
  await writeFile(temporary, content)
  await rename(temporary, target)
}

export async function atomicWriteJson(target, value) {
  await atomicWriteFile(target, `${JSON.stringify(value, null, 2)}\n`)
}

export async function md5File(target) {
  const content = await readFile(target)
  return createHash('md5').update(content).digest('hex')
}

export async function artifactRecord(target, root, role = 'artifact') {
  const info = await stat(target)
  const extension = path.extname(target).toLowerCase()
  const mediaTypes = new Map([
    ['.html', 'text/html; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'], ['.pdf', 'application/pdf'], ['.svg', 'image/svg+xml'], ['.rds', 'application/octet-stream'],
    ['.txt', 'text/plain; charset=utf-8'], ['.tsv', 'text/tab-separated-values; charset=utf-8'],
    ['.nwk', 'text/x-newick; charset=utf-8'],
  ])
  return {
    path: path.relative(root, target).split(path.sep).join('/'),
    role,
    media_type: mediaTypes.get(extension) ?? 'application/octet-stream',
    bytes: info.size,
    md5: await md5File(target),
  }
}

export function safeWorkspacePath(root, relativePath) {
  const normalizedRoot = path.resolve(root)
  const target = path.resolve(normalizedRoot, relativePath)
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error('Path escapes the workspace root')
  }
  return target
}

export async function listTopLevelArtifacts(root) {
  const names = await readdir(root, { withFileTypes: true })
  return names.filter((entry) => entry.isFile() && entry.name !== 'workspace.json')
    .map((entry) => path.join(root, entry.name))
}

export async function copyFiles(files, destination) {
  await mkdir(destination, { recursive: true })
  for (const source of files) {
    const target = path.join(destination, path.basename(source))
    await copyFile(source, target)
  }
}

export async function moveFiles(files, destination) {
  await mkdir(destination, { recursive: true })
  for (const source of files) {
    const target = path.join(destination, path.basename(source))
    await rm(target, { force: true, recursive: true })
    try {
      await rename(source, target)
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error
      await copyFile(source, target)
      await rm(source, { force: true })
    }
  }
}

export function isoNow() {
  return new Date().toISOString()
}
