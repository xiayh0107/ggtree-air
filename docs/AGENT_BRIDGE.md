# Universal Agent Bridge

`backend/src/agent-bridge/` is the provider-neutral boundary between a local
application and installed Agent CLIs. It follows the transport registry pattern
used by `ggai-v2`: product code creates a Run, the bridge selects a provider,
and provider-specific JSONL is normalized before the product sees it.

## Supported managed adapters

| Agent id | Probe | Non-interactive invocation | Stream |
| --- | --- | --- | --- |
| `pi` | `pi --version` | `pi --mode json --print ...` | Pi JSONL |
| `codex` | version + `codex login status` + flag compatibility | `codex exec --json ...` | Codex JSONL |
| `claude` | version + `claude auth status` + flag compatibility | `claude --print --output-format stream-json ...` | Claude stream JSON |

`auto` probes all registered adapters and chooses the first available adapter
according to `GGTREE_AIR_AGENT_PREFERENCE` (default `pi,codex,claude`). `none`
disables managed launch and leaves the Action for an external Agent consumer.

## User-facing selection

```bash
ggtree-air open --workspace results/task --agent auto
ggtree-air open --workspace results/task --agent pi
ggtree-air open --workspace results/task --agent codex
ggtree-air open --workspace results/task --agent claude
ggtree-air open --workspace results/task --agent none
```

Environment equivalents:

```bash
GGTREE_AIR_AGENT=codex
GGTREE_AIR_CODEX_COMMAND=/absolute/path/to/codex
GGTREE_AIR_CLAUDE_COMMAND=/absolute/path/to/claude
GGTREE_AIR_PI_COMMAND=/absolute/path/to/pi
GGTREE_AIR_AGENT_PREFERENCE=codex,claude,pi
```

The executable overrides use the correctly cased names
`GGTREE_AIR_CODEX_COMMAND`, `GGTREE_AIR_CLAUDE_COMMAND`, and
`GGTREE_AIR_PI_COMMAND`.

## Bidirectional interaction

Browser prompts and Agent chat prompts publish into the same durable Action
inbox. An Agent conversation uses `ggtree-air actions publish`; the workspace
service watches pending Actions and dispatches them through the selected managed
adapter. `origin.kind=agent-session` preserves where the request came from,
without creating a second execution model.

## Bridge contracts

An adapter owns only four responsibilities:

1. Resolve and probe one CLI without reading credentials.
2. Build a non-interactive process invocation from a common Run context.
3. Emit line-delimited process output.
4. Stop its process tree when the service closes.

The application-owned runner remains responsible for:

- Action claim ownership;
- exact source identities and prompt construction;
- the writable Run output directory;
- durable stdout/stderr capture;
- normalized tool-call history;
- rejecting empty or source-identical outputs;
- creating Artifact nodes only after `artifacts commit`.

The registry rejects duplicate adapter IDs and separates discovery from
selection. Adding another provider should require a new adapter plus event
normalizer, not branches throughout workspace, Action, or UI code.

## HTTP diagnostics

`GET /api/agents` returns every registered descriptor and the selected adapter:

```json
{
  "selected_agent": "codex",
  "agents": [
    {"id":"pi","available":true,"selected":false},
    {"id":"codex","available":true,"selected":true},
    {"id":"claude","available":true,"selected":false}
  ]
}
```

No API keys or credential contents are returned.

## Extraction into a standalone project

The bridge is intentionally isolated so it can become a standalone package
(for example `@ggtree-air/agent-bridge`) shared by other local applications.
A standalone release should add:

- a stable TypeScript adapter SDK;
- OS-level read-only input / write-only output sandboxes;
- session resume and cooperative cancellation contracts;
- permission-request normalization;
- bounded stdout and process-tree termination on every platform;
- conformance fixtures for each CLI version.

The current implementation is a local trusted-workspace bridge. It is not yet a
multi-user remote execution service.
