# Real Agent runtime

This runtime follows the Task/Run/Artifact separation used by
`/Users/xiayh/Projects/ggai-v2`: the canvas owns graph state, a Task/Action owns
one execution request, an external Agent CLI owns reasoning and tool calls, and
only verified files become output nodes.

## Non-negotiable invariants

1. Creating/opening a workspace does not create an Action or an output.
2. Importing a reference, tree, or table creates input Artifact nodes only.
3. An Action exists only after a user submits a node prompt (or an external API
   client explicitly creates it).
4. The application never marks an Action complete on behalf of a Demo.
5. A completed Action must contain one or more files committed by the Agent
   process through `artifacts commit`.
6. Reference images cannot be copied as output merely to advance the graph.
7. Agent stdout/stderr and actual tool calls are retained under the Action run
   directory and exposed by the Action log endpoint.

## Flow

```text
real input Artifact(s)
        │
        │ user selects context and submits a node prompt
        ▼
pending Action
        │
        │ LocalAgentRunner spawns an installed Agent CLI
        ▼
claimed/running Action ── real Agent tool calls ──> run files/
        │
        │ Agent invokes `ggtree-air artifacts commit`
        ▼
immutable output Artifact node(s)
```

The managed Pi adapter is a transport, not an embedded model loop. It launches
the user's installed and authenticated `pi` executable with the bundled
`ggtree-phylo` Skill. The application does not interpret the natural-language
request.

## Workspace bootstrap

```bash
ggtree-air workspace create --out results/task --title "My task"
ggtree-air artifacts import --workspace results/task \
  --file reference.png --role reference
ggtree-air artifacts import --workspace results/task \
  --file tree.nwk --file metadata.csv --role user-input
ggtree-air open --workspace results/task
```

The resulting canvas contains only those imported inputs. Renderer recipes are
integration fixtures and are not user-facing Agent histories.

## Transport modes

### Managed local Agent

Default for a workspace service. `POST /api/actions` creates the durable Action,
then `LocalAgentRunner` spawns the local Pi CLI. The Agent receives exact source
artifact identities, the user's prompt, the Skill, an isolated output directory,
and the commit protocol.

`GET /api/agents` reports whether the configured adapter is actually available.
`GET /api/actions/:id/log` returns parsed real tool-call activity.

### External Agent

Set:

```bash
GGTREE_AIR_AGENT=none ggtree-air open --workspace results/task
```

Then any Agent can attach through:

```bash
ggtree-air actions wait --workspace results/task --agent my-agent --timeout 3600
```

This preserves the Agent-independent protocol without creating a second fake
execution path.

## Run storage

```text
<workspace>/.ggtree-air/
├── actions/<action-id>.json
├── agent-runs/<action-id>/
│   ├── agent.jsonl       # actual process output and tool events
│   └── files/            # Agent-created candidate files
└── action-artifacts/<action-id>/
    └── ...               # committed immutable output copies
```

A process exit without a committed output fails the Action truthfully. A failed
or unavailable Agent never produces a green completion node.
