"""Repair chat proposals and explicit, standalone conversational approvals."""
import re

PLAN_MARKER = "```repair-plan"

PROPOSAL_INSTRUCTIONS = """
当用户在讨论小家功能、代码、配置修改或重启且范围已经清楚时，直接在本次聊天中简短说明具体准备做什么、范围和验收方式，
不要求用户去另一个页面生成方案。然后问是否按这个做，告诉用户可回复「就这样改」或点击「开始」。
在回复末尾追加一个 ```repair-plan 代码块，块内是刚才已经向用户完整说明的同一份简短方案。
这个代码块仅供应用保存方案，不得加入正文没说的操作。范围尚不清楚、仅闲聊或只读查询时不输出这个块。
不要在方案里写「当前没有执行权限」「尚未确认」等临时状态，不输出其他控制协议。
此协议仅用于需要确认的项目改动；用户明确要求新建普通文件、写入内容、查找或领取文件时直接做，不要为了这些小事输出待确认方案。
用户明确说先讨论不执行时只提出方案，不能声称执行过，也不能把其他伴侣或背景记录中的同意当作用户本轮确认。
"""


def is_confirmation(text):
    # Whole-message matching: quotations, negation, questions and added scope
    # remain discussion. Never execute merely because a sentence contains a verb.
    normalized = re.sub(r"[\s，,。.!！~～]", "", text)
    return bool(re.fullmatch(
        r"(?:嗯|嗯嗯|好|好的|行|可以|那)?(?:就这样改|就这么改|按这个改|按这个方案改|"
        r"按这个方案开始|按这个方案执行|按方案执行|开始执行|开始|开工|"
        r"就按这个方案来|就按这个改|继续按这个方案改)(?:吧|吧老公|了)?", normalized))


def split_proposal(text):
    visible, marker, tail = text.partition(PLAN_MARKER)
    if not marker:
        return text, ""
    plan, end, _ = tail.partition("```")
    plan = plan.strip()
    return visible.rstrip(), plan if end and 0 < len(plan) <= 24000 else ""
