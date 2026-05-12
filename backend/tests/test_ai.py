import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import db as dbmod
import main


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    dbmod.init_db(db_path)
    monkeypatch.setattr(dbmod, "DB_PATH", db_path)
    monkeypatch.setattr(main, "STATIC_DIR", Path("/nonexistent"))
    monkeypatch.setattr(main, "CLAUDE_API_KEY", "test-key")
    with TestClient(main.app, raise_server_exceptions=True) as c:
        yield c


def _login(client):
    r = client.post("/api/login", json={"username": "user", "password": "password"})
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# Helpers to build mock Anthropic responses
# ---------------------------------------------------------------------------

def _text_response(text: str):
    """Simulate a pure text reply (no tool call)."""
    block = MagicMock()
    block.type = "text"
    block.text = text
    msg = MagicMock()
    msg.content = [block]
    client = MagicMock()
    client.messages.create.return_value = msg
    return client


def _tool_response(text: str, operations: list[dict]):
    """Simulate a reply that includes both a text block and an update_board tool call."""
    text_block = MagicMock()
    text_block.type = "text"
    text_block.text = text

    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.name = "update_board"
    tool_block.input = {"operations": operations}

    msg = MagicMock()
    msg.content = [text_block, tool_block]
    client = MagicMock()
    client.messages.create.return_value = msg
    return client


def _tool_only_response(operations: list[dict]):
    """Simulate a reply with only a tool call and no text."""
    tool_block = MagicMock()
    tool_block.type = "tool_use"
    tool_block.name = "update_board"
    tool_block.input = {"operations": operations}

    msg = MagicMock()
    msg.content = [tool_block]
    client = MagicMock()
    client.messages.create.return_value = msg
    return client


# ---------------------------------------------------------------------------
# Basic connectivity
# ---------------------------------------------------------------------------

def test_ai_chat_requires_auth(client):
    r = client.post("/api/ai", json={"message": "hello"})
    assert r.status_code == 401


def test_ai_chat_no_key(client, monkeypatch):
    monkeypatch.setattr(main, "CLAUDE_API_KEY", "")
    _login(client)
    r = client.post("/api/ai", json={"message": "hello"})
    assert r.status_code == 503


# ---------------------------------------------------------------------------
# Text-only replies
# ---------------------------------------------------------------------------

def test_ai_chat_returns_text_reply(client):
    _login(client)
    mock_client = _text_response("4")
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "What is 2+2?"})
    assert r.status_code == 200
    data = r.json()
    assert data["reply"] == "4"
    assert data["boardUpdate"] is None


def test_ai_chat_no_board_update_when_text_only(client):
    _login(client)
    mock_client = _text_response("Here are the cards.")
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "What cards are in Backlog?"})
    assert r.json()["boardUpdate"] is None


# ---------------------------------------------------------------------------
# Board context is sent
# ---------------------------------------------------------------------------

def test_ai_receives_board_in_system_prompt(client):
    _login(client)
    mock_client = _text_response("ok")
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        client.post("/api/ai", json={"message": "hi"})
    call_kwargs = mock_client.messages.create.call_args.kwargs
    assert "system" in call_kwargs
    system_text = call_kwargs["system"][0]["text"]
    assert "col-backlog" in system_text
    assert "Backlog" in system_text
    assert "card-1" in system_text


def test_ai_receives_update_board_tool(client):
    _login(client)
    mock_client = _text_response("ok")
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        client.post("/api/ai", json={"message": "hi"})
    call_kwargs = mock_client.messages.create.call_args.kwargs
    assert "tools" in call_kwargs
    tool_names = [t["name"] for t in call_kwargs["tools"]]
    assert "update_board" in tool_names


# ---------------------------------------------------------------------------
# Conversation history
# ---------------------------------------------------------------------------

def test_ai_sends_history_in_messages(client):
    _login(client)
    mock_client = _text_response("ok")
    history = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"},
    ]
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        client.post("/api/ai", json={"message": "What now?", "history": history})
    messages = mock_client.messages.create.call_args.kwargs["messages"]
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "Hello"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "Hi there!"
    assert messages[2]["role"] == "user"
    assert messages[2]["content"] == "What now?"


def test_ai_empty_history_only_sends_current_message(client):
    _login(client)
    mock_client = _text_response("ok")
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        client.post("/api/ai", json={"message": "ping"})
    messages = mock_client.messages.create.call_args.kwargs["messages"]
    assert len(messages) == 1
    assert messages[0]["content"] == "ping"


# ---------------------------------------------------------------------------
# Board mutations via tool call
# ---------------------------------------------------------------------------

def test_ai_add_card_applies_to_db(client):
    _login(client)
    ops = [{"op": "add_card", "columnId": "col-backlog", "title": "AI task", "details": "From AI"}]
    mock_client = _tool_response("Added a card for you.", ops)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "Add a card"})
    assert r.status_code == 200
    data = r.json()
    assert data["reply"] == "Added a card for you."
    assert data["boardUpdate"] is not None
    assert data["boardUpdate"]["errors"] == []
    board = client.get("/api/board").json()
    backlog_titles = [board["cards"][cid]["title"] for cid in
                      next(c for c in board["columns"] if c["id"] == "col-backlog")["cardIds"]]
    assert "AI task" in backlog_titles


def test_ai_move_card_applies_to_db(client):
    _login(client)
    ops = [{"op": "move_card", "cardId": "card-1", "targetColumnId": "col-done", "targetPosition": 0}]
    mock_client = _tool_response("Moved card-1 to Done.", ops)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "Move card-1 to Done"})
    assert r.status_code == 200
    assert r.json()["boardUpdate"]["errors"] == []
    board = client.get("/api/board").json()
    done = next(c for c in board["columns"] if c["id"] == "col-done")
    assert "card-1" in done["cardIds"]
    assert "card-1" not in next(c for c in board["columns"] if c["id"] == "col-backlog")["cardIds"]


def test_ai_update_card_applies_to_db(client):
    _login(client)
    ops = [{"op": "update_card", "cardId": "card-1", "title": "AI retitled", "details": "New detail"}]
    mock_client = _tool_response("Updated.", ops)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "Rename card-1"})
    assert r.status_code == 200
    assert r.json()["boardUpdate"]["errors"] == []
    board = client.get("/api/board").json()
    assert board["cards"]["card-1"]["title"] == "AI retitled"
    assert board["cards"]["card-1"]["details"] == "New detail"


def test_ai_delete_card_applies_to_db(client):
    _login(client)
    ops = [{"op": "delete_card", "cardId": "card-1"}]
    mock_client = _tool_response("Deleted.", ops)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "Delete card-1"})
    assert r.status_code == 200
    assert r.json()["boardUpdate"]["errors"] == []
    board = client.get("/api/board").json()
    assert "card-1" not in board["cards"]


def test_ai_rename_column_applies_to_db(client):
    _login(client)
    ops = [{"op": "rename_column", "columnId": "col-backlog", "title": "Queue"}]
    mock_client = _tool_response("Renamed.", ops)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "Rename Backlog to Queue"})
    assert r.status_code == 200
    assert r.json()["boardUpdate"]["errors"] == []
    board = client.get("/api/board").json()
    col = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert col["title"] == "Queue"


def test_ai_multiple_operations_applied(client):
    _login(client)
    ops = [
        {"op": "add_card", "columnId": "col-done", "title": "Task A", "details": ""},
        {"op": "add_card", "columnId": "col-done", "title": "Task B", "details": ""},
    ]
    mock_client = _tool_response("Added two cards.", ops)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "Add two cards"})
    assert r.status_code == 200
    assert r.json()["boardUpdate"]["errors"] == []
    board = client.get("/api/board").json()
    done = next(c for c in board["columns"] if c["id"] == "col-done")
    titles = [board["cards"][cid]["title"] for cid in done["cardIds"]]
    assert "Task A" in titles
    assert "Task B" in titles


def test_ai_bad_card_id_reports_error(client):
    _login(client)
    ops = [{"op": "delete_card", "cardId": "card-nonexistent"}]
    mock_client = _tool_response("Done.", ops)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "Delete a card"})
    assert r.status_code == 200
    errors = r.json()["boardUpdate"]["errors"]
    assert len(errors) == 1
    assert "card-nonexistent" in errors[0]


def test_ai_bad_column_id_reports_error(client):
    _login(client)
    ops = [{"op": "add_card", "columnId": "col-fake", "title": "X", "details": ""}]
    mock_client = _tool_response("Done.", ops)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "Add a card"})
    assert r.status_code == 200
    errors = r.json()["boardUpdate"]["errors"]
    assert len(errors) == 1
    assert "col-fake" in errors[0]


def test_ai_tool_only_no_text_returns_empty_reply(client):
    _login(client)
    ops = [{"op": "add_card", "columnId": "col-backlog", "title": "Silent task", "details": ""}]
    mock_client = _tool_only_response(ops)
    with patch("main.anthropic.Anthropic", return_value=mock_client):
        r = client.post("/api/ai", json={"message": "Add silently"})
    assert r.status_code == 200
    assert r.json()["reply"] == ""
    assert r.json()["boardUpdate"]["errors"] == []


# ---------------------------------------------------------------------------
# apply_board_update unit tests
# ---------------------------------------------------------------------------

@pytest.fixture
def uid(tmp_path):
    path = tmp_path / "test.db"
    dbmod.init_db(path)
    return dbmod.verify_user("user", "password", path), path


def test_apply_add_card(uid):
    user_id, path = uid
    errors = dbmod.apply_board_update(
        [{"op": "add_card", "columnId": "col-backlog", "title": "New", "details": "D"}],
        user_id, path,
    )
    assert errors == []
    board = dbmod.get_board(user_id, path)
    backlog = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert "New" in [board["cards"][cid]["title"] for cid in backlog["cardIds"]]


def test_apply_rename_column(uid):
    user_id, path = uid
    errors = dbmod.apply_board_update(
        [{"op": "rename_column", "columnId": "col-backlog", "title": "Queue"}],
        user_id, path,
    )
    assert errors == []
    board = dbmod.get_board(user_id, path)
    col = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert col["title"] == "Queue"


def test_apply_unknown_op_is_error(uid):
    user_id, path = uid
    errors = dbmod.apply_board_update([{"op": "fly"}], user_id, path)
    assert len(errors) == 1
    assert "fly" in errors[0]


def test_apply_missing_required_field_is_error(uid):
    user_id, path = uid
    errors = dbmod.apply_board_update(
        [{"op": "add_card", "columnId": "col-backlog"}],  # missing title
        user_id, path,
    )
    assert len(errors) == 1


def test_apply_partial_success(uid):
    user_id, path = uid
    errors = dbmod.apply_board_update(
        [
            {"op": "add_card", "columnId": "col-backlog", "title": "Good", "details": ""},
            {"op": "delete_card", "cardId": "card-fake"},
        ],
        user_id, path,
    )
    assert len(errors) == 1
    assert "card-fake" in errors[0]
    board = dbmod.get_board(user_id, path)
    backlog = next(c for c in board["columns"] if c["id"] == "col-backlog")
    assert "Good" in [board["cards"][cid]["title"] for cid in backlog["cardIds"]]
