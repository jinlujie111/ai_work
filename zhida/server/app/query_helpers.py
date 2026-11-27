"""只读批量查询，消除 today / calendar / goals 列表的 N+1。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Goal, GoalStage, Task


def load_goals_map(db: Session, goal_ids: list[int] | set[int]) -> dict[int, Goal]:
    ids = sorted({int(i) for i in goal_ids if i})
    if not ids:
        return {}
    rows = db.query(Goal).filter(Goal.id.in_(ids)).all()
    return {g.id: g for g in rows}


def load_stages_by_goal(
    db: Session, goal_ids: list[int] | set[int]
) -> dict[int, list[GoalStage]]:
    ids = sorted({int(i) for i in goal_ids if i})
    if not ids:
        return {}
    rows = (
        db.query(GoalStage)
        .filter(GoalStage.goal_id.in_(ids))
        .order_by(GoalStage.goal_id.asc(), GoalStage.sort_order.asc(), GoalStage.id.asc())
        .all()
    )
    out: dict[int, list[GoalStage]] = {gid: [] for gid in ids}
    for s in rows:
        out.setdefault(s.goal_id, []).append(s)
    return out


def load_tasks_by_goal(
    db: Session, goal_ids: list[int] | set[int], *, exclude_cancelled: bool = True
) -> dict[int, list[Task]]:
    ids = sorted({int(i) for i in goal_ids if i})
    if not ids:
        return {}
    q = db.query(Task).filter(Task.goal_id.in_(ids))
    if exclude_cancelled:
        q = q.filter(Task.status != "cancelled")
    rows = q.order_by(Task.goal_id.asc(), Task.sort_order.asc(), Task.id.asc()).all()
    out: dict[int, list[Task]] = {gid: [] for gid in ids}
    for t in rows:
        out.setdefault(t.goal_id, []).append(t)
    return out
