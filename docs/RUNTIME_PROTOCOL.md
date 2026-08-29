# Node ↔ R renderer protocol

The backend starts a fresh `Rscript renderer/r/worker.R` process for every
check or render. The worker is not an HTTP server and owns no workspace state.

## Transport

JSON-RPC 2.0, one request and one response per process:

- request: UTF-8 JSON on stdin;
- response: UTF-8 JSON on stdout;
- progress and package messages: stderr;
- non-zero exit on protocol/render failure.

Example:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "render.run",
  "params": {
    "spec": {},
    "output_dir": "/workspace/.ggtree-air/build-...",
    "feedback": null
  }
}
```

Success:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "ok": true,
    "method": "render.run",
    "renderer": {"name": "ggtree-air-r", "version": "0.1.0"},
    "scene": "scene.json",
    "files": []
  }
}
```

Failure uses a JSON-RPC `error` with code `-32000`; Node treats a non-zero exit,
malformed JSON, timeout, or `error` response as a failed build. Temporary build
output is deleted and the current revision remains intact.

## Methods

- `dependencies.check`: report required/optional R package availability.
- `input.inspect`: return bounded tree/metadata facts used by automatic design inference.
- `render.run`: validate input, run phylogenetic analysis, compile supported
  feedback overlays, render artifacts, export metadata, and extract scene data.

## Ownership boundary

R may write only into the build directory supplied by Node. It does not:

- bind a network port;
- accept browser requests;
- persist annotations;
- choose revision numbers;
- archive or publish artifacts;
- manage authentication or mutation tokens;
- read skill files.

Node snapshots input files before invoking R, owns the build directory, checks
the response, packages the frontend, creates checksums, and atomically promotes
the completed build.
