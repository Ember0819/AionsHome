"""Sender-authored avatar pats, stored as ordinary transcript notices."""

import json
import time
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from chatroom import get_chatroom_names
from capabilities import is_capability_enabled
from database import get_db
from ws import manager


router = APIRouter(prefix="/api/pat", tags=["pat"])


class PatRequest(BaseModel):
    scope: Literal["private", "chatroom"]
    source_id: str = Field(min_length=1, max_length=200)
    target: Literal["user", "aion", "connor"]
    action: str = Field(default="拍了拍", min_length=1, max_length=24)
    suffix: str = Field(default="", max_length=200)

    @field_validator("action", "suffix", mode="before")
    @classmethod
    def trim_text(cls, value):
        return value.strip() if isinstance(value, str) else value


@router.post("")
async def send_pat(body: PatRequest):
    # The HTTP endpoint always represents the human; the AI switch does not apply.
    return await save_pat(body)


async def save_pat(
    body: PatRequest,
    *,
    actor: str = "user",
    after_msg_id: str = "",
    inline_offset: int | None = None,
    inline_before: str = "",
    inline_after: str = "",
):
    user_name, ai_name, companion_name = get_chatroom_names()
    names = {"user": user_name, "aion": ai_name, "connor": companion_name}
    if actor not in names:
        raise HTTPException(400, "未知的拍拍发起者")
    target_name = "自己" if body.target == actor else f"「{names[body.target]}」"
    content = f"「{names[actor]}」{body.action}{target_name}{body.suffix}"
    attachments = [
        {"type": "pat", "actor": actor, "target": body.target,
         "action": body.action, "suffix": body.suffix},
        {"type": "system_model_context"},
    ]
    if after_msg_id:
        order = {"type": "system_notice_order", "after_msg_id": after_msg_id}
        if inline_offset is not None:
            order["inline_offset"] = max(0, int(inline_offset))
            if inline_before:
                order["inline_before"] = inline_before
            if inline_after:
                order["inline_after"] = inline_after
        attachments.append(order)
    now = time.time()
    msg_id = f"pat_{uuid4().hex}"
    private = body.scope == "private"
    parent_table = "conversations" if private else "chatroom_rooms"
    message_table = "messages" if private else "chatroom_messages"
    source_key = "conv_id" if private else "room_id"
    role_key = "role" if private else "sender"
    async with get_db() as db:
        cursor = await db.execute(
            f"SELECT {'id' if private else 'type'} FROM {parent_table} WHERE id=?",
            (body.source_id,),
        )
        parent = await cursor.fetchone()
        if not parent:
            raise HTTPException(404, "聊天不存在")
        allowed = {"user", "aion"} if private else (
            {"user", "connor"} if parent[0] == "connor_1v1" else {"user", "aion", "connor"}
        )
        if body.target not in allowed or actor not in allowed:
            raise HTTPException(400, "这个人不在当前聊天里")
        if actor != "user" and not is_capability_enabled("pat"):
            return None
        await db.execute(
            f"INSERT INTO {message_table} (id, {source_key}, {role_key}, content, created_at, attachments) "
            "VALUES (?,?,?,?,?,?)",
            (msg_id, body.source_id, "system", content, now, json.dumps(attachments, ensure_ascii=False)),
        )
        await db.execute(f"UPDATE {parent_table} SET updated_at=? WHERE id=?", (now, body.source_id))
        await db.commit()
    message = {
        "id": msg_id, source_key: body.source_id, role_key: "system",
        "content": content, "created_at": now, "attachments": attachments,
    }
    await manager.broadcast({"type": "msg_created" if private else "chatroom_msg_created", "data": message})
    return message
