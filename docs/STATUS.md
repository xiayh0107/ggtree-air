# ggtree-air v0.5 status

## Current product boundary

ggtree-air is an Agent-agnostic artifact/action program. It bundles a standard
`ggtree-phylo` Skill but does not contain or require an Agent runtime.

```text
Artifact → raw user Action → external Agent using bundled Skill → 1..N Artifacts
```

## Release acceptance

- [x] Runtime package bundles CLI, frontend, R renderer, schemas, recipes, and canonical Skill.
- [x] `ggtree-air skills path|install` exposes the Skill to Pi, Claude, Codex, or another Agent.
- [x] Browser creates Action nodes containing exact user language and optional semantic/box/stroke selection.
- [x] Program does not interpret or execute the biological/visual instruction.
- [x] External Agents can list, inspect, claim, run, fail, and complete Actions through stable CLI/API.
- [x] One Action can commit one or many real files; one file becomes one Artifact node.
- [x] Pending/claimed/running/completed/failed states are visible in the canvas.
- [x] Node-local composer is the default interaction; the right drawer is only for preview and visual selection.
- [x] Scene coordinates bind directly to the recommended final artifact.
- [x] Workspaces snapshot inputs and preserve hashes/provenance.
- [x] Large scenes support bounded paging and predicates.
- [x] PNG/PDF/SVG rendering remains available as a tool for Agents.
- [x] Detached services select free ports and reload on Action activity.
- [x] Runtime and independent Skill archives pass installed-package smoke tests.
- [x] Browser/backend/R tests pass and `npm audit` reports zero known vulnerabilities.

## Source-backed research workflows

- [x] Mammal traits
- [x] *Candida auris* resistance and mutations
- [x] HMP microbiome body-site tracks
- [x] HPV58 lineages and sequence-distance summaries
- [x] Sources are commit-pinned and SHA-256 checked

## Deliberate boundaries

- No embedded LLM or Agent SDK.
- No program-owned natural-language planner in the primary Action path.
- An Action remains pending until an external Agent claims it.
- Scientific and visual decisions belong to the Agent and bundled Skill.
- The local service is for one trusted local workspace, not multi-user internet deployment.
