#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
IMAGE="kanban-pm"
CONTAINER="kanban-pm"

docker build -t "$IMAGE" "$ROOT"
docker rm -f "$CONTAINER" 2>/dev/null || true
docker run -d \
  --name "$CONTAINER" \
  -p 8000:8000 \
  -v "$ROOT/data:/app/data" \
  --env-file "$ROOT/.env" \
  "$IMAGE"

echo "Running at http://localhost:8000"
