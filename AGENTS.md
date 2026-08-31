# Repository Guidelines

## Project Structure & Module Organization

`ggtree-air` combines a Node.js orchestrator, React canvas, and isolated R renderer. Backend code lives in `backend/src/`, with the executable in `backend/bin/` and tests in `backend/test/`. The Vite/React frontend is under `frontend/src/`; browser tests live in `frontend/`. Scientific rendering code is organized in numbered modules under `renderer/r/R/`, with fixtures and `testthat` tests alongside it. JSON contracts belong in `docs/schemas/`; agent instructions belong in `skills/ggtree-phylo/`. Treat `results/`, `frontend/dist/`, and downloaded `examples/treedata-book/data/` as generated content.

## Build, Test, and Development Commands

- `npm ci` installs the locked Node dependencies (Node 20+ and npm 10+).
- `npm run dev:frontend` starts the Vite development server.
- `npm run build:frontend` type-checks TypeScript and builds `frontend/dist/`.
- `npm run check` verifies the Node orchestrator and R renderer environment.
- `npm run fixture` creates a small workspace in `results/fixture`; `npm run serve` opens it.
- `npm test` runs the frontend build, Node backend tests, Playwright UI tests, and R `testthat` suite.
- `npm run syntax` performs quick Node syntax and TypeScript checks.

Use `make fixture`, `make serve`, or `make test` when Make is more convenient. Install R dependencies with `Rscript renderer/r/install-dependencies.R` before renderer tests.

## Coding Style & Naming Conventions

Use ES modules throughout JavaScript. Match existing style: two-space indentation, single quotes, semicolon-free TypeScript/JavaScript, `camelCase` functions and variables, and `PascalCase` React components. Keep backend filenames lowercase and hyphenated (for example, `scene-query.mjs`). R functions use `snake_case`; preserve the numbered pipeline filenames. TypeScript runs in strict mode; no separate formatter or linter is configured, so follow nearby code and run `npm run typecheck`.

## Testing Guidelines

Node tests use `node:test` and `node:assert/strict`; name files `*.test.mjs`. R tests use `testthat` and follow `test-*.R`. Add focused regression tests near the changed subsystem, use temporary directories for workspaces, and clean them in `finally` blocks. UI changes should include Playwright assertions. The repository has no numeric coverage threshold, but new behavior and bug fixes should be exercised by tests.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit-style prefixes such as `feat:`, `fix:`, `test:`, `docs:`, and `style:`. Keep subjects imperative and scoped to one logical change. Pull requests should explain the user-visible effect, list validation commands, link relevant issues, and include screenshots or recordings for canvas/UI changes. Call out schema, protocol, or R dependency changes explicitly; never commit generated workspaces, built assets, tokens, or local agent state.
