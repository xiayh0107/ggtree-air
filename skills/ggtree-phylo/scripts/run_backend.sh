#!/bin/sh
set -eu
if command -v ggtree-air >/dev/null 2>&1; then
  exec ggtree-air "$@"
fi
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
if [ -f "$PROJECT_ROOT/backend/bin/ggtree-air.mjs" ]; then
  exec node "$PROJECT_ROOT/backend/bin/ggtree-air.mjs" "$@"
fi
printf '%s\n' 'ggtree-air backend not found. Install it with: npm install -g ggtree-air' >&2
exit 127
