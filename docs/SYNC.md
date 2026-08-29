# Skill and runtime boundaries

The canonical Agent Skills package is:

```text
skills/ggtree-phylo/
```

It contains agent guidance, references, examples, and the thin
`run_backend.sh` adapter. The npm runtime bundles this directory and exposes it
through `ggtree-air skills list|path|install` and `package.json#pi.skills`.

## Ownership

- `skills/ggtree-phylo/`: domain workflow and scientific guidance for any Agent
- `backend/`: neutral Action/Artifact protocol, workspace API, storage, and UI serving
- `renderer/r/`: isolated scientific execution tools
- `frontend/`: human canvas, prompt composer, preview, and visual selection

The program does not interpret Action instructions. External Agents load the
Skill, consume pending Actions, run tools/R, and commit actual output files.

When syncing back to FigureYa, sync only the canonical Skill directory. Do not
copy backend or renderer lifecycle logic into the Skill package.
