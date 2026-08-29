#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.GGTREE_AIR_EXAMPLE_DATA_DIR
  ? path.resolve(process.env.GGTREE_AIR_EXAMPLE_DATA_DIR)
  : path.join(directory, 'data')

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = '' }
    else field += character
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const header = rows.shift()
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])))
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const [tips, rings, bars] = await Promise.all([
  readFile(path.join(dataDir, 'hmp-tip-points.csv'), 'utf8').then(parseCsv),
  readFile(path.join(dataDir, 'hmp-ring-heatmap.csv'), 'utf8').then(parseCsv),
  readFile(path.join(dataDir, 'hmp-bars.csv'), 'utf8').then(parseCsv),
])
const siteNames = {
  'Stool (prevalence)': 'Stool', 'Cheek (prevalence)': 'Cheek',
  'Plaque (prevalence)': 'Plaque', 'Tongue (prevalence)': 'Tongue',
  'Nose (prevalence)': 'Nose', 'Vagina (prevalence)': 'Vagina',
  'Skin (prevalence)': 'Skin',
}
const byId = new Map(tips.map((row) => [row.ID, { ...row }]))
for (const row of rings) {
  const target = byId.get(row.ID) || { ID: row.ID }
  target[siteNames[row.Sites] || row.Sites] = row.Abundance
  byId.set(row.ID, target)
}
for (const row of bars) {
  const target = byId.get(row.ID) || { ID: row.ID }
  target.HighestSite = siteNames[row.Sites] || row.Sites
  target.HigherAbundance = row.HigherAbundance
  byId.set(row.ID, target)
}
const columns = ['ID', 'Phylum', 'Type', 'Size', 'Stool', 'Cheek', 'Plaque', 'Tongue',
  'Nose', 'Vagina', 'Skin', 'HighestSite', 'HigherAbundance']
const lines = [columns.join(','), ...[...byId.values()].map((row) =>
  columns.map((column) => csvCell(row[column])).join(','))]
const output = path.join(dataDir, 'hmp-metadata-wide.csv')
await writeFile(output, `${lines.join('\n')}\n`)
console.log(`prepared: ${output} (${byId.size} taxa)`)
