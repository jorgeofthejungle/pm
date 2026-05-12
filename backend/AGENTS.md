# Backend

FastAPI Python backend. Serves the static Next.js export at `/` and provides the Kanban API at `/api/*`.

## Structure

- `main.py` — FastAPI app, all route handlers, session cookie auth
- `db.py` — SQLite layer: schema creation, seed data, CRUD helpers
- `tests/test_api.py` — API integration tests (TestClient, tmp SQLite)
- `tests/test_db.py` — DB unit tests (tmp SQLite)

## Running locally (without Docker)

```bash
uv sync --dev
uv run uvicorn main:app --reload
```

## Running tests

```bash
uv run pytest tests/ -v
```

## API routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/login` | No | `{username, password}` → sets session cookie |
| POST | `/api/logout` | No | Clears session cookie |
| GET | `/api/me` | Yes | Returns `{userId}` |
| GET | `/api/board` | Yes | Returns full board (columns + cards) |
| PATCH | `/api/columns/{id}` | Yes | Rename column `{title}` |
| POST | `/api/columns/{id}/cards` | Yes | Add card `{title, details?}` |
| PATCH | `/api/cards/{id}` | Yes | Update card `{title?, details?}` |
| DELETE | `/api/cards/{id}` | Yes | Delete card |
| POST | `/api/cards/{id}/move` | Yes | Move card `{targetColumnId, targetPosition}` |
| POST | `/api/ai` | Yes | AI chat `{message}` → `{reply}` |

## AI

Uses the Anthropic Python SDK (`anthropic` package). `CLAUDE_API_KEY` must be set in the environment (passed via `--env-file .env` in the start scripts). Model: `claude-opus-4-7`. Returns 503 if the key is missing.

## Auth

Cookie-based. `itsdangerous.URLSafeTimedSerializer` signs user IDs into an `httponly` session cookie (7-day TTL). MVP credentials: `user` / `password`.

## Database

SQLite at `data/kanban.db` (created on startup, relative to `backend/`). In Docker the `data/` directory is a volume mount so the DB persists across container restarts. See `docs/DATABASE.md` for schema details.
