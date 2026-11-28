"""快速收集箱：与学习目标并行，不参与名额与日历冲突重排。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Goal, User

INBOX_GOAL_TYPE = "inbox"
INBOX_TITLE = "收集箱"


def is_inbox_goal(goal: Goal | None) -> bool:
    if not goal:
        return False
    return (goal.goal_type or "") == INBOX_GOAL_TYPE


def ensure_inbox_goal(db: Session, user: User) -> Goal:
    existing = (
        db.query(Goal)
        .filter(Goal.user_id == user.id, Goal.goal_type == INBOX_GOAL_TYPE)
        .order_by(Goal.id.asc())
        .first()
    )
    if existing:
        if existing.status != "active":
            existing.status = "active"
        if existing.title != INBOX_TITLE:
            existing.title = INBOX_TITLE
        # 去掉历史小字说明
        if existing.description:
            existing.description = ""
        return existing
    goal = Goal(
        user_id=user.id,
        title=INBOX_TITLE,
        description="",
        goal_type=INBOX_GOAL_TYPE,
        baseline="",
        daily_minutes=int(user.daily_minutes_weekday or 60),
        status="active",
        priority_rank=9999,
        plan_source="inbox",
        modules_json="{}",
    )
    db.add(goal)
    db.flush()
    return goal
