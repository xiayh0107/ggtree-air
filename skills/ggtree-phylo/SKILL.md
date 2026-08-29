---
name: ggtree-phylo
description: >
  Use ggtree-air to create and revise phylogenetic figures from tree, distance,
  FASTA, and metadata inputs. Trigger for evolutionary/phylogenetic trees,
  ggtree, clades, tree-associated heatmaps, or pending ggtree-air Action nodes.
  This skill is agent-agnostic: the Agent—not the ggtree-air program—interprets
  the user's natural-language request, edits/runs R code, evaluates outputs, and
  commits one or more real artifacts.
---

# ggtree-air Agent Skill

## Core contract

The program is a neutral artifact/action workspace. You own the scientific and
visual reasoning.

```text
source Artifact + user's exact instruction + optional selection
                           ↓
                        you (Agent)
                           ↓
             inspect → edit R → render → evaluate
                           ↓
             commit 1..N actual output files
```

Never ask the program to interpret natural language. Do not use legacy
`plan natural` or operation allow-lists for new work.

## Stay attached to the browser workflow

After opening the browser, do **not** end the Agent turn and ask the user to
manually trigger you again. Block waiting for the next browser Action:

```bash
ggtree-air actions wait --workspace <workspace> \
  --agent <your-agent-name> --timeout 3600
```

The command returns as soon as the user submits an instruction and atomically
claims it for this Agent. This is the Agent-agnostic trigger: any Agent capable
of running a shell command can stay attached without the program embedding an
Agent SDK.

If reconnecting after an interruption, check existing work first:

```bash
ggtree-air actions next --workspace <workspace>
```

Exit code `2` means there is no pending action. To inspect all work:

```bash
ggtree-air actions list --workspace <workspace> --json
ggtree-air actions show <action-id> --workspace <workspace>
```

`actions wait` claims automatically. When using `actions next` manually, claim
before modifying files:

```bash
ggtree-air actions claim <action-id> \
  --workspace <workspace> --agent <your-agent-name>
ggtree-air actions running <action-id> \
  --workspace <workspace> --agent <your-agent-name>
```

The Action JSON contains:

- `source.artifact.path` and hash;
- source revision/layout when applicable;
- user's exact `instruction`;
- optional semantic tip/clade, normalized rectangle, or freehand stroke;
- status and provenance.

Resolve every relative artifact path against the workspace root.

## Execute the request

1. Read the source tree/data, current R code or run metadata, and preview.
2. Read the selection as context, not as a hard-coded operation:
   - `tip` / `clade`: stable semantic target;
   - `region`: normalized image rectangle;
   - `stroke`: normalized user-drawn path.
3. Interpret the user's outcome in context.
4. Create an isolated work directory:

```text
<workspace>/.ggtree-air/agent-work/<action-id>/
```

5. Stream concise, user-readable progress while working:

```bash
ggtree-air actions progress <action-id> --workspace <workspace> \
  --agent <name> --phase inspect --percent 15 \
  --message "正在检查源图和标注区域"
```

6. Modify or generate R code. Use `ape`, `treeio`, `ggtree`, `ggtreeExtra`, and
   ordinary ggplot2 layers as appropriate; do not limit yourself to a fixed
   backend operation list.
7. Render candidate PNG/SVG/PDF files. Publish a preview when useful:

```bash
ggtree-air actions progress <action-id> --workspace <workspace> \
  --phase preview --percent 70 --message "已生成候选，正在检查重叠" \
  --preview <candidate.png>
```

8. Inspect the actual output. Compare it to the instruction and source image.
9. Iterate internally when the first attempt does not satisfy the request,
   updating progress at meaningful phase boundaries rather than emitting noisy
   token-level logs.
10. Commit only files that visibly changed and meet the request.

If the request explicitly asks for alternatives (for example “try three color
schemes”), commit multiple labeled files. Otherwise commit exactly one changed
artifact.

## Commit outputs

```bash
ggtree-air artifacts commit <action-id> \
  --workspace <workspace> \
  --agent <your-agent-name> \
  --file <output-a.png> \
  --file <output-b.png>
```

One committed file becomes one Artifact node. Multiple files become sibling
Artifact nodes from the same Action node.

After committing, if the user is still reviewing the browser, run `actions wait`
again so the next instruction triggers this same Agent session automatically.

If no candidate is visibly different or the request cannot be completed:

```bash
ggtree-air actions fail <action-id> \
  --workspace <workspace> \
  --message "<honest, user-readable reason>"
```

Do not commit unchanged files merely to make the workflow advance.

## Initial figure creation

When the user has not yet created a workspace, inspect the project for one
credible tree/distance/FASTA input and matching metadata. Ask only when several
biologically plausible inputs conflict.

A convenient first pass is:

```bash
ggtree-air auto --input <tree-or-fasta> [--metadata <table>] \
  --out results/<name>
```

Or use a source-backed recipe for exploration:

```bash
ggtree-air recipes list
ggtree-air recipes run <recipe> --out results/<name> --force
```

Open/reuse the browser without asking for a port:

```bash
ggtree-air open --workspace results/<name>
```

## Scientific defaults

- NJ output is unrooted unless an explicit outgroup justifies rooting.
- Branch length means the input distance metric, not automatically time.
- Group colors and clade labels are annotations, not evidence.
- Display bootstrap/posterior support when available.
- Revalidate node ids after topology changes.
- Dense trees should not display every tip label by default.
- Preserve metadata meaning, legends, and provenance.
- Never silently repair missing/duplicate taxa; use explicit logged repair.

## Completion standard

Before committing:

- the output is visibly different when a change was requested;
- only the requested source/layout is changed unless multiple outputs were
  explicitly requested;
- labels and tracks do not overlap materially;
- the user's selected area was considered;
- scientific interpretation remains honest;
- output labels are human-readable;
- one request corresponds to one Action node and 1..N real Artifact nodes.
