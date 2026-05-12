# Code review #1

**Date:** 2026-05-12
**Scope:** Full codebase — backend (FastAPI + SQLite + Anthropic), frontend (Next.js 16 + React 19 + @dnd-kit), infrastructure (Docker, scripts, config), and the 5 remaining docs.
**Method:** Three parallel Explore agents covered backend, frontend, and infra in their respective depths. ~67 raw findings were consolidated, de-duplicated, and two were directly verified against git state where the agents conflicted.
**Coding-standards constraint** (from `/AGENTS.md`): _latest libs, keep it simple, no over-engineering, no defensive programming, no extra features._ This frame is applied throughout — several findings the agents raised are explicitly **not** recommended below because the fix would violate it.

## Summary

| Priority | Count | Theme |
|---|---|---|
| P0 — must fix | 3 | Real security / data-hygiene leaks |
| P1 — should fix | 7 | Shipped correctness gaps, meaningful UX/a11y/test holes |
| P2 — worth doing | 5 | Simplifications that genuinely _delete_ code, not add it |
| Non-recommendations | 6 | Considered and rejected — adding them would violate "keep it simple" |

## Verified clean (no action)

- **`.env` is gitignored and was never committed.** `.gitignore:130` blocks it; `git log --all -- .env` returns empty. The backend agent flagged the local file as a "leaked API key" — that's incorrect. The key on your local disk is fine.
- **All other build-artefact paths are gitignored:** `node_modules/`, `.next/`, `.venv/`, `.pytest_cache/`, `frontend/out/`, `backend/data/` are all covered.
- **TypeScript strict mode is on** (`frontend/tsconfig.json:7`).
- **Docker multi-stage build does the right things:** `--no-dev`, `npm ci`, `--frozen` lockfiles, no `.env` baked in.
- **Test data is isolated** via `tmp_path` fixtures in backend pytest.

---

## P0 — must fix

### 1. Stray `backend/kanban.db` is tracked in git
- **Location:** `/backend/kanban.db` (53 KB) — verified with `git ls-files backend/kanban.db`.
- **Issue:** The runtime DB lives at `backend/data/kanban.db` (gitignored). A second, stale DB at `backend/kanban.db` was committed at some point and is _not_ ignored. Likely a leftover from an early iteration where `DB_PATH` was different.
- **Why it matters:** Source control should not carry runtime data. If someone runs the app from a path mismatch they'll be working against the stale committed copy instead of the real one. Also creates merge-conflict noise on binary blobs.
- **Approach:** `git rm backend/kanban.db` and add `backend/*.db` to `.gitignore` (the data/ dir is already covered; this only catches strays at the wrong level).
- **Why this approach:** One commit, deletes ~53 KB of confusion. No code change needed.

### 2. Hardcoded `SECRET_KEY` in source
- **Location:** `backend/main.py:17` — `SECRET_KEY = "kanban-secret-change-in-prod"`.
- **Issue:** The key signing session cookies is in the repo. Anyone with read access can forge a valid session.
- **Why it matters:** This is the entire MVP's auth boundary. The comment "change-in-prod" acknowledges the issue but does nothing about it.
- **Approach:** Read from `os.environ["SECRET_KEY"]` with a deterministic dev fallback only when an env var is absent _and_ a `DEBUG` flag is set; otherwise hard-fail at startup. Add `SECRET_KEY` to `.env` next to `CLAUDE_API_KEY`.
- **Why this approach:** Mirrors how `CLAUDE_API_KEY` is already handled (`backend/main.py:14`), so no new pattern to learn. The hard-fail prevents accidental shipping with a default; the dev fallback keeps `uv run uvicorn` painless for local work.

### 3. Session cookie missing `secure=True`
- **Location:** `backend/main.py:48–54` (the `response.set_cookie(...)` in `/api/login`).
- **Issue:** `httponly` and `samesite="lax"` are set, but `secure` is not. Over plain HTTP, the signed cookie can be sniffed.
- **Why it matters:** Today the app runs on `localhost:8000` so it's moot, but the only deployment friction between MVP and "ship it on a VPS" is HTTPS. Better to set `secure` conditionally now than to forget.
- **Approach:** `secure=not DEBUG` (or read from env). Set the cookie's `secure` flag from a single boolean that defaults to `True`.
- **Why this approach:** Default-secure with an explicit dev escape hatch is one line of code. This is real prod-readiness, not defensive programming.

---

## P1 — should fix

### 4. AI tool-use loop is single-shot
- **Location:** `backend/main.py:260–294`.
- **Issue:** The code reads tool-use blocks from one Anthropic response and applies them, then returns. There's no second `messages.create` call to feed the tool result back to Claude, so the model can't follow up ("I added card X, now do Y"). It also ignores `stop_reason`.
- **Why it matters:** The product description says the AI can "create / edit / move one or more cards." Multi-step requests today silently do only what fits in the first turn.
- **Approach:** Loop on `stop_reason == "tool_use"`: send the tool result back as a `tool_result` block, re-call the API, stop on `stop_reason == "end_turn"` or after N=5 iterations. Treat malformed `block.input` (missing `operations`) as an explicit error returned to the user, not a silent empty list.
- **Why this approach:** This is what the Anthropic SDK expects for tool use. Bounded iterations prevent runaway costs.

### 5. Drag-drop optimistic update has no failure path
- **Location:** `frontend/src/components/KanbanBoard.tsx:50–66`.
- **Issue:** On drag end, state is updated locally and `api.moveCard` is fired. On failure the code calls `refreshBoard()` which snaps back to the server state, but there's a window where another drag can land on the optimistic state and produce inconsistent positions.
- **Why it matters:** Drag-drop is the headline interaction. Inconsistent positions are user-visible.
- **Approach:** Replace the manual setState + catch with React 19's `useOptimistic`. The actual server state stays in the source of truth; the optimistic state is automatically discarded if the action rejects.
- **Why this approach:** `useOptimistic` is fewer lines than what's there now (this is a simplification, not a feature add) and removes the race entirely. Aligned with "latest libs, idiomatic patterns."

### 6. Login error always shows "Invalid username or password"
- **Location:** `frontend/src/components/LoginForm.tsx:24`.
- **Issue:** Any error — network failure, 500 from backend, actual auth failure — surfaces the same string.
- **Why it matters:** Users can't tell whether the backend is down or they typed the wrong password. Trivial fix; real UX cost.
- **Approach:** Distinguish HTTP 401 from network/5xx in the catch. Two strings: "Invalid username or password" vs. "Server unreachable — try again".
- **Why this approach:** Two branches, no new abstraction. Honest UX.

### 7. AI sidebar conversation history is unbounded
- **Location:** `frontend/src/components/AiSidebar.tsx` (state `messages`).
- **Issue:** Every turn appends to the array forever. The server also receives the full history each call (`api.ts:62` accepts an open-ended `{role, content}[]`).
- **Why it matters:** Long sessions get slow on the client _and_ expensive on the API (every Anthropic call re-sends the entire history without prompt caching).
- **Approach:** (a) Cap the in-memory window to the last N=50 messages displayed. (b) On the backend, enable Anthropic prompt caching on the system prompt (which contains the board JSON) so repeated calls don't re-pay for it.
- **Why this approach:** Both ends of the cost. Prompt caching is a header flag, not new code.

### 8. Drag handle has no ARIA semantics
- **Location:** `frontend/src/components/KanbanCard.tsx:20–31`.
- **Issue:** The whole card is the drag target; nothing announces it as draggable to a screen reader, and there's no keyboard-drag path.
- **Why it matters:** This is the primary interaction in the app — currently unusable without a mouse.
- **Approach:** Add `role="button"`, `aria-roledescription="draggable card"`, and a `tabIndex={0}` so the card is focusable. `@dnd-kit/core` ships a `useKeyboardSensor`; register it alongside the existing pointer sensor.
- **Why this approach:** First-class @dnd-kit feature, not a custom keyboard handler. ~5 lines.

### 9. Playwright drag test relies on mouse timing, no API wait
- **Location:** `frontend/tests/kanban.spec.ts:72–95`.
- **Issue:** The drag is performed via manual `mouse.move` calls; the next assertion fires immediately without waiting for `/api/cards/*/move` to return.
- **Why it matters:** Will go flaky on the first slow CI machine.
- **Approach:** Wrap the drag in `await Promise.all([page.waitForResponse(r => r.url().includes("/move")), …drag steps…])`. Same pattern can apply to the column-rename test.
- **Why this approach:** Explicit wait on the resource that actually matters; no arbitrary timeouts.

### 10. `any` casts in component tests
- **Location:** `frontend/src/components/KanbanBoard.test.tsx:41`, `AiSidebar.test.tsx:14`.
- **Issue:** Mocks are typed `as any`, defeating the test files' own type safety.
- **Why it matters:** A type-level mismatch between mock signature and real `api.ts` will go undetected; refactors to `api.ts` won't break tests that should break.
- **Approach:** Replace `as any` with `vi.mocked(api)` from Vitest. No extra dependency.
- **Why this approach:** Vitest's built-in helper, two-character change per call site.

---

## P2 — worth doing (simplifications that delete code)

### 11. `update_card` has three near-identical UPDATE branches
- **Location:** `backend/db.py:336–361`.
- **Issue:** Separate code paths for (title only), (details only), (both).
- **Approach:** Single UPDATE: `SET title = COALESCE(?, title), details = COALESCE(?, details)`.
- **Why:** Strictly fewer lines and matches SQLite's idiom.

### 12. `api.ts` has dead `typeof window` fallback
- **Location:** `frontend/src/lib/api.ts:3`.
- **Issue:** Static export only ever runs in the browser. The `localhost:8000` fallback is unreachable.
- **Approach:** Replace the conditional with `const BASE = ""`. The fetch calls will use the same origin.
- **Why:** Deletes dead code; one less thing to reason about.

### 13. Class-list strings mix `[...].join(" ")` and `clsx`
- **Location:** `frontend/src/components/KanbanBoard.tsx:142–146`, `AiSidebar.tsx:82–87`, others.
- **Issue:** `clsx` is already imported in some places; arrays-joined-by-space is used in others.
- **Approach:** Standardize on `clsx` everywhere.
- **Why:** Consistency for free; `clsx` handles falsy values better than `join`.

### 14. Hardcoded drag-overlay gradient colors
- **Location:** `frontend/src/components/KanbanBoard.tsx:138–139`.
- **Issue:** `rgba(32,157,215,0.25)` and `rgba(117,57,145,0.18)` are the project's `--primary-blue` and `--secondary-purple` with alpha, but hardcoded.
- **Approach:** Use `color-mix(in srgb, var(--primary-blue) 25%, transparent)` (or define a `--primary-blue-glow` CSS var if used in more than one place).
- **Why:** When the color scheme changes (and per `/AGENTS.md` it might), one fewer place to chase.

### 15. Ownership-check SQL repeated across every mutation
- **Location:** `backend/db.py:156–168, 171–196, 199–223, 226–290, 336–361`.
- **Issue:** Every write joins through `boards.user_id` to check ownership, copy-pasted.
- **Approach:** _Conditional_ — extract a `_assert_owns_card(conn, user_id, card_id)` helper only if the duplication is causing actual maintenance pain. For 5 call sites of identical 2-line SQL, "three similar lines is better than a premature abstraction" applies (per the project's own coding standard). **Leave as-is unless you're about to add a sixth call site.**
- **Why:** Listed for transparency, but I'm explicitly not recommending the change.

---

## Non-recommendations

These came up in the agent passes; I'm flagging _why I would not do them_, so they don't get re-litigated.

- **Add bcrypt / salted password hashing.** The MVP has hardcoded `user`/`password` seeded once. Upgrading the hash without a credential-management surface buys nothing.
- **Add a `.dockerignore`.** The build context is small (frontend/ ships its own .gitignore; backend/ has no node_modules). The agent flagged this generically; in this project it's a no-op savings.
- **Run Docker as non-root.** Real prod hardening, but this container only ever runs on a developer's laptop today. Worth a 1-line `USER app` if/when there's a real deployment.
- **Add Prettier + pre-commit hooks.** Two tools and a config file added per developer to enforce style on a single-developer MVP. Violates "keep it simple."
- **Add GitHub Actions CI.** Worth doing _if_ a second contributor joins. For solo work, running `pytest` and `npm test` locally before committing is enough — and what's already happening.
- **Centralize props-drilling via Context for `onDeleteCard` etc.** Three levels of callback prop is fine; Context would be heavier than the current pattern.

---

## Suggested execution order

1. **One commit, no code:** delete `backend/kanban.db` and add it to `.gitignore` (item 1).
2. **One commit, two lines:** `SECRET_KEY` and `secure` cookie flag from env (items 2, 3).
3. **One commit per area** for P1: AI loop (4), useOptimistic (5), login errors (6), history cap + prompt caching (7), drag a11y (8), Playwright waits (9), `vi.mocked` (10). These don't depend on each other; do in any order.
4. **P2 cleanups in a single "tidy" commit** (items 11, 12, 13, 14). Item 15 is explicitly skipped.

Total: ~10 commits, each small, each independently revertible. Nothing in this list adds a new dependency or a new abstraction layer.
