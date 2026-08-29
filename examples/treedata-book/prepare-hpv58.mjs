#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.GGTREE_AIR_EXAMPLE_DATA_DIR
  ? path.resolve(process.env.GGTREE_AIR_EXAMPLE_DATA_DIR)
  : path.join(directory, 'data')
const [fasta, newick] = await Promise.all([
  readFile(path.join(dataDir, 'hpv58-alignment.fas'), 'utf8'),
  readFile(path.join(dataDir, 'hpv58-tree.nwk'), 'utf8'),
])
const sequences = new Map()
let name = null
for (const line of fasta.split(/\r?\n/)) {
  if (line.startsWith('>')) {
    name = line.slice(1).trim().split(/\s+/)[0]
    sequences.set(name, '')
  } else if (name && line.trim()) sequences.set(name, sequences.get(name) + line.trim().toUpperCase())
}
const tipLabels = [...newick.matchAll(/(?:\(|,)\s*([^():,]+?)\s*:/g)].map((match) => match[1])
const labelByAccession = new Map(tipLabels.map((label) => [label.replace(/^.*\|/, ''), label]))
const entries = [...sequences.entries()].filter(([accession]) => labelByAccession.has(accession))
const metrics = entries.map(([accession, sequence], index) => {
  const distances = []
  for (let otherIndex = 0; otherIndex < entries.length; otherIndex += 1) {
    if (index === otherIndex) continue
    const other = entries[otherIndex][1]
    const width = Math.min(sequence.length, other.length)
    let compared = 0
    let differences = 0
    for (let position = 0; position < width; position += 1) {
      const a = sequence[position]
      const b = other[position]
      if (a === '-' || b === '-' || a === 'N' || b === 'N') continue
      compared += 1
      if (a !== b) differences += 1
    }
    distances.push(compared ? differences / compared * 100 : 0)
  }
  return {
    ID: labelByAccession.get(accession),
    MeanDistance: distances.reduce((sum, value) => sum + value, 0) / distances.length,
    MaxDistance: Math.max(...distances),
  }
})
const lines = ['ID,MeanDistance,MaxDistance', ...metrics.map((row) =>
  `${row.ID},${row.MeanDistance.toFixed(6)},${row.MaxDistance.toFixed(6)}`)]
const output = path.join(dataDir, 'hpv58-distance-metadata.csv')
await writeFile(output, `${lines.join('\n')}\n`)
console.log(`prepared: ${output} (${metrics.length} aligned genomes)`)
