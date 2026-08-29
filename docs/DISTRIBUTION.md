# Distribution

The runtime tarball is the canonical distribution unit. It bundles the Node
backend, frontend, isolated R worker, schemas, recipes, and the standard
`skills/ggtree-phylo` package. A standalone Skill tarball is emitted only for
Agent environments that want to manage skills separately.

## 1. Build local release artifacts

```bash
npm ci
npm run pack:smoke
```

Outputs:

```text
dist/ggtree-air-<version>.tgz
dist/ggtree-phylo-skill-<version>.tgz
dist/SHA256SUMS
```

Install the runtime tarball:

```bash
npm install -g ./dist/ggtree-air-0.5.0.tgz
ggtree-air setup-r --with-recipes
ggtree-air skills list
ggtree-air skills install ggtree-phylo --agent pi --force
ggtree-air check
# user-facing automatic workflow (free port + browser open)
ggtree-air auto --input data/tree.nwk --out results/tree
```

Add `--with-msa` or use `--all` when FASTA realignment is required.

Agents that support package-level skill discovery can load the bundled
`skills/ggtree-phylo` directly. Otherwise use `ggtree-air skills path` or
`ggtree-air skills install --agent pi|claude|codex|agents`; arbitrary locations
are supported with `--target`. The launcher resolves the installed CLI from
`PATH`.

## 2. npm registry

The package name `ggtree-air` is currently unclaimed, but public publish remains
intentionally blocked by `"private": true` until project ownership and license
are confirmed.

Release checklist:

1. choose and add a license;
2. initialize/publish the Git repository and set `repository`/`bugs`/`homepage`;
3. authenticate with `npm login`;
4. remove `private`, set `publishConfig.access`, and run `npm publish`.

Expected user flow after publication:

```bash
npm install -g ggtree-air
ggtree-air setup-r --with-recipes
ggtree-air auto --input tree.nwk --metadata traits.csv
```

`auto` infers a design, creates a workspace, starts/reuses a detached service on
a free port, and opens the browser. No port selection is part of normal use.

R dependencies are never installed from `postinstall`; scientific runtime
changes require an explicit user command.

## 3. Container image

The container bundles Node, R, Bioconductor packages, recipe dependencies, and
the CLI:

```bash
docker build -t ggtree-air:0.5.0 .

docker run --rm -it \
  -v "$PWD/data:/workspace/data:ro" \
  -v "$PWD/results:/workspace/results" \
  ggtree-air:0.5.0 run \
  --tree /workspace/data/tree.nwk \
  --out /workspace/results/tree

docker run --rm -p 7391:7391 \
  -v "$PWD/results:/workspace/results" \
  ggtree-air:0.5.0 serve \
  --workspace /workspace/results/tree \
  --host 0.0.0.0 --port 7391
```

Non-loopback binding is enabled only inside the published container via the
explicit `GGTREE_AIR_ALLOW_NON_LOOPBACK=1` image environment. Mutation-token
protection remains active.

`docker compose up --build` serves `results/workspace` when that workspace already
exists on the host.

## 4. GitHub Releases and GHCR

Tagging `v*` runs `.github/workflows/release.yml`:

- creates runtime and skill tarballs;
- publishes SHA-256 checksums to the GitHub Release;
- builds and pushes versioned images to GHCR.

CI installs the R runtime explicitly, runs Node/R/browser tests, audits npm, and
smoke-installs the packed tarball.

## Compatibility contract

- Node.js: `>=20`
- npm: `>=10`
- R: `>=4.0` (release images pin a concrete R/Bioconductor pair)
- runtime schemas and Node↔R protocol remain independently versioned
- workspaces are upgraded on read; release migrations must preserve archived
  artifacts and revision DAGs

## Public-release blockers

- repository currently has no `.git` history;
- no project license has been selected;
- npm authentication is not configured on this machine;
- final GitHub owner/repository name has not been confirmed.

Everything else—runtime tarball, skill archive, container definition, CI,
release workflow, checksums, and installed-package smoke test—is prepared.
