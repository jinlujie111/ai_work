"""外部日历：月视图数据 + ICS 导出。"""

from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import Task, User
from ..query_helpers import load_goals_map, load_stages_by_goal
from ..workflows.fallback import today_str
from ..workflows.plan import enrich_task_learning

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


def _month_bounds(year: int, month: int) -> tuple[str, str]:
    last = monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last:02d}"


@router.get("/month")
def month_view(
    year: int | None = Query(default=None),
    month: int | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = today_str()
    now = datetime.strptime(today, "%Y-%m-%d")
    y = year or now.year
    m = month or now.month
    start, end = _month_bounds(y, m)
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.status != "cancelled",
            Task.planned_date >= start,
            Task.planned_date <= end,
        )
        .order_by(Task.planned_date.asc(), Task.sort_order.asc())
        .all()
    )
    goal_ids = {t.goal_id for t in tasks if t.goal_id}
    goals_map = load_goals_map(db, goal_ids)
    stages_by_goal = load_stages_by_goal(db, goal_ids)
    stage_by_id = {s.id: s for stages in stages_by_goal.values() for s in stages}
    by_day: dict[str, list] = {}
    for t in tasks:
        goal = goals_map.get(t.goal_id)
        # 与「今日」一致：仅进行中目标进日历
        if not goal or goal.status != "active":
            continue
        item = enrich_task_learning(
            db,
            t,
            goal,
            stages=stages_by_goal.get(goal.id) or [],
            stage_by_id=stage_by_id,
        )
        item["depends_on"] = _parse_deps(t.depends_on_json)
        by_day.setdefault(t.planned_date, []).append(item)
    days = []
    total = 0
    cur = datetime.strptime(start, "%Y-%m-%d")
    end_d = datetime.strptime(end, "%Y-%m-%d")
    while cur <= end_d:
        ds = cur.strftime("%Y-%m-%d")
        items = by_day.get(ds, [])
        total += len(items)
        days.append(
            {
                "date": ds,
                "weekday": cur.isoweekday(),
                "count": len(items),
                "done": len([i for i in items if i["status"] == "done"]),
                "minutes": sum(int(i.get("estimated_minutes") or 0) for i in items),
                "items": items,
            }
        )
        cur += timedelta(days=1)
    return {
        "year": y,
        "month": m,
        "start": start,
        "end": end,
        "today": today,
        "days": days,
        "total_tasks": total,
    }


def _parse_deps(raw: str | None) -> list[int]:
    if not raw:
        return []
    try:
        import json

        data = json.loads(raw)
        if isinstance(data, list):
            return [int(x) for x in data]
    except Exception:
        return []
    return []


@router.get("/ics")
def export_ics(
    days: int = Query(default=30, ge=1, le=90),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start = today_str()
    end = (datetime.strptime(start, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.status.in_(["todo", "doing", "deferred"]),
            Task.planned_date >= start,
            Task.planned_date <= end,
        )
        .order_by(Task.planned_date.asc())
        .all()
    )
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Zhida//CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    goals_map = load_goals_map(db, {t.goal_id for t in tasks if t.goal_id})
    for t in tasks:
        goal = goals_map.get(t.goal_id)
        uid = f"zhida-task-{t.id}@zhida"
        day = (t.planned_date or start).replace("-", "")
        summary = (t.name or "任务").replace(",", "\\,").replace(";", "\\;")
        desc = f"目标：{goal.title if goal else ''}".replace(",", "\\,")
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}",
                f"DTSTART;VALUE=DATE:{day}",
                f"DTEND;VALUE=DATE:{day}",
                f"SUMMARY:{summary}",
                f"DESCRIPTION:{desc}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    body = "\r\n".join(lines) + "\r\n"
    return PlainTextResponse(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="zhida.ics"'},
    )
