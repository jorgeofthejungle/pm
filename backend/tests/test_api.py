import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import db as dbmod
import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    dbmod.init_db(db_path)
    monkeypatch.setattr(dbmod, "DB_PATH", db_path)
    monkeypatch.setattr(main, "STATIC_DIR", Path("/nonexistent"))
    with TestClient(main.app, raise_server_exceptions=True) as c:
        yield c


def _login(client):
    r = client.post("/api/login", json={"username": "user", "password": "password"})
    assert r.status_code == 200
    return r


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def test_login_ok(client):
    r = _login(client)
    assert r.json() == {"ok": True}
    assert "session" in client.cookies


def test_login_bad_password(client):
    r = client.post("/api/login", json={"username": "user", "password": "wrong"})
    assert r.status_code == 401


def test_logout(client):
    _login(client)
    r = client.post("/api/logout")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_me_authenticated(client):
    _login(client)
    r = client.get("/api/me")
    assert r.status_code == 200
    assert "userId" in r.json()


def test_me_unauthenticated(client):
    r = client.get("/api/me")
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Board
# ---------------------------------------------------------------------------

def test_get_board(client):
    _login(client)
    r = client.get("/api/board")
    assert r.status_code == 200
    data = r.json()
    assert "columns" in data
    assert "cards" in data
    assert len(data["columns"]) == 5
    assert len(data["cards"]) == 8


def test_get_board_unauthenticated(client):
    r = client.get("/api/board")
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Columns
# ---------------------------------------------------------------------------

def test_rename_column(client):
    _login(client)
    r = client.patch("/api/columns/col-backlog", json={"title": "Queue"})
    assert r.status_code == 200
    board = client.get("/api/board").json()
    col = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert col["title"] == "Queue"


def test_rename_column_not_found(client):
    _login(client)
    r = client.patch("/api/columns/col-fake", json={"title": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Cards — add
# ---------------------------------------------------------------------------

def test_add_card(client):
    _login(client)
    r = client.post("/api/columns/col-backlog/cards", json={"title": "New task", "details": "Details"})
    assert r.status_code == 200
    card = r.json()
    assert card["title"] == "New task"
    board = client.get("/api/board").json()
    assert card["id"] in board["cards"]


def test_add_card_bad_column(client):
    _login(client)
    r = client.post("/api/columns/col-fake/cards", json={"title": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Cards — update
# ---------------------------------------------------------------------------

def test_update_card(client):
    _login(client)
    r = client.patch("/api/cards/card-1", json={"title": "Updated"})
    assert r.status_code == 200
    board = client.get("/api/board").json()
    assert board["cards"]["card-1"]["title"] == "Updated"


def test_update_card_not_found(client):
    _login(client)
    r = client.patch("/api/cards/card-fake", json={"title": "X"})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Cards — delete
# ---------------------------------------------------------------------------

def test_delete_card(client):
    _login(client)
    r = client.delete("/api/cards/card-1")
    assert r.status_code == 200
    board = client.get("/api/board").json()
    assert "card-1" not in board["cards"]


def test_delete_card_not_found(client):
    _login(client)
    r = client.delete("/api/cards/card-fake")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Cards — move
# ---------------------------------------------------------------------------

def test_move_card_across_columns(client):
    _login(client)
    r = client.post("/api/cards/card-1/move", json={"targetColumnId": "col-done", "targetPosition": 0})
    assert r.status_code == 200
    board = client.get("/api/board").json()
    done = next(c for c in board["columns"] if c["id"] == "col-done")
    assert done["cardIds"][0] == "card-1"


def test_move_card_within_column(client):
    _login(client)
    r = client.post("/api/cards/card-1/move", json={"targetColumnId": "col-backlog", "targetPosition": 1})
    assert r.status_code == 200
    board = client.get("/api/board").json()
    backlog = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert backlog["cardIds"] == ["card-2", "card-1"]


def test_move_card_not_found(client):
    _login(client)
    r = client.post("/api/cards/card-fake/move", json={"targetColumnId": "col-done", "targetPosition": 0})
    assert r.status_code == 404
