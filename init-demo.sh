#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
frontend="$root/frontend"
vite_node="$frontend/node_modules/.bin/vite-node"

if [[ ! -x "$vite_node" ]]; then
  echo "Frontend dependencies are missing. Run 'make setup' first." >&2
  exit 1
fi

cd "$frontend"
exec "$vite_node" scripts/init-demo.ts "$@"
