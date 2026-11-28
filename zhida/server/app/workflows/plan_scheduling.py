from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from ..models import Goal, Task, User
from .fallback import today_str
from .inbox import INBOX_GOAL_TYPE
from .plan_graph import day_capacity


_TASK_PRIORITY_ORDER = {"high": 0, "normal": 1, "low": 2}


def _learning_goal_filter():
    """学习目标任务才参与容量占用与冲突重排；收集箱并行、不冲突处理。"""
    return Goal.goal_type != INBOX_GOAL_TYPE


def user_day_capacity(user: User, date_str: str, *, fallback: int = 60) -> int:
    return day_capacity(
        date_str,
        weekday_minutes=int(user.daily_minutes_weekday or fallback),
        weekend_minutes=int(user.daily_minutes_weekend or user.daily_minutes_weekday or fallback),
        fallback=fallback,
    )


def occupied_minutes_by_day(
    db: Session,
    user_id: int,
    *,
    exclude_goal_id: int | None = None,
    from_date: str | None = None,
) -> dict[str, int]:
    """其他进行中目标在各日已占用的分钟（不含已取消）。"""
    q = (
        db.query(Task)
        .join(Goal, Goal.id == Task.goal_id)
        .filter(
            Task.user_id == user_id,
            Task.status != "cancelled",
            Goal.status == "active",
            _learning_goal_filter(),
        )
    )
    if exclude_goal_id is not None:
        q = q.filter(Task.goal_id != exclude_goal_id)
    if from_date:
        q = q.filter(Task.planned_date >= from_date)
    occ: dict[str, int] = {}
    for t in q.all():
        day = t.planned_date or ""
        if not day:
            continue
        occ[day] = int(occ.get(day) or 0) + max(0, int(t.estimated_minutes or 0))
    return occ


def apply_goal_priority_order(
    db: Session,
    user: User,
    ordered_goal_ids: list[int] | None,
    *,
    ensure_goal_id: int | None = None,
) -> list[int]:
    """按用户给定顺序写入目标 priority_rank（越小越优先），返回实际生效的 id 列表。"""
    wanted = [int(x) for x in (ordered_goal_ids or []) if x is not None]
    # 去重保序
    seen: set[int] = set()
    ordered: list[int] = []
    for gid in wanted:
        if gid in seen:
            continue
        seen.add(gid)
        ordered.append(gid)
    if ensure_goal_id and ensure_goal_id not in seen:
        ordered.insert(0, ensure_goal_id)

    actives = (
        db.query(Goal)
        .filter(
            Goal.user_id == user.id,
            Goal.status == "active",
            _learning_goal_filter(),
        )
        .order_by(Goal.priority_rank.asc(), Goal.id.asc())
        .all()
    )
    by_id = {g.id: g for g in actives}
    applied: list[int] = []
    rank = 1
    for gid in ordered:
        g = by_id.get(gid)
        if not g:
            continue
        g.priority_rank = rank
        applied.append(gid)
        rank += 1
    for g in actives:
        if g.id in applied:
            continue
        g.priority_rank = rank
        applied.append(g.id)
        rank += 1
    return applied


def rebalance_user_open_tasks(db: Session, user: User, *, from_date: str | None = None) -> int:
    """把用户所有进行中目标的未完成任务，按目标优先级→任务优先级重铺日历。

    硬约束：任意一天未完成任务合计不超过当日可用分钟（「我的」工作日/周末）。
    """
    from datetime import timedelta

    # 确保待重排的状态变更已落到可查询状态（避免刚激活目标被 SQL 漏掉）
    db.flush()
    start = from_date or today_str()
    uid = int(getattr(user, "id", 0) or 0)
    tasks = (
        db.query(Task)
        .join(Goal, Goal.id == Task.goal_id)
        .filter(
            Task.user_id == uid,
            Task.status.in_(("todo", "deferred", "doing")),
            Goal.status == "active",
            _learning_goal_filter(),
        )
        .all()
    )
    if not tasks:
        return 0

    goal_ids = {t.goal_id for t in tasks}
    goals = {
        g.id: g
        for g in db.query(Goal).filter(Goal.id.in_(list(goal_ids))).all()
    }

    def _task_sort_key(t: Task):
        g = goals.get(t.goal_id)
        goal_rank = int(getattr(g, "priority_rank", None) or 100)
        tp = _TASK_PRIORITY_ORDER.get((t.priority or "normal").lower(), 1)
        return (goal_rank, tp, int(t.sort_order or 0), int(t.id or 0))

    tasks = sorted(tasks, key=_task_sort_key)

    weekday = max(10, int(user.daily_minutes_weekday or 60))
    weekend = max(10, int(user.daily_minutes_weekend or weekday))
    # 已完成任务仍占当天额度；未完成任务整批重排
    done_occ: dict[str, int] = {}
    done_q = (
        db.query(Task)
        .join(Goal, Goal.id == Task.goal_id)
        .filter(
            Task.user_id == uid,
            Task.status == "done",
            Task.planned_date >= start,
            Goal.status == "active",
            _learning_goal_filter(),
        )
    )
    for t in done_q.all():
        day = t.planned_date or ""
        if day:
            done_occ[day] = int(done_occ.get(day) or 0) + max(0, int(t.estimated_minutes or 0))

    def _next_day(date_str: str) -> str:
        return (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")

    cursor = start
    used = int(done_occ.get(cursor) or 0)
    goal_last: dict[int, str] = {}

    for t in tasks:
        # 单任务不得超过当日上限（取工作日口径，避免被周末更大额度撑破工作日）
        mins = max(10, min(int(t.estimated_minutes or weekday), weekday))
        guard = 0
        placed = False
        while guard < 800:
            cap = day_capacity(cursor, weekday_minutes=weekday, weekend_minutes=weekend)
            # 当天已被完成任务占满 → 下一天
            if used >= cap:
                cursor = _next_day(cursor)
                used = int(done_occ.get(cursor) or 0)
                guard += 1
                continue
            room = cap - used
            task_mins = max(10, min(mins, room, cap))
            # room < 10 基本不会到这；仍防御
            if task_mins <= room:
                mins = task_mins
                placed = True
                break
            cursor = _next_day(cursor)
            used = int(done_occ.get(cursor) or 0)
            guard += 1

        if not placed:
            cap = day_capacity(cursor, weekday_minutes=weekday, weekend_minutes=weekend)
            room = max(10, cap - used)
            mins = max(10, min(mins, room, cap))

        t.estimated_minutes = mins
        t.planned_date = cursor
        used += mins
        goal_last[t.goal_id] = cursor
        cap = day_capacity(cursor, weekday_minutes=weekday, weekend_minutes=weekend)
        if used >= cap:
            cursor = _next_day(cursor)
            used = int(done_occ.get(cursor) or 0)

    for gid, last in goal_last.items():
        g = db.get(Goal, gid)
        if g and (not g.deadline or g.deadline < last):
            g.deadline = last
    return len(tasks)


def day_open_minutes(db: Session, user: User, date_str: str) -> int:
    """某日进行中目标未取消任务合计分钟。"""
    rows = (
        db.query(Task.estimated_minutes)
        .join(Goal, Goal.id == Task.goal_id)
        .filter(
            Task.user_id == user.id,
            Task.planned_date == date_str,
            Task.status != "cancelled",
            Goal.status == "active",
            _learning_goal_filter(),
        )
        .all()
    )
    return sum(max(0, int(m or 0)) for (m,) in rows)


def ensure_day_within_capacity(db: Session, user: User, *, date_str: str | None = None) -> int:
    """若指定日（默认今天）已超每日可用时间，触发重排。返回重排任务数；未超则 0。"""
    day = date_str or today_str()
    cap = user_day_capacity(user, day)
    used = day_open_minutes(db, user, day)
    if used <= cap:
        return 0
    return rebalance_user_open_tasks(db, user, from_date=day)
