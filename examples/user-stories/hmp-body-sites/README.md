# HMP body-site abundance — verified reproduction

This is the first demo allowed into the built-in gallery after manual visual review.

## Quality gate

- 334 tree tips
- 23 labelled/highlighted clades
- phylum encoded by tip colour
- commensal vs potential pathogen encoded by star shape
- tip abundance encoded by size
- seven aligned body-site heatmap tracks
- aligned outer abundance bars
- independent legends and a tree scale
- 4200 × 4200 PNG, SHA-256
  `7bd3eb9df69a18839e1e874e612c7ff843eecbb4606b25e188f5ae5ef8e26520`

## Reproduce

```bash
node examples/treedata-book/fetch.mjs
Rscript examples/user-stories/hmp-body-sites/render.R \
  examples/treedata-book/data \
  /tmp/hmp-body-sites.png
shasum -a 256 /tmp/hmp-body-sites.png
```

Reference implementation and data provenance:

- <https://yulab-smu.top/treedata-book/chapter10.html>
- Morgan, Segata and Huttenhower (2013), DOI: `10.1016/j.tig.2012.09.005`

The other proposed paper scenarios are deliberately excluded from the gallery until they pass an equivalent gate.
