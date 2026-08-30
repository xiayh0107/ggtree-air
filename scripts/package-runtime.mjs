#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, ...options })
    let stdout = ''
    let stderr = ''
    if (child.stdout) { child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk) => { stdout += chunk }) }
    if (child.stderr) { child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { stderr += chunk }) }
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}: ${stderr || stdout}`)))
  })
}

await run('npm', ['run', 'build:frontend'])
const packed = await run('npm', [
  'pack', '--json', '--ignore-scripts', '--silent', '--pack-destination', dist,
], {
  env: { ...process.env, npm_config_ignore_scripts: 'true' },
})
const jsonStart = Math.max(packed.stdout.lastIndexOf('\n[') + 1, packed.stdout.indexOf('['))
const result = JSON.parse(packed.stdout.slice(jsonStart))[0]
const runtimeTarball = path.join(dist, result.filename)
const listing = (await run('tar', ['-tzf', runtimeTarball])).stdout.split('\n').filter(Boolean)
const forbidden = listing.filter((entry) => /(?:\/test\/|\.test\.mjs$|Rplots\.pdf$|^package\/skill\/)/.test(entry))
if (forbidden.length) throw new Error(`Runtime package contains forbidden development files:\n${forbidden.join('\n')}`)
for (const required of [
  'package/backend/bin/ggtree-air.mjs',
  'package/frontend/dist/app.js',
  'package/frontend/dist/styles.css',
  'package/frontend/report-shell.html',
  'package/renderer/r/worker.R',
  'package/renderer/r/install-dependencies.R',
  'package/examples/treedata-book/workflows.json',
  'package/skills/ggtree-phylo/SKILL.md',
]) {
  if (!listing.includes(required)) throw new Error(`Runtime package is missing ${required}`)
}

const skillTarball = path.join(dist, `ggtree-phylo-skill-${pkg.version}.tgz`)
await run('tar', ['-czf', skillTarball, '-C', path.join(root, 'skills', 'ggtree-phylo'),
  'SKILL.md', 'scripts', 'references', 'examples'])

const artifacts = (await readdir(dist)).filter((name) => name.endsWith('.tgz')).sort()
const checksums = []
for (const name of artifacts) {
  const content = await readFile(path.join(dist, name))
  checksums.push(`${createHash('sha256').update(content).digest('hex')}  ${name}`)
}
await writeFile(path.join(dist, 'SHA256SUMS'), `${checksums.join('\n')}\n`)
console.log(`runtime: ${runtimeTarball}`)
console.log(`skill:   ${skillTarball}`)
console.log(`checksums: ${path.join(dist, 'SHA256SUMS')}`)
