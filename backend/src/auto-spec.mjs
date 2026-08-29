import path from 'node:path'
import { normalizeRunSpec } from './contracts.mjs'
import { callRWorker } from './r-worker.mjs'

function preferred(columns, pattern, predicate = () => true) {
  return columns.find((column) => pattern.test(column.name) && predicate(column))
    || columns.find(predicate)
    || null
}

export async function inferRunSpec(input, { onLog } = {}) {
  const provisional = await normalizeRunSpec({
    ...input,
    layouts: ['rectangular'],
    intents: ['treescale'],
    render: input.render || { width: 11, height: 8, dpi: 180, formats: ['png'] },
  })
  const inspection = await callRWorker('input.inspect', { spec: provisional }, { onLog })
  const tips = inspection.tree.tips
  const columns = inspection.metadata?.columns || []
  const tipColumn = columns.length
    ? preferred(columns, /^(id|tip|label|taxon|taxa|newick_label)$/i,
      (column) => column.tip_matches > 0)
    : null
  const categorical = columns.filter((column) => column.type === 'categorical'
    && column.unique >= 2 && column.unique <= 24 && column !== tipColumn)
  const numeric = columns.filter((column) => column.type === 'numeric'
    && column.unique > 1 && column !== tipColumn)
  const groupColumn = preferred(categorical, /(group|clade|lineage|phylum|class|type|location|country)/i)
  const sizeColumn = preferred(numeric, /(size|mass|weight|abundance|count|score)/i)
  const shapeColumn = preferred(categorical.filter((column) => column !== groupColumn
    && column.unique <= 8), /(type|status|habit|host|resistan)/i)
  const excluded = new Set([tipColumn?.name, groupColumn?.name, sizeColumn?.name, shapeColumn?.name])
  const heatmapColumns = [...numeric, ...categorical]
    .filter((column) => !excluded.has(column.name)
      && !/(latitude|longitude|(^|_)id$|url|colour|color)/i.test(column.name))
    .slice(0, 7)
    .map((column) => column.name)

  const layouts = tips <= 40 ? ['rectangular', 'circular']
    : tips <= 150 ? ['rectangular', 'fan']
      : ['fan', 'rectangular']
  const tipLabels = tips <= 60 ? 'show' : tips <= 100 ? 'auto' : 'hide'
  const intents = ['treescale']
  if (groupColumn) intents.push('tipcolor')
  if (heatmapColumns.length) intents.push('heatmap')
  const inputPath = provisional.tree || provisional.dist || provisional.fasta
  const spec = await normalizeRunSpec({
    ...provisional,
    layouts,
    intents,
    tip_labels: tipLabels,
    tip_column: tipColumn?.name,
    group_column: groupColumn?.name,
    size_column: sizeColumn?.name,
    shape_column: shapeColumn?.name,
    heatmap_columns: heatmapColumns,
    title: input.title || `${path.basename(inputPath)} · phylogenetic workflow`,
  })
  return {
    spec,
    inspection,
    decisions: {
      layouts,
      intents,
      tip_labels: tipLabels,
      tip_column: tipColumn?.name || null,
      group_column: groupColumn?.name || null,
      size_column: sizeColumn?.name || null,
      shape_column: shapeColumn?.name || null,
      heatmap_columns: heatmapColumns,
    },
  }
}
