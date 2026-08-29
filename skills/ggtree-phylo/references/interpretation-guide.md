# Interpreting ggtree Phylogenetic Trees

A practical guide to reading the tree figures this skill produces, with the
scientific traps explained in plain terms. Distilled from FigureYa2,
FigureYa88, and FigureYa80.

## 1. Topology: what a tree actually claims

A tree is a statement about **which tips are more related to each other** and
**in what branching order**. It makes a claim of *relatedness*, not of
*time*.

- **Two tips joined by a short path share a more recent common ancestor**
  (under the distance metric you used) than two tips joined by a longer path.
- ggtree by default draws a **rectangular** tree; `circular`/`fan`/`unrooted`
  change the geometry but **not** the topology. Identical information, visual
  style only.

## 2. The rooting problem (the #1 trap)

Neighbor-joining (`nj()`) returns an **unrooted** tree. The visual "root" of
an unrooted NJ tree is arbitrary — it is just where the plotting algorithm
happened to place a root, not a biological ancestor.

- **Do NOT** read ancestor → descendant direction, or "this branch evolved
  before that one", from an unrooted NJ tree.
- A midpoint root or a position chosen for aesthetics is a convenience, not a
  finding.
- **To make directional claims**, root the tree with a known outgroup
  (`ape::root(tree, outgroup=...)`) or an explicit molecular-clock root, and
  say so in the legend.

> Rule of thumb: unrooted trees answer "what clusters together?"; rooted
> trees answer "what came from what?"

## 3. Branch length = whatever your distance encoded

Branch length is only interpretable on the scale of the input distance:

| Route | Branch length means |
|-------|---------------------|
| `dist.alignment(...,"identity")` (FASTA/MSA) | sequence **dissimilarity** (fraction of mismatches) |
| `1 - GOSemSim` similarity (FigureYa80/88) | **functional dissimilarity** of terms |
| arbitrary distance matrix | whatever you put in — you must define it |

A long branch is **not automatically "more evolutionary time"**. It means
"more different on the scale I measured". Always label the metric in the
figure legend.

## 4. Clade colors / labels are annotations, not evidence

`groupClade()` + `geom_cladelabel()` + colored branches make a hypothesis
**visible**. Red branches ≠ "this clade is biologically special".

- Colored grouping is driven by *you* (the node ids you chose), so it is
  circular — you colored those branches because you already believed they
  group together.
- **Validation must come from an independent source**: bootstrap support,
  posterior probability, a phenotype/survival association test, or a
  re-test on held-out data. Color alone proves nothing.

## 5. Support values are the honest currency

If your tree has bootstrap/posterior support (often stored as `bp` in a
treeio `treedata`), **plot it** — `ggtree(tree) + geom_nodelab(aes(label=bp, subset=!isTip))`.

- Support ≥ 70–80% (bootstrap) / ≥ 0.95 (posterior) → well-supported split.
- Support < 60% → treat that split as *provisional*. Do not build a narrative
  on an unsupported node.

## 6. Node ids are fragile — always re-derive them

`groupClade(.node=...)` numbers depend on the exact topology and the order in
which the file was parsed. If you hard-code node ids and re-run on a
differently-ordered input, the same number can point at a **different clade**.

- Before trusting a node id, display the live tree with
  `ggtree(tree) + geom_text2(aes(subset=!isTip, label=node))` and confirm the
  number sits on the clade you intend.
- Verify with your biological expectation (e.g. a known-species clade).

## 7. Resolution limits

- A tree built from **one gene family** or **one set of GO terms** speaks
  only about that gene family / those terms — it is **not** a statement about
  whole-genome species relationships or global gene ontology structure.
- Frame every claim at exactly the resolution the input data spans.

## 8. MSA quality gates everything downstream

When the tree is built from a multiple-sequence alignment, **garbage in →
garbage out topology**:

- Misaligned conserved blocks and untrimmed gappy ends corrupt the identity
  distances, which then corrupt the NJ topology.
- **Inspect the MSA before trusting the tree** (`msaPrettyPrint`), trim
  unreliable regions, and re-align if conserved domains are misaligned.
- In FigureYa2's scenario 1, the whole point is "do these functionally-unknown
  genes share conserved regions with the known family?" — only a *good*
  alignment can answer that.

## Checklist before you call a tree figure "done"

- [ ] Rooting is explicit and justified (or the figure is clearly labeled
      "unrooted" and no directional claims are made).
- [ ] Branch-length metric is defined in the legend/methods.
- [ ] Support values are displayed or stated as unavailable.
- [ ] Group coloring is labeled as annotation, and any clade claim has an
      independent statistical support.
- [ ] Tree-building method (NJ + distance type) is reported.
- [ ] Node ids used for `groupClade` were verified against the live tree.
