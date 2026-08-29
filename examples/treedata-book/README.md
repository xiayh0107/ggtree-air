# treedata-book sourced examples

These examples are fetched from the exact upstream commit recorded in
`catalog.json`; source files are not silently rewritten or treated as synthetic
data. SHA-256 is checked before use.

```bash
node examples/treedata-book/fetch.mjs candida-auris
make rich-fixture
```

Sources:

- <https://github.com/YuLab-SMU/treedata-book>
- companion data package: <https://github.com/YuLab-SMU/TDbook>

The default rich workflow reproduces the structure of the chapter 10
*Candida auris* case: 304 isolates, clade grouping, and five aligned metadata
tracks (`FCZ`, `AMB`, `MCF`, `ERG11`, `FKS1`). It is an executable integration
fixture, not a user-facing Demo and not a claim that this compact render replaces the full book figure.

The HMP case is also executable:

```bash
make hmp-fixture
make serve-hmp
```

`prepare-hmp.mjs` performs a transparent long-to-wide pivot of the seven
body-site abundance tracks while preserving all downloaded source files. The
source HMP tree contains one unnamed tip, so this recipe opts into explicit,
logged `--repair-tip-labels` normalization.

The HPV58 lineage and sequence-distance workflow is executable as well:

```bash
make hpv-fixture
make serve-hpv
```

`prepare-hpv58.mjs` computes per-genome mean/max pairwise nucleotide distance
from the pinned 90-genome alignment. The workflow uses the lineage node ids and
labels documented in treedata-book chapter 13. Always preserve upstream citation and provenance when publishing a
result derived from them.
