# ggtree-air v0.5 status

## Current product boundary

ggtree-air is an Agent-agnostic artifact/action program. It bundles a standard
`ggtree-phylo` Skill and a transport that launches an installed external Agent
CLI; it does not contain a model loop or interpret the user's instruction.

```text
Artifact → raw user Action → external Agent using bundled Skill → 1..N Artifacts
```

## Release acceptance

- [x] Runtime package bundles CLI, frontend, R renderer, schemas, recipes, and canonical Skill.
- [x] `ggtree-air skills path|install` exposes the Skill to Pi, Claude, Codex, or another Agent.
- [x] Browser creates Action nodes containing exact user language and optional semantic/box/stroke selection.
- [x] Program does not interpret or execute the biological/visual instruction.
- [x] Node prompts launch a real installed Agent CLI through `LocalAgentRunner`; external Agents can also attach through the stable CLI/API.
- [x] One Action can commit one or many real files; one file becomes one Artifact node.
- [x] Pending/claimed/running/completed/failed states are visible in the canvas.
- [x] Node-local composer is the default interaction; the right drawer is only for preview and visual selection.
- [x] Scene coordinates bind directly to the recommended final artifact.
- [x] Workspaces snapshot inputs and preserve hashes/provenance.
- [x] Large scenes support bounded paging and predicates.
- [x] PNG/PDF/SVG rendering remains available as a tool for Agents.
- [x] Detached services select free ports and reload on Action activity.
- [x] Artifact-first workspaces start with real imported inputs and zero pre-rendered output nodes.
- [x] Real Agent tool calls are retained and exposed through the Action log drawer.
- [x] Runtime and independent Skill archives pass installed-package smoke tests.
- [x] Browser/backend/R tests pass and `npm audit` reports zero known vulnerabilities.

## Source-backed renderer fixtures

- [x] Mammal traits
- [x] *Candida auris* resistance and mutations
- [x] HMP microbiome body-site tracks
- [x] HPV58 lineages and sequence-distance summaries
- [x] Sources are commit-pinned and SHA-256 checked

## Deliberate boundaries

- No embedded model loop and no program-owned natural-language planner in the primary Action path.
- Managed mode launches the user's installed Agent CLI; `GGTREE_AIR_AGENT=none` leaves Actions pending for an externally attached Agent.
- No packaged Demo may create, claim, complete, or copy output into an Action.
- Scientific and visual decisions belong to the Agent and bundled Skill.
- The local service is for one trusted local workspace, not multi-user internet deployment.
