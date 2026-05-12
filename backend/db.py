import hashlib
import sqlite3
import uuid
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "kanban.db"

_SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS boards (
    id      TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS columns (
    id       TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
    id        TEXT PRIMARY KEY,
    column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    title     TEXT NOT NULL,
    details   TEXT NOT NULL DEFAULT '',
    notes     TEXT NOT NULL DEFAULT '',
    position  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_boards_user   ON boards(user_id);
CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(board_id);
CREATE INDEX IF NOT EXISTS idx_cards_column  ON cards(column_id, position);
"""

_SEED_COLUMNS = [
    ("col-backlog",   "Backlog",     0),
    ("col-discovery", "Discovery",   1),
    ("col-progress",  "In Progress", 2),
    ("col-review",    "Review",      3),
    ("col-done",      "Done",        4),
]

_SEED_CARDS = [
    ("card-1", "col-backlog",   "Align roadmap themes",     "Draft quarterly themes with impact statements and metrics.", 0),
    ("card-2", "col-backlog",   "Gather customer signals",   "Review support tags, sales notes, and churn feedback.",      1),
    ("card-3", "col-discovery", "Prototype analytics view",  "Sketch initial dashboard layout and key drill-downs.",        0),
    ("card-4", "col-progress",  "Refine status language",    "Standardize column labels and tone across the board.",        0),
    ("card-5", "col-progress",  "Design card layout",        "Add hierarchy and spacing for scanning dense lists.",          1),
    ("card-6", "col-review",    "QA micro-interactions",     "Verify hover, focus, and loading states.",                    0),
    ("card-7", "col-done",      "Ship marketing page",       "Final copy approved and asset pack delivered.",                0),
    ("card-8", "col-done",      "Close onboarding sprint",   "Document release notes and share internally.",                1),
]


def _hash(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def get_conn(path: Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path: Path = DB_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = get_conn(path)
    with conn:
        conn.executescript(_SCHEMA)
        try:
            conn.execute("ALTER TABLE cards ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
        except Exception:
            pass
        user_id = str(uuid.uuid4())
        conn.execute(
            "INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (?, ?, ?)",
            (user_id, "user", _hash("password")),
        )
        row = conn.execute("SELECT id FROM users WHERE username = 'user'").fetchone()
        user_id = row["id"]

        board_id = "board-main"
        conn.execute(
            "INSERT OR IGNORE INTO boards (id, user_id, name) VALUES (?, ?, ?)",
            (board_id, user_id, "My Board"),
        )
        for col_id, title, pos in _SEED_COLUMNS:
            conn.execute(
                "INSERT OR IGNORE INTO columns (id, board_id, title, position) VALUES (?, ?, ?, ?)",
                (col_id, board_id, title, pos),
            )
        for card_id, col_id, title, details, pos in _SEED_CARDS:
            conn.execute(
                "INSERT OR IGNORE INTO cards (id, column_id, title, details, position) VALUES (?, ?, ?, ?, ?)",
                (card_id, col_id, title, details, pos),
            )
    conn.close()


def verify_user(username: str, password: str, path: Path = DB_PATH) -> str | None:
    conn = get_conn(path)
    row = conn.execute(
        "SELECT id FROM users WHERE username = ? AND password_hash = ?",
        (username, _hash(password)),
    ).fetchone()
    conn.close()
    return row["id"] if row else None


def get_board(user_id: str, path: Path = DB_PATH) -> dict | None:
    conn = get_conn(path)
    board = conn.execute(
        "SELECT id, name FROM boards WHERE user_id = ?", (user_id,)
    ).fetchone()
    if not board:
        conn.close()
        return None

    cols = conn.execute(
        "SELECT id, title, position FROM columns WHERE board_id = ? ORDER BY position",
        (board["id"],),
    ).fetchall()

    cards_rows = conn.execute(
        """
        SELECT c.id, c.column_id, c.title, c.details, c.notes, c.position
        FROM cards c
        JOIN columns col ON col.id = c.column_id
        WHERE col.board_id = ?
        ORDER BY c.column_id, c.position
        """,
        (board["id"],),
    ).fetchall()
    conn.close()

    cards_by_col: dict[str, list] = {col["id"]: [] for col in cols}
    cards: dict[str, dict] = {}
    for r in cards_rows:
        cards[r["id"]] = {"id": r["id"], "title": r["title"], "details": r["details"], "notes": r["notes"]}
        cards_by_col[r["column_id"]].append(r["id"])

    return {
        "columns": [
            {"id": col["id"], "title": col["title"], "cardIds": cards_by_col[col["id"]]}
            for col in cols
        ],
        "cards": cards,
    }


def rename_column(column_id: str, title: str, user_id: str, path: Path = DB_PATH) -> bool:
    conn = get_conn(path)
    with conn:
        cur = conn.execute(
            """
            UPDATE columns SET title = ?
            WHERE id = ?
              AND board_id IN (SELECT id FROM boards WHERE user_id = ?)
            """,
            (title, column_id, user_id),
        )
    conn.close()
    return cur.rowcount == 1


def add_card(column_id: str, title: str, details: str, notes: str, user_id: str, path: Path = DB_PATH) -> dict | None:
    conn = get_conn(path)
    try:
        owned = conn.execute(
            """
            SELECT 1 FROM columns col
            JOIN boards b ON b.id = col.board_id
            WHERE col.id = ? AND b.user_id = ?
            """,
            (column_id, user_id),
        ).fetchone()
        if not owned:
            return None
        pos = conn.execute(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM cards WHERE column_id = ?",
            (column_id,),
        ).fetchone()[0]
        card_id = "card-" + uuid.uuid4().hex[:8]
        with conn:
            conn.execute(
                "INSERT INTO cards (id, column_id, title, details, notes, position) VALUES (?, ?, ?, ?, ?, ?)",
                (card_id, column_id, title, details, notes, pos),
            )
        return {"id": card_id, "title": title, "details": details, "notes": notes}
    finally:
        conn.close()


def delete_card(card_id: str, user_id: str, path: Path = DB_PATH) -> bool:
    conn = get_conn(path)
    try:
        col_row = conn.execute("SELECT column_id, position FROM cards WHERE id = ?", (card_id,)).fetchone()
        if not col_row:
            return False
        owned = conn.execute(
            """
            SELECT 1 FROM columns col
            JOIN boards b ON b.id = col.board_id
            WHERE col.id = ? AND b.user_id = ?
            """,
            (col_row["column_id"], user_id),
        ).fetchone()
        if not owned:
            return False
        with conn:
            conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))
            conn.execute(
                "UPDATE cards SET position = position - 1 WHERE column_id = ? AND position > ?",
                (col_row["column_id"], col_row["position"]),
            )
        return True
    finally:
        conn.close()


def move_card(card_id: str, target_column_id: str, target_position: int, user_id: str, path: Path = DB_PATH) -> bool:
    conn = get_conn(path)
    try:
        src = conn.execute(
            "SELECT column_id, position FROM cards WHERE id = ?", (card_id,)
        ).fetchone()
        if not src:
            return False
        board_row = conn.execute(
            """
            SELECT b.id FROM boards b
            JOIN columns col ON col.board_id = b.id
            WHERE col.id = ? AND b.user_id = ?
            """,
            (src["column_id"], user_id),
        ).fetchone()
        if not board_row:
            return False
        tgt_col = conn.execute(
            "SELECT 1 FROM columns WHERE id = ? AND board_id = ?",
            (target_column_id, board_row["id"]),
        ).fetchone()
        if not tgt_col:
            return False

        src_col = src["column_id"]
        src_pos = src["position"]

        max_pos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) FROM cards WHERE column_id = ? AND id != ?",
            (target_column_id, card_id),
        ).fetchone()[0]
        tgt_pos = min(target_position, max_pos + 1)

        with conn:
            if src_col == target_column_id:
                if src_pos == tgt_pos:
                    return True
                if src_pos < tgt_pos:
                    conn.execute(
                        "UPDATE cards SET position = position - 1 WHERE column_id = ? AND position > ? AND position <= ? AND id != ?",
                        (src_col, src_pos, tgt_pos, card_id),
                    )
                else:
                    conn.execute(
                        "UPDATE cards SET position = position + 1 WHERE column_id = ? AND position >= ? AND position < ? AND id != ?",
                        (src_col, tgt_pos, src_pos, card_id),
                    )
                conn.execute("UPDATE cards SET position = ? WHERE id = ?", (tgt_pos, card_id))
            else:
                conn.execute(
                    "UPDATE cards SET position = position - 1 WHERE column_id = ? AND position > ?",
                    (src_col, src_pos),
                )
                conn.execute(
                    "UPDATE cards SET position = position + 1 WHERE column_id = ? AND position >= ?",
                    (target_column_id, tgt_pos),
                )
                conn.execute(
                    "UPDATE cards SET column_id = ?, position = ? WHERE id = ?",
                    (target_column_id, tgt_pos, card_id),
                )
        return True
    finally:
        conn.close()


def apply_board_update(operations: list[dict], user_id: str, path: Path = DB_PATH) -> list[str]:
    """Apply a list of board mutation operations from the AI.

    Each operation is a dict with a required "op" key:
      {"op": "add_card",    "columnId": str, "title": str, "details": str}
      {"op": "move_card",   "cardId": str, "targetColumnId": str, "targetPosition": int}
      {"op": "update_card", "cardId": str, "title"?: str, "details"?: str}
      {"op": "delete_card", "cardId": str}
      {"op": "rename_column", "columnId": str, "title": str}

    Returns a list of error strings for any operations that failed.
    """
    errors: list[str] = []
    for op in operations:
        kind = op.get("op")
        try:
            if kind == "add_card":
                result = add_card(op["columnId"], op["title"], op.get("details", ""), op.get("notes", ""), user_id, path)
                if result is None:
                    errors.append(f"add_card: column '{op['columnId']}' not found")
            elif kind == "move_card":
                ok = move_card(op["cardId"], op["targetColumnId"], op["targetPosition"], user_id, path)
                if not ok:
                    errors.append(f"move_card: card '{op['cardId']}' or column not found")
            elif kind == "update_card":
                ok = update_card(op["cardId"], op.get("title"), op.get("details"), op.get("notes"), user_id, path)
                if not ok:
                    errors.append(f"update_card: card '{op['cardId']}' not found")
            elif kind == "delete_card":
                ok = delete_card(op["cardId"], user_id, path)
                if not ok:
                    errors.append(f"delete_card: card '{op['cardId']}' not found")
            elif kind == "rename_column":
                ok = rename_column(op["columnId"], op["title"], user_id, path)
                if not ok:
                    errors.append(f"rename_column: column '{op['columnId']}' not found")
            else:
                errors.append(f"unknown op '{kind}'")
        except (KeyError, TypeError) as exc:
            errors.append(f"{kind}: bad arguments — {exc}")
    return errors


def update_card(card_id: str, title: str | None, details: str | None, notes: str | None, user_id: str, path: Path = DB_PATH) -> bool:
    if title is None and details is None and notes is None:
        return True
    conn = get_conn(path)
    try:
        owned = conn.execute(
            """
            SELECT 1 FROM cards c
            JOIN columns col ON col.id = c.column_id
            JOIN boards b ON b.id = col.board_id
            WHERE c.id = ? AND b.user_id = ?
            """,
            (card_id, user_id),
        ).fetchone()
        if not owned:
            return False
        with conn:
            conn.execute(
                "UPDATE cards SET title = COALESCE(?, title), details = COALESCE(?, details), notes = COALESCE(?, notes) WHERE id = ?",
                (title, details, notes, card_id),
            )
        return True
    finally:
        conn.close()
