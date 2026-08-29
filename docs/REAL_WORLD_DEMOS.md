# Real-world ggtree demo sources

Built-in demos are grounded in published papers and source data distributed by
[`treedata-book`](https://github.com/YuLab-SMU/treedata-book) / `TDbook`.
Metadata below was checked against Crossref and Europe PMC on 2026-08-29.

## ggtree method basis

1. Yu G, Smith DK, Zhu H, Guan Y, Lam TTY. **ggtree: an R package for
   visualization and annotation of phylogenetic trees with their covariates and
   other associated data.** *Methods in Ecology and Evolution*. 2017;8:28–36.
   DOI: [10.1111/2041-210X.12628](https://doi.org/10.1111/2041-210X.12628).
   Crossref summary: “programmable visualization and annotation of phylogenetic
   trees.”

2. Yu G, Lam TTY, Zhu H, Guan Y. **Two Methods for Mapping and Visualizing
   Associated Data on Phylogeny Using ggtree.** *Molecular Biology and
   Evolution*. 2018;35:3041–3043.
   DOI: [10.1093/molbev/msy194](https://doi.org/10.1093/molbev/msy194).

3. Xu S, Dai Z, Guo P, et al. **ggtreeExtra: Compact Visualization of Richly
   Annotated Phylogenetic Data.** *Molecular Biology and Evolution*.
   2021;38:4039–4042.
   DOI: [10.1093/molbev/msab166](https://doi.org/10.1093/molbev/msab166).
   The abstract explicitly describes “heterogeneous data with a phylogenetic
   tree in a circular or rectangular layout.”

4. Chen M, Luo X, Xu S, et al. **Scalable method for exploring phylogenetic
   placement uncertainty with custom visualizations using treeio and ggtree.**
   *iMeta*. 2025;4:e269.
   DOI: [10.1002/imt2.269](https://doi.org/10.1002/imt2.269).

## Published biological scenarios

### Candida auris population genomics

Chow NA, Muñoz JF, Gade L, et al. **Tracing the Evolutionary History and Global
Expansion of Candida auris Using Population Genomic Analyses.** *mBio*.
2020;11:e03364-19.
DOI: [10.1128/mBio.03364-19](https://doi.org/10.1128/mBio.03364-19).

The study compared 304 isolates from 19 countries and related four major clades
to antifungal resistance and ERG11/FKS1 mutations. Demo:
`candida-resistance`.

### Human microbiome abundance by body site

Morgan XC, Segata N, Huttenhower C. **Biodiversity and functional genomics in
the human microbiome.** *Trends in Genetics*. 2013;29:51–58.
DOI: [10.1016/j.tig.2012.09.005](https://doi.org/10.1016/j.tig.2012.09.005).

The treedata-book example aligns relative abundance at seven body sites to a
large microbial phylogeny. Demo: `hmp-body-sites`.

### Multidrug-resistant Salmonella Typhi H58

Wong VK, Baker S, Pickard DJ, et al. **Phylogeographical analysis of the dominant
multidrug-resistant H58 clade of Salmonella Typhi identifies inter- and
intracontinental transmission events.** *Nature Genetics*. 2015;47:632–639.
DOI: [10.1038/ng.3281](https://doi.org/10.1038/ng.3281).

The demo combines a 1,832-isolate tree with country, year and haplotype
metadata. Demo: `typhi-h58`.

### HPV58 lineage evolution

Chen Z, Ho WCS, Boon SS, et al. **Ancient Evolution and Dispersion of Human
Papillomavirus 58 Variants.** *Journal of Virology*. 2017;91:e01285-17.
DOI: [10.1128/JVI.01285-17](https://doi.org/10.1128/JVI.01285-17).

The published analysis used complete-genome phylogenetics to study HPV58
lineages, geographic dispersion and oncogenic variation. The demo labels eight
lineages and aligns pairwise nucleotide-distance summaries. Demo:
`hpv58-lineages`.

## Provenance policy

- Source repositories and commits are recorded in
  `examples/treedata-book/catalog.json`.
- Every downloaded file is SHA-256 checked.
- Transparent data preparation scripts are retained beside the catalog.
- Demo Action histories contain user-like natural-language requests, not claims
  that the exact publication figure has been pixel-reproduced.
- Paper title, authors, journal, year and DOI are shown in the workspace panel.
