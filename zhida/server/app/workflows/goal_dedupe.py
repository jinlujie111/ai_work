"""用户目标去重：同技能/同标题的进行中目标不重复创建。"""

from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

from ..models import Goal, PlanVersion
from .plan_graph import strip_duration_from_title
from .plan_serialize import _parse_modules_blob, serialize_goal

# 视为「已有、应跳转」的状态（完成/终止可再学新的）
OPEN_STATUSES = ("planning", "active", "paused")


def norm_goal_key(text: str) -> str:
    """标题/输入归一：去天数、空白、常见「我想学」前缀。"""
    t = strip_duration_from_title(text or "")
    t = re.sub(r"[\s\-·・_/|，。、,.!！？?（）()【】\[\]]+", "", t)
    t = t.lower()
    for p in ("我想要学习", "我想学习", "我想学", "想要学习", "想学习", "想学", "学习", "学会"):
        if t.startswith(p) and len(t) > len(p) + 1:
            t = t[len(p) :]
    return t


def _market_id_from_goal(db: Session, goal: Goal) -> int:
    mid = int(getattr(goal, "market_item_id", None) or 0)
    if mid:
        return mid
    # 兼容旧数据：从首版 snapshot 读
    ver = (
        db.query(PlanVersion)
        .filter(PlanVersion.goal_id == goal.id)
        .order_by(PlanVersion.version.asc(), PlanVersion.id.asc())
        .first()
    )
    if not ver or not ver.snapshot_json:
        return 0
    try:
        snap = json.loads(ver.snapshot_json)
    except json.JSONDecodeError:
        return 0
    if not isinstance(snap, dict):
        return 0
    try:
        return int(snap.get("market_id") or 0)
    except (TypeError, ValueError):
        return 0


def find_existing_user_goal(
    db: Session,
    user_id: int,
    *,
    raw_text: str = "",
    title: str = "",
    skill_name: str = "",
    market_id: int | None = None,
) -> Goal | None:
    """查找用户已有的同技能目标（planning/active/paused）。"""
    goals = (
        db.query(Goal)
        .filter(Goal.user_id == user_id, Goal.status.in_(OPEN_STATUSES))
        .order_by(Goal.updated_at.desc(), Goal.id.desc())
        .all()
    )
    if not goals:
        return None

    mid = int(market_id or 0)
    if mid:
        for g in goals:
            if _market_id_from_goal(db, g) == mid:
                return g
            if int(getattr(g, "market_item_id", None) or 0) == mid:
                return g

    keys = []
    for x in (raw_text, title, skill_name):
        k = norm_goal_key(x)
        if k and len(k) >= 2 and k not in keys:
            keys.append(k)
    if not keys:
        return None

    for g in goals:
        gk = norm_goal_key(g.title or "")
        if not gk:
            continue
        for k in keys:
            if gk == k:
                return g
            # 互相包含（「烧烤」↔「烧烤入门」）
            if len(k) >= 2 and len(gk) >= 2 and (k in gk or gk in k):
                return g
    return None


def reused_goal_payload(db: Session, goal: Goal, *, market_id: int | None = None) -> dict:
    """与 plan-draft / market use 同构的复用响应。"""
    blob = _parse_modules_blob(getattr(goal, "modules_json", None))
    g = serialize_goal(goal)
    status = goal.status or "planning"
    tip = {
        "planning": "该技能已有待确认草案，已为你打开",
        "active": "该技能已在学习中，已为你打开已有目标",
        "paused": "该技能目标已暂停，已为你打开已有目标",
    }.get(status, "已打开已有目标")
    return {
        "goal": g,
        "skill_categories": blob.get("skill_categories") or [],
        "skill_overview": blob.get("skill_overview") or "",
        "skill_scenarios": blob.get("skill_scenarios") or [],
        "modules": blob.get("modules") or [],
        "analysis": {
            "source": "reuse",
            "reused": True,
            "reused_goal_id": goal.id,
            "reused_status": status,
            "market_id": int(market_id or getattr(goal, "market_item_id", 0) or 0) or None,
            "phase": "modules" if status == "planning" else "scheduled",
            "message": tip,
        },
    }
