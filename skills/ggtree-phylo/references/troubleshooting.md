# ggtree-phylo Troubleshooting

Operational fixes for the errors this skill hits most often. Set
`options(error = traceback)` and `LANGUAGE=en` before debugging sessions.

## Data input problems

| Symptom | Cause | Fix |
|---------|-------|-----|
| `read.tree: tree has no branch lengths` | Newick has no `:length` segments | `ggtree(tree, branch.length="none")` (cladogram-look); or compute lengths upstream. |
| `tree has no branch lengths` during `nj()` | NJ always produces branch lengths; this error comes from a **file-read** tree | Re-check the parser: `read.tree()` for Newick, `read.nexus()` for NEXUS. |
| `invalid 'ncol' (too large)` / NA in matrix for `nj()` | Distance matrix has NAs or wrong shape | `m <- na.omit(m)`; coerce `as.dist(m)`; need ≥ 3 rows. |
| `nj()` throws on asymmetric matrix | Matrix not symmetric | Force to `dist`: `d <- as.dist(as.matrix(m))`. |
| `read.table` of a `.dist` file misparses | First column is not row-names but a stray index | Use `row.names = 1` and drop the leading index column, or save the matrix with `col.names=NA`. |
| FASTA loaded but MSA fails | `msa`/`seqinr` (optional) not installed | `BiocManager::install("msa"); install.packages("seqinr")`. Expect this skill to **degrade gracefully** (tells you to pass a distance matrix instead). |

## MSA / LaTeX problems

| Symptom | Cause | Fix |
|---------|-------|-----|
| `msaPrettyPrint` output is an empty/huge PDF or an error | No TeX engine (macOS: needs MacTeX; Linux: needs texlive) | Install TeX, OR set `showLogo="none", showNumbering="none"` and use a lightweight printer; the alignment object itself is still valid for tree-building. |
| `msa` package not found at all | Optional module absent | Install via BiocManager. The skill warns and falls back to a distance matrix input. |
| Alignment looks misaligned in conserved blocks | Default alignment params not tuned | Re-align with a different algorithm/method; trim gappy ends (`msa`/`DECIPHER` style trimming). Do not trust the tree until the MSA looks right. |

## ggtree / ggplot layer problems

| Symptom | Cause | Fix |
|---------|-------|-----|
| Tip labels get clipped off the edge | `coord_cartesian`/xlim too tight | `ggtree::xlim(0, 8)` or `xlim_expand()`, or raise `geom_tiplab(offset=)`; `+ coord_cartesian(clip="off")` as a heavier hammer. |
| `geom_cladelabel(node=...)` warns "node not found" | Node id is stale/fabricated | Reveal live ids: `ggtree(tree) + geom_text2(aes(subset=!isTip, label=node))` and copy a valid id. |
| All branches one color despite `aes(color=...)` | Group variable not on the edge data | `groupClade()` first, then pass the grouped object; put `aes(color=factor(group))` inside `ggtree(...)`. |
| Only part of the tree is colored | `groupClade` marks descendants too (by design) but your node missed a subclade | The clade = that node + **all descendants**; choose the MRCA node to capture the whole group. |
| `scale_color_manual(values=...)` complains about wrong number of values | One color per factor level, but factor has more levels | `factor(group)` levels must match length of `values`. |
| Circular `layout="circular"` labels overlap badly | Too many dense tips | `open.angle` on fan layout, smaller font, or switch to rectangular. |
| `%+%` or `%<+%` to attach data fails | Wrong object type | `as.treedata(tree)` then `%<+%` a data frame keyed by tip label. |
| `ungroup()`/dplyr joins on treedata misbehave | Mixing tibbles and phylo internals | Keep annotation data in a data.frame keyed by `label`; merge via `treeio::merge_tree`. |

## Output / reproducibility

| Symptom | Cause | Fix |
|---------|-------|-----|
| PDF is blank / 0 bytes | Device closed before printing, or plot object empty | Ensure `print(p)` inside the device block; `dev.off()` after. |
| Figure looks different run-to-run | Node ids / grouping order unstable | Derive node ids from the live tree each run; pin `set.seed()` if any stochastic step. |
| `newick.tree.txt` missing from exports | `write.tree` failed on a non-ape object | Export the `phylo` (`result$tree`) not the treedata; or `write.tree(as.phylo(td))`. |

## Fallback behavior to expect (not bugs)

- **MSA route → distance route:** if `msa`/`seqinr` are missing, `load_data()`
  prints a warning and expects a distance matrix instead. This is by design so
  the skill never hard-fails on an uninstalled optional module.
- **groupClade with no valid nodes:** if every `clade_nodes` id is invalid,
  grouping is skipped with a warning rather than an error — the base tree is
  still produced.
