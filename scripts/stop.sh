#!/usr/bin/env bash
set -euo pipefail

docker rm -f kanban-pm 2>/dev/null && echo "Stopped." || echo "Not running."
