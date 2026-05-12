# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Single-user Kanban PM MVP with an AI chat sidebar that can mutate the board. Login is hardcoded (`user` / `password`); schema supports multi-user.

## Tech stack

- Frontend: Next.js 16 (static export), React 19, Tailwind v4, `@dnd-kit` for drag-drop.
- Backend: FastAPI (Python 3.12), `uv` package manager, SQLite, `itsdangerous` signed session cookies.
- AI: Anthropic SDK, model `claude-opus-4-7`, key in `.env` as `CLAUDE_API_KEY`; `SECRET_KEY` also required.
- Packaging: Docker (multi-stage: Node builds frontend, Python serves it + API).

## Architecture

One container serves everything on port 8000. `next build` writes static HTML to `frontend/out/`; `backend/main.py` mounts that as `StaticFiles` at `/` — the mount must stay last, after all `/api/*` routes.

DB lives at `backend/data/kanban.db`, created and seeded on FastAPI startup (`db.init_db` in the lifespan handler). The `data/` dir is bind-mounted in Docker so it persists.

Card `position` is a contiguous integer per column; every move/insert/delete renumbers neighbors in one transaction (`db.move_card`). Every mutation joins through `boards.user_id` for ownership — follow the same pattern when adding routes.

AI flow: `/api/ai` embeds the current board JSON in the system prompt and exposes an `update_board` tool. Tool-use blocks are applied via `db.apply_board_update`; frontend refetches `/api/board` afterward.

## Coding conventions (from `AGENTS.md`)

1. Latest libs, idiomatic patterns.
2. Keep it simple — no over-engineering, no defensive programming, no extra features.
3. Concise. No emojis anywhere.
4. Root-cause bugs with evidence before fixing.

## Commands

Docker (prod-equivalent, http://localhost:8000):
```bash
./scripts/start.sh    # or scripts/start.ps1 on Windows
./scripts/stop.sh
```

Local dev:
```bash
cd backend  && uv sync --dev && uv run uvicorn main:app --reload
cd frontend && npm install && npm run dev    # http://localhost:3000
```

Tests / lint:
```bash
cd backend  && uv run pytest tests/ -v
cd frontend && npm run test:unit    # vitest
cd frontend && npm run test:e2e     # playwright (auto-starts next dev)
cd frontend && npm run lint
```

## Further reading

- `AGENTS.md` — business requirements, color scheme.
- `backend/AGENTS.md` — API routes table, auth, AI details.
- `docs/DATABASE.md` — schema and the move/reorder algorithm.
