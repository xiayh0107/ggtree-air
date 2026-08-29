#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(await readFile(path.join(directory, 'catalog.json'), 'utf8'))
const requested = process.argv.slice(2)
const caseIds = requested.length ? requested : Object.keys(catalog.cases)
const outputDir = process.env.GGTREE_AIR_EXAMPLE_DATA_DIR
  ? path.resolve(process.env.GGTREE_AIR_EXAMPLE_DATA_DIR)
  : path.join(directory, 'data')
await mkdir(outputDir, { recursive: true })

for (const caseId of caseIds) {
  const entry = catalog.cases[caseId]
  if (!entry) throw new Error(`Unknown treedata-book case: ${caseId}`)
  for (const file of entry.files) {
    const url = `https://raw.githubusercontent.com/YuLab-SMU/treedata-book/${catalog.source.commit}/${file.path}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not fetch ${url}: HTTP ${response.status}`)
    const content = Buffer.from(await response.arrayBuffer())
    const sha256 = createHash('sha256').update(content).digest('hex')
    if (sha256 !== file.sha256) throw new Error(`Checksum mismatch for ${file.name}`)
    const target = path.join(outputDir, file.name)
    await writeFile(target, content)
    console.log(`${caseId}: ${target}`)
  }
}
