# Database

SQLite, normalized, four tables. The schema in `schema.json` is the source of truth; this file explains the reasoning and the non-obvious bits.

## Entities

- `users` — sign-in identity. MVP seeds one row (`user` / hash of `password`); schema supports many.
- `boards` — one Kanban board per user (MVP rule, not a DB constraint).
- `columns` — fixed-but-renameable columns inside a board, ordered by `position`.
- `cards` — items inside a column, ordered by `position`.

Maps directly onto the frontend types in `frontend/src/lib/kanban.ts`: `Card` → `cards`, `Column` → `columns` + `cards.column_id`/`cards.position`, `BoardData` → `boards` + its children.

## Tables

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE boards (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL
);

CREATE TABLE columns (
  id       TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title    TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE cards (
  id        TEXT PRIMARY KEY,
  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  details   TEXT NOT NULL DEFAULT '',
  position  INTEGER NOT NULL
);

CREATE INDEX idx_boards_user   ON boards(user_id);
CREATE INDEX idx_columns_board ON columns(board_id);
CREATE INDEX idx_cards_column  ON cards(column_id, position);
```

IDs are `TEXT` so the frontend's existing string IDs (`col-backlog`, `card-...`) and AI-generated IDs both fit without translation.

## Ordering

`position` is a plain integer, contiguous from 0 inside each column (or board, for `columns`). Every reorder renumbers the affected column(s) inside a transaction. Simple, matches the array-index model the frontend already uses (`moveCard` in `frontend/src/lib/kanban.ts:84-162`), and avoids the complexity of fractional indexing for a single-user MVP.

## Cascade

`ON DELETE CASCADE` on every foreign key. Deleting a user wipes their boards, columns, and cards in one statement. Deleting a column wipes its cards. This is the only delete behavior the UI needs.

## Worked example: move a card across columns

Move card `card-x` from column `col-a` (position 2) to column `col-b` at position 0:

```sql
BEGIN;

-- close the gap in the source column
UPDATE cards SET position = position - 1
  WHERE column_id = 'col-a' AND position > 2;

-- open a slot in the destination column
UPDATE cards SET position = position + 1
  WHERE column_id = 'col-b' AND position >= 0;

-- place the card
UPDATE cards SET column_id = 'col-b', position = 0
  WHERE id = 'card-x';

COMMIT;
```

Moves within a single column collapse to a single `UPDATE` shifting the affected range. Inserts and deletes use the same close-the-gap / open-the-slot pattern.

## Out of scope for the MVP

No `created_at` / `updated_at`. No soft-delete. No board-level metadata beyond `name`. Add if Parts 9–10 need them.
