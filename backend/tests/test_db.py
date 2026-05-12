import tempfile
from pathlib import Path

import pytest

import db as dbmod


@pytest.fixture
def tmp_db(tmp_path):
    path = tmp_path / "test.db"
    dbmod.init_db(path)
    return path


def test_init_creates_tables(tmp_db):
    conn = dbmod.get_conn(tmp_db)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert {"users", "boards", "columns", "cards"}.issubset(tables)
    conn.close()


def test_init_seeds_user(tmp_db):
    conn = dbmod.get_conn(tmp_db)
    row = conn.execute("SELECT username FROM users WHERE username = 'user'").fetchone()
    assert row is not None
    conn.close()


def test_verify_user_ok(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    assert uid is not None


def test_verify_user_wrong_password(tmp_db):
    uid = dbmod.verify_user("user", "wrong", tmp_db)
    assert uid is None


def test_verify_user_unknown(tmp_db):
    uid = dbmod.verify_user("nobody", "password", tmp_db)
    assert uid is None


def test_get_board_structure(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    board = dbmod.get_board(uid, tmp_db)
    assert board is not None
    assert len(board["columns"]) == 5
    assert len(board["cards"]) == 8
    col_ids = [c["id"] for c in board["columns"]]
    assert col_ids == ["col-backlog", "col-discovery", "col-progress", "col-review", "col-done"]


def test_get_board_card_ids_ordered(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    board = dbmod.get_board(uid, tmp_db)
    backlog = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert backlog["cardIds"] == ["card-1", "card-2"]


def test_rename_column(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    ok = dbmod.rename_column("col-backlog", "Queue", uid, tmp_db)
    assert ok
    board = dbmod.get_board(uid, tmp_db)
    col = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert col["title"] == "Queue"


def test_rename_column_not_found(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    ok = dbmod.rename_column("col-fake", "X", uid, tmp_db)
    assert not ok


def test_add_card(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    card = dbmod.add_card("col-backlog", "New task", "Some details", "", uid, tmp_db)
    assert card is not None
    assert card["title"] == "New task"
    board = dbmod.get_board(uid, tmp_db)
    backlog = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert card["id"] in backlog["cardIds"]
    assert backlog["cardIds"][-1] == card["id"]


def test_add_card_bad_column(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    card = dbmod.add_card("col-fake", "X", "", "", uid, tmp_db)
    assert card is None


def test_delete_card(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    ok = dbmod.delete_card("card-1", uid, tmp_db)
    assert ok
    board = dbmod.get_board(uid, tmp_db)
    backlog = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert "card-1" not in backlog["cardIds"]
    assert "card-1" not in board["cards"]
    # positions renumbered: card-2 is now at 0
    conn = dbmod.get_conn(tmp_db)
    pos = conn.execute("SELECT position FROM cards WHERE id = 'card-2'").fetchone()[0]
    conn.close()
    assert pos == 0


def test_delete_card_not_found(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    ok = dbmod.delete_card("card-fake", uid, tmp_db)
    assert not ok


def test_move_card_across_columns(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    ok = dbmod.move_card("card-1", "col-done", 0, uid, tmp_db)
    assert ok
    board = dbmod.get_board(uid, tmp_db)
    backlog = next(c for c in board["columns"] if c["id"] == "col-backlog")
    done = next(c for c in board["columns"] if c["id"] == "col-done")
    assert "card-1" not in backlog["cardIds"]
    assert done["cardIds"][0] == "card-1"


def test_move_card_within_column(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    # card-1 at pos 0, card-2 at pos 1; move card-1 to pos 1
    ok = dbmod.move_card("card-1", "col-backlog", 1, uid, tmp_db)
    assert ok
    board = dbmod.get_board(uid, tmp_db)
    backlog = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert backlog["cardIds"] == ["card-2", "card-1"]


def test_update_card_title(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    ok = dbmod.update_card("card-1", "Updated title", None, None, uid, tmp_db)
    assert ok
    board = dbmod.get_board(uid, tmp_db)
    assert board["cards"]["card-1"]["title"] == "Updated title"


def test_update_card_details(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    ok = dbmod.update_card("card-1", None, "New details", None, uid, tmp_db)
    assert ok
    board = dbmod.get_board(uid, tmp_db)
    assert board["cards"]["card-1"]["details"] == "New details"


def test_update_card_not_found(tmp_db):
    uid = dbmod.verify_user("user", "password", tmp_db)
    ok = dbmod.update_card("card-fake", "X", None, None, uid, tmp_db)
    assert not ok


def test_idempotent_init(tmp_db):
    # Calling init_db a second time should not fail or duplicate seed data
    dbmod.init_db(tmp_db)
    conn = dbmod.get_conn(tmp_db)
    count = conn.execute("SELECT COUNT(*) FROM users WHERE username = 'user'").fetchone()[0]
    assert count == 1
    conn.close()
