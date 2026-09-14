"""AI-authored avatar pats. Display names and authorship come from the app."""

import re


PAT_COMMAND_PATTERN = re.compile(r"\[PAT\s*[：:]\s*([^\]]*)\]", re.IGNORECASE)


def _clean_text_and_positions(source: str, matches: list[re.Match]) -> tuple[str, list[dict]]:
    """Remove PAT commands while retaining where each command sat in visible text."""
    chunks = []
    positions = []
    cursor = 0
    visible_length = 0
    for match in matches:
        chunk = source[cursor:match.start()]
        chunks.append(chunk)
        visible_length += len(chunk)
        positions.append({
            "offset": visible_length,
            "before": "".join(chunks).rstrip()[-80:],
            "after": PAT_COMMAND_PATTERN.sub("", source[match.end():]).lstrip()[:80],
        })
        cursor = match.end()
    chunks.append(source[cursor:])

    untrimmed = "".join(chunks)
    leading_trim = len(untrimmed) - len(untrimmed.lstrip())
    cleaned = untrimmed.strip()
    for position in positions:
        position["offset"] = max(0, min(len(cleaned), position["offset"] - leading_trim))
    return cleaned, positions


def build_pat_ability_text(who: str, *, group: bool = False) -> str:
    from chatroom import get_chatroom_names

    user_name, ai_name, companion_name = get_chatroom_names()
    names = {"user": user_name, "aion": ai_name, "connor": companion_name}
    actor = "connor" if who == "connor" else "aion"
    targets = ("user", "aion", "connor") if group else ("user", actor)
    target_labels = "、".join(f"{key}={names[key]}" for key in targets)
    example_target = ("aion" if actor == "connor" else "connor") if group else "user"
    return (
        "[PAT:目标ID|动作|后续描述] — 在当前聊天发起一次趣味拍拍，"
        f"可拍的人：{target_labels}。你是{names[actor]}，发起者由系统确定；"
        "系统严格按「发起者」＋动作＋「目标」＋后续描述拼接，拍自己时目标显示为“自己”。"
        "你是动作的主语，目标是动作的宾语；动作只写放在目标前的动词短语（如拍了拍、揉了揉、抱起了），"
        "不要重复填写主语或目标姓名。目标之后的动作、结果和台词都放进后续描述，可留空；"
        "以“的”开头的部位属于目标，续句换主语时请明确写出是谁。"
        f"例如 [PAT:{example_target}|揉了揉|的头] → 「{names[actor]}」揉了揉「{names[example_target]}」的头；"
        f"[PAT:user|抱起了|，转了一圈，说：“今天归我。”] → 「{names[actor]}」抱起了「{user_name}」，转了一圈，说：“今天归我。”\n"
        "不要把“抱起来转了一圈”全塞进动作字段，否则目标会被拼到“一圈”后面。"
        "发送前先按拼接顺序默读整句，确认谁对谁做了什么、语序自然。"
        "每条指令会显示为独立的小动作消息并进入聊天上下文，不要在正文重复整句。"
        "动作不超过15字，后续描述不超过30字，字段里不要嵌套方括号指令。"
    )


async def process_pat_commands(
    text: str, *, source_type: str, source_id: str, sender: str,
    source_msg_id: str = "", on_saved=None,
) -> str:
    from capabilities import is_capability_enabled

    source = text or ""
    matches = list(PAT_COMMAND_PATTERN.finditer(source))
    cleaned, positions = _clean_text_and_positions(source, matches)
    if not matches or sender not in ("aion", "connor") or not is_capability_enabled("pat"):
        return cleaned

    from fastapi import HTTPException
    from pydantic import ValidationError
    from routes.pat import PatRequest, save_pat

    for match, position in zip(matches, positions):
        fields = match.group(1).split("|", 2)
        if len(fields) != 3 or "[" in match.group(1):
            continue
        try:
            body = PatRequest(
                scope=source_type, source_id=source_id,
                target=fields[0].strip().lower(), action=fields[1], suffix=fields[2],
            )
            message = await save_pat(
                body,
                actor=sender,
                after_msg_id=source_msg_id,
                inline_offset=position["offset"],
                inline_before=position["before"],
                inline_after=position["after"],
            )
        except (ValidationError, HTTPException):
            continue
        if message and on_saved:
            await on_saved(message)
    return cleaned
