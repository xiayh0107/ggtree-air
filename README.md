# ggtree-air

**v0.5 — requirement-driven, self-opening phylogenetic workflow.** Release acceptance and explicit
boundaries are tracked in [`docs/STATUS.md`](docs/STATUS.md).

A revisioned, agent-interactive workspace for phylogenetic analysis and visualization.

The central architectural rule is separation of responsibilities:

```text
┌───────────────────────────────────────────────────────────────┐
│ skills/      Agent knowledge: route requests, choose params,  │
│              explain scientific limits                       │
└──────────────────────────────┬────────────────────────────────┘
                               │ invoke
┌──────────────────────────────▼────────────────────────────────┐
│ backend/     Node program: API, workspace, security, hashes,  │
│              annotations, atomic revisions, R process control │
└──────────────────────────────┬────────────────────────────────┘
                               │ JSON subprocess protocol
┌──────────────────────────────▼────────────────────────────────┐
│ renderer/r/  Isolated scientific worker: ape/treeio/ggtree,   │
│              NJ/MSA, plot layers, semantic coordinates        │
└──────────────────────────────┬────────────────────────────────┘
                               │ artifacts + scene.json
┌──────────────────────────────▼────────────────────────────────┐
│ frontend/    Self-contained node canvas: inspect, annotate,   │
│              submit feedback, reload the next revision        │
└───────────────────────────────────────────────────────────────┘
```

The drawing skill is **not** the backend, and R is **not** the lifecycle
orchestrator. R remains where it is strongest: phylogenetic computation and
ggtree rendering. Node owns the application.

## Closed loop

1. Node validates a run specification and starts an isolated R worker.
2. R validates the scientific input, builds/loads the tree, renders plots, and
   returns artifacts plus exact ggplot-projected semantic coordinates.
3. Node creates a checksummed workspace and packages the canvas report.
4. A human opens a result node, clicks a real tip/clade, and writes feedback.
5. The backend validates `scene_id + view_id + artifact_hash`, then atomically
   persists `annotations.json`.
6. **Generate downstream node** archives the old revision, launches a fresh R
   worker, applies deterministic overlays, and creates a new immutable artifact
   node for each layout in the next revision. Earlier result nodes stay visible
   and read-only; lineage edges connect old result → feedback → new result.
7. Applied/deferred/skipped status is recorded per instruction. Unsupported
   requests are never silently pretended to be complete.

## Quick start

Requirements: Node.js ≥20, R ≥4.0, and the R packages reported by `make check`.

```bash
make check
make rich-demo
make serve-rich
```

Available source-backed workflows can also be listed and run through the
versioned recipe registry:

```bash
node backend/bin/ggtree-air.mjs recipes list
node backend/bin/ggtree-air.mjs recipes run hmp-microbiome \
  --out results/hmp-microbiome --force
```

The registry currently includes `mammal-traits`, `candida-auris`,
`hmp-microbiome`, and `hpv58`. The mammal recipe also exercises publication SVG
output.

`make rich-demo` fetches the checksum-pinned *Candida auris* chapter-10 case from
[treedata-book](https://github.com/YuLab-SMU/treedata-book): 305 tree tips,
304 metadata rows, four clades, three antifungal-resistance tracks, and two
drug-target mutation tracks. Use `make demo && make serve` only for the small,
fast smoke-test fixture. A second real-world workflow is available with
`make hmp-demo && make serve-hmp`: 334 HMP tips, 14 phyla, and seven body-site
abundance tracks. `make hpv-demo && make serve-hpv` builds the chapter-13 HPV58
workflow with 90 aligned genomes, eight named lineages, and pairwise nucleotide
distance tracks.

`make serve*` now means “open”: it reuses a healthy detached service or chooses
a free port automatically and opens the browser. Users never need to select a
port. The served report can write feedback and trigger reruns. `results/demo/report.html` is also self-contained and opens offline;
offline mode stores feedback locally and exports `annotations.json`, but browser
sandbox rules prevent direct filesystem write-back.

## Run your own tree

The user-facing path is automatic and opens the browser without a port:

```bash
ggtree-air auto \
  --input data/tree.nwk \
  --metadata data/groups.tsv \
  --out results/gene-family
```

Use the lower-level `run` command only when exact layouts/intents must be pinned.

For FASTA, add `--sequence-type auto|dna|rna|protein`; explicit typing avoids
misclassifying unusual alphabets. Distance-matrix route:

```bash
node backend/bin/ggtree-air.mjs run \
  --dist data/distance.tsv \
  --layout rectangular,fan \
  --out results/nj-tree
```

Other commands:

```bash
node backend/bin/ggtree-air.mjs check
node backend/bin/ggtree-air.mjs status --workspace results/demo
node backend/bin/ggtree-air.mjs rerun --workspace results/demo
node backend/bin/ggtree-air.mjs help
```

## Canvas frontend

The report adopts the useful interaction language of a content-first node
canvas:

- dotted infinite canvas with pan, zoom, fit, and draggable nodes;
- only artifact and action nodes are visible: `artifact → user instruction → artifact`; input validation, routing, and scientific caveats stay in details rather than occupying the canvas;
- every artifact card has a persistent **“基于此节点修改”** action; current artifacts create visible pending-action nodes, while historical artifacts automatically create a branch from that revision before editing;
- each user feedback/natural-language request is an explicit intermediate workflow node, and every accepted rerun creates new downstream artifact nodes without replacing prior results;
- light 16px node shells, quiet chrome, hover actions, blue selection;
- result nodes switch between base/router/grouped variants;
- a node-local one-sentence composer for ordinary edits; the right-side drawer is only for large preview and optional point/box/brush selection;
- exact tip/internal-node hit targets derived from ggplot coordinate transforms;
- one unified recommended figure for viewing and editing—the system projects semantic tip/clade coordinates directly onto the final annotated/heatmap artifact;
- semantic tip/clade selection plus normalized rectangle selection and freehand drawing on that same figure;
- intent inferred from plain-language instructions instead of a technical dropdown;
- annotation import/export, local persistence, and backend save;
- revision rerender from the same workspace.

The upstream case catalog, pinned commits, checksums, and fetcher live in
[`examples/treedata-book/`](examples/treedata-book/). The companion
[TDbook](https://github.com/YuLab-SMU/TDbook) package is recorded as the data
reference; tests do not require network access.

The canvas is plain self-contained HTML/CSS/JavaScript generated by the Node
backend; it does not import application code from the reference project.

## Workspace contract

```text
results/<name>/
├── workspace.json             # Node-owned spec + current revision
├── report.html                # self-contained node canvas
├── report_manifest.json       # checksums and artifact inventory
├── scene.json                 # tip/node/edge semantics + artifact coordinates
├── annotations.json           # feedback for the current scene
├── applied_annotations.json   # feedback consumed by this revision, if any
├── feedback_status.json       # applied/deferred/skipped per feedback item
├── revision_diff.json         # parent/current artifact and topology diff
├── revision_score.json        # operational workflow scorecard
├── run_metadata.json
├── render_metadata.json
├── tree_<layout>.png/.pdf
├── tree.rds
├── newick.tree.txt
└── .ggtree-air/
    └── revisions/r0001/...    # immutable prior revision artifacts
```

Feedback is hash-bound. After a rerun, current annotations reset to an empty
envelope bound to the new artifacts; consumed feedback remains in
`applied_annotations.json` and the archived revision.

## Backend API

The service binds only to `127.0.0.1`. Mutations require a per-process token
injected only when serving `report.html`.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | service health |
| `GET` | `/api/workspace` | current revision summary |
| `GET` | `/api/scene` | complete semantic scene |
| `GET` | `/api/objects` | bounded tip/clade/edge pagination and filtering |
| `POST` | `/api/predicates/evaluate` | resolve group/label/descendant selectors without loading the full tree |
| `GET/POST` | `/api/actions` | list or create raw user Action nodes |
| `GET` | `/api/actions/:id` | read source, instruction, selection, status, and outputs |
| `POST` | `/api/actions/:id/claim` | external Agent claims work |
| `POST` | `/api/actions/:id/running` | external Agent reports execution start |
| `POST` | `/api/actions/:id/progress` | stream phase/message/percent and optional preview |
| `GET` | `/api/actions/:id/preview` | latest Agent candidate preview |
| `POST` | `/api/actions/:id/complete` | commit one or more real output files |
| `POST` | `/api/actions/:id/fail` | report an honest execution failure |

Every completed revision also writes `revision_diff.json` and
`revision_score.json`. The score is explicitly operational—feedback resolution,
artifact change, and topology preservation—not a biological quality claim.

The server rejects path traversal, non-loopback binding, oversized bodies,
stale selectors/hashes, and unauthenticated mutations.

## External Agent execution

The program stores the user's exact instruction and optional semantic/box/stroke
selection without interpreting it. Any Agent can load the bundled
`ggtree-phylo` Skill and consume the same neutral protocol:

```bash
ggtree-air skills path
# Keep the Agent turn attached; returns and claims when the browser submits
ggtree-air actions wait --workspace results/demo --agent my-agent --timeout 3600

# Manual reconnect path
ggtree-air actions next --workspace results/demo
ggtree-air actions claim <id> --workspace results/demo --agent my-agent
ggtree-air actions running <id> --workspace results/demo --agent my-agent
# Agent reads data, edits/runs R, evaluates real images
ggtree-air artifacts commit <id> --workspace results/demo \
  --agent my-agent --file candidate-a.png --file candidate-b.png
```

One Action may commit one or many Artifact nodes. With no connected Agent, the
Action remains honestly labeled “等待 Agent”; the program never pretends to
understand or execute the biological/visual request.

## Distribution

Build and smoke-install runtime + skill archives:

```bash
npm run pack:smoke
```

Container, npm, GitHub Release/GHCR, compatibility, and the remaining public
release blockers are documented in [`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md).
Public npm publication is intentionally blocked until repository ownership and
license are confirmed.

## Project layout

```text
backend/
  bin/ggtree-air.mjs           # executable
  src/                         # Node orchestration, API, contracts, revisions
  test/                        # Node contract + full closed-loop tests
renderer/r/
  worker.R                     # isolated JSON worker entry
  R/                           # scientific input/analysis/render/scene modules
  fixtures/                    # renderer-owned test data
  tests/
frontend/
  report.html
  styles.css
  app.js
skills/
  ggtree-phylo/
    SKILL.md                   # canonical Agent Skills package
    scripts/run_backend.sh     # thin adapter to the Node executable
  references/
docs/schemas/
```

## Verification

```bash
make test
npm run syntax
```

The test suite covers:

- run-spec and annotation contract validation;
- stale scene/artifact rejection;
- isolated R rendering and projected scene coordinates;
- Node → R worker execution;
- HTTP feedback persistence with mutation token;
- feedback rerender to revision 2;
- archival of revision 1 and reset of the new annotation envelope.

## Scientific guardrails

- NJ output is unrooted unless an outgroup is explicitly supplied.
- Branch length means the input distance metric, not automatically time.
- Color and labels are annotations, not evidence.
- Support should be shown whenever available.
- Node ids are topology-specific and must be revalidated after topology changes.
- MSA quality gates every downstream topology claim.

See [`skills/ggtree-phylo/references/interpretation-guide.md`](skills/ggtree-phylo/references/interpretation-guide.md).
