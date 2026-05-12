import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import anthropic
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

import db

CLAUDE_API_KEY = os.environ.get("CLAUDE_API_KEY", "")
AI_MODEL = "claude-opus-4-7"

SECRET_KEY = "kanban-secret-change-in-prod"
_signer = URLSafeTimedSerializer(SECRET_KEY)

STATIC_DIR = Path(__file__).parent.parent / "frontend" / "out"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db(db.DB_PATH)
    yield


app = FastAPI(lifespan=lifespan)


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def _sign(user_id: str) -> str:
    return _signer.dumps(user_id)


def _unsign(token: str) -> str | None:
    try:
        return _signer.loads(token, max_age=86400 * 7)
    except (BadSignature, SignatureExpired):
        return None


def _set_session(response: Response, user_id: str) -> None:
    response.set_cookie(
        "session",
        _sign(user_id),
        httponly=True,
        samesite="lax",
        max_age=86400 * 7,
    )


def get_current_user(request: Request) -> str:
    token = request.cookies.get("session")
    user_id = _unsign(token) if token else None
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user_id


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/login")
def login(body: LoginRequest, response: Response):
    user_id = db.verify_user(body.username, body.password, db.DB_PATH)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    _set_session(response, user_id)
    return {"ok": True}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie("session")
    return {"ok": True}


@app.get("/api/me")
def me(user_id: str = Depends(get_current_user)):
    return {"userId": user_id}


# ---------------------------------------------------------------------------
# Board routes
# ---------------------------------------------------------------------------

@app.get("/api/board")
def get_board(user_id: str = Depends(get_current_user)):
    board = db.get_board(user_id, db.DB_PATH)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")
    return board


class RenameColumnRequest(BaseModel):
    title: str


@app.patch("/api/columns/{column_id}")
def rename_column(column_id: str, body: RenameColumnRequest, user_id: str = Depends(get_current_user)):
    if not db.rename_column(column_id, body.title, user_id, db.DB_PATH):
        raise HTTPException(status_code=404, detail="Column not found")
    return {"ok": True}


class AddCardRequest(BaseModel):
    title: str
    details: str = ""


@app.post("/api/columns/{column_id}/cards")
def add_card(column_id: str, body: AddCardRequest, user_id: str = Depends(get_current_user)):
    card = db.add_card(column_id, body.title, body.details, user_id, db.DB_PATH)
    if not card:
        raise HTTPException(status_code=404, detail="Column not found")
    return card


class UpdateCardRequest(BaseModel):
    title: Optional[str] = None
    details: Optional[str] = None


@app.patch("/api/cards/{card_id}")
def update_card(card_id: str, body: UpdateCardRequest, user_id: str = Depends(get_current_user)):
    if not db.update_card(card_id, body.title, body.details, user_id, db.DB_PATH):
        raise HTTPException(status_code=404, detail="Card not found")
    return {"ok": True}


@app.delete("/api/cards/{card_id}")
def delete_card(card_id: str, user_id: str = Depends(get_current_user)):
    if not db.delete_card(card_id, user_id, db.DB_PATH):
        raise HTTPException(status_code=404, detail="Card not found")
    return {"ok": True}


class MoveCardRequest(BaseModel):
    targetColumnId: str
    targetPosition: int


@app.post("/api/cards/{card_id}/move")
def move_card(card_id: str, body: MoveCardRequest, user_id: str = Depends(get_current_user)):
    if not db.move_card(card_id, body.targetColumnId, body.targetPosition, user_id, db.DB_PATH):
        raise HTTPException(status_code=404, detail="Card or column not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# AI route
# ---------------------------------------------------------------------------

_UPDATE_BOARD_TOOL = {
    "name": "update_board",
    "description": (
        "Apply one or more mutations to the user's Kanban board. "
        "Call this whenever the user asks you to create, move, edit, or delete cards, "
        "or rename columns. You may combine multiple operations in a single call."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "operations": {
                "type": "array",
                "description": "Ordered list of board mutations to apply.",
                "items": {
                    "oneOf": [
                        {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "enum": ["add_card"]},
                                "columnId": {"type": "string"},
                                "title": {"type": "string"},
                                "details": {"type": "string", "default": ""},
                            },
                            "required": ["op", "columnId", "title"],
                        },
                        {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "enum": ["move_card"]},
                                "cardId": {"type": "string"},
                                "targetColumnId": {"type": "string"},
                                "targetPosition": {"type": "integer", "minimum": 0},
                            },
                            "required": ["op", "cardId", "targetColumnId", "targetPosition"],
                        },
                        {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "enum": ["update_card"]},
                                "cardId": {"type": "string"},
                                "title": {"type": "string"},
                                "details": {"type": "string"},
                            },
                            "required": ["op", "cardId"],
                        },
                        {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "enum": ["delete_card"]},
                                "cardId": {"type": "string"},
                            },
                            "required": ["op", "cardId"],
                        },
                        {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "enum": ["rename_column"]},
                                "columnId": {"type": "string"},
                                "title": {"type": "string"},
                            },
                            "required": ["op", "columnId", "title"],
                        },
                    ]
                },
            }
        },
        "required": ["operations"],
    },
}


class HistoryMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class AiRequest(BaseModel):
    message: str
    history: list[HistoryMessage] = []


def _build_system_prompt(board: dict) -> str:
    import json
    board_json = json.dumps(board, indent=2)
    return (
        "You are a helpful Kanban board assistant. "
        "The user's current board state is shown below as JSON. "
        "Answer questions about the board and help the user manage it. "
        "When the user asks you to change the board (add, move, edit, or delete cards; rename columns), "
        "call the update_board tool with the appropriate operations. "
        "Always include a friendly, concise reply in your text response — even when you call the tool.\n\n"
        f"Current board:\n```json\n{board_json}\n```"
    )


@app.post("/api/ai")
def ai_chat(body: AiRequest, user_id: str = Depends(get_current_user)):
    if not CLAUDE_API_KEY:
        raise HTTPException(status_code=503, detail="AI not configured")

    board = db.get_board(user_id, db.DB_PATH)
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    messages = [
        {"role": m.role, "content": m.content}
        for m in body.history
    ] + [{"role": "user", "content": body.message}]

    client = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
    response = client.messages.create(
        model=AI_MODEL,
        max_tokens=1024,
        system=_build_system_prompt(board),
        tools=[_UPDATE_BOARD_TOOL],
        messages=messages,
    )

    reply_text = ""
    board_update = None

    for block in response.content:
        if block.type == "text":
            reply_text += block.text
        elif block.type == "tool_use" and block.name == "update_board":
            operations = block.input.get("operations", [])
            errors = db.apply_board_update(operations, user_id, db.DB_PATH)
            board_update = {"operations": operations, "errors": errors}

    return {"reply": reply_text.strip(), "boardUpdate": board_update}


# ---------------------------------------------------------------------------
# Static frontend (must come last)
# ---------------------------------------------------------------------------

if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


