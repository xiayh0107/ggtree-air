#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)))
  })
}

await run(process.execPath, [path.join(root, 'scripts', 'package-runtime.mjs')], { cwd: root })
const tarball = (await readdir(dist)).find((name) => /^ggtree-air-.*\.tgz$/.test(name))
if (!tarball) throw new Error('Runtime tarball was not created')
const prefix = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-package-'))
try {
  await run('npm', ['install', '--prefix', prefix, path.join(dist, tarball), '--ignore-scripts'], { cwd: root })
  const binary = path.join(prefix, 'node_modules', '.bin', 'ggtree-air')
  await run(binary, ['--help'], { cwd: prefix })
  await run(binary, ['check'], { cwd: prefix })
  const workspace = path.join(prefix, 'workspace')
  await run(binary, ['workspace', 'create', '--out', workspace, '--title', 'package smoke'], { cwd: prefix })
  const report = await readFile(path.join(workspace, 'report.html'), 'utf8')
  if (!report.includes('window.__GGTREE_AIR_PAYLOAD__') || !report.includes('react-flow')) {
    throw new Error('installed package did not generate the compiled React canvas report')
  }
  console.log('installed-package smoke test passed')
} finally {
  await rm(prefix, { recursive: true, force: true })
}
