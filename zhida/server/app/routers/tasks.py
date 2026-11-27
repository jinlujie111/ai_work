import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import Goal, Task, User
from ..query_helpers import load_goals_map, load_stages_by_goal
from ..schemas import TaskCreateIn, TaskStatusIn, TaskUpdateIn
from ..timeutil import utc_now
from ..workflows.fallback import today_str
from ..workflows.plan import enrich_task_learning, serialize_task

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _valid_date(value: str | None) -> bool:
    return bool(value and _DATE_RE.match(value))


@router.get("/today")
def today_tasks(
    date: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    day = date or today_str()
    # 自愈：若今日已超过「我的」每日可用时间，先按额度重排再返回
    from ..workflows.plan_scheduling import ensure_day_within_capacity

    moved = ensure_day_within_capacity(db, user, date_str=day)
    if moved:
        db.commit()
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.planned_date == day,
            Task.status != "cancelled",
        )
        .order_by(Task.sort_order.asc(), Task.id.asc())
        .all()
    )
    goal_ids = {t.goal_id for t in tasks if t.goal_id}
    goals_map = load_goals_map(db, goal_ids)
    stages_by_goal = load_stages_by_goal(db, goal_ids)
    stage_by_id = {s.id: s for stages in stages_by_goal.values() for s in stages}
    items = []
    for t in tasks:
        goal = goals_map.get(t.goal_id)
        # 仅「进行中」目标进入今日清单；待确认(planning)未生效
        if not goal or goal.status != "active":
            continue
        items.append(
            enrich_task_learning(
                db,
                t,
                goal,
                stages=stages_by_goal.get(goal.id) or [],
                stage_by_id=stage_by_id,
            )
        )
    done = len([t for t in items if t["status"] == "done"])
    active_goals = (
        db.query(Goal)
        .filter(Goal.user_id == user.id, Goal.status == "active")
        .order_by(Goal.id.desc())
        .all()
    )
    return {
        "date": day,
        "items": items,
        "done_count": done,
        "total_count": len(items),
        "progress": int(round(done * 100 / len(items))) if items else 0,
        "active_goals": [{"id": g.id, "title": g.title} for g in active_goals],
    }


@router.post("")
def create_task(
    body: TaskCreateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    goal = db.get(Goal, body.goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="goal not found")
    if goal.status not in {"active", "planning"}:
        raise HTTPException(status_code=400, detail="goal not editable")
    planned = body.planned_date or today_str()
    if not _valid_date(planned):
        raise HTTPException(status_code=400, detail="invalid planned_date")
    max_order = (
        db.query(Task)
        .filter(Task.goal_id == goal.id)
        .count()
    )
    pri = (body.priority or "normal").lower()
    if pri not in {"high", "normal", "low"}:
        pri = "normal"
    task = Task(
        goal_id=goal.id,
        stage_id=None,
        user_id=user.id,
        name=body.name.strip(),
        description=body.description or "手动添加",
        estimated_minutes=max(5, int(body.estimated_minutes or 30)),
        priority=pri,
        planned_date=planned,
        status="todo",
        sort_order=max_order,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    item = serialize_task(task)
    item["goal_title"] = goal.title
    return item


@router.post("/{task_id}/status")
def update_status(
    task_id: int,
    body: TaskStatusIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ..skills_service import mark_stage_progress, maybe_complete_goal, propose_skills_for_goal

    task = db.get(Task, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    task.status = body.status
    task.completed_at = utc_now() if body.status == "done" else None

    skill_proposals = []
    stage_just_done = False
    goal_just_done = False
    if body.status == "done" and task.goal_id:
        newly = mark_stage_progress(db, task.goal_id)
        stage_just_done = bool(newly)
        goal = db.get(Goal, task.goal_id)
        if goal:
            goal_just_done = maybe_complete_goal(db, goal)
            if stage_just_done or goal_just_done:
                skill_proposals = propose_skills_for_goal(db, user, goal)

    db.commit()
    out = serialize_task(task)
    out["stage_just_done"] = stage_just_done
    out["goal_just_done"] = goal_just_done
    out["skill_proposals"] = skill_proposals
    return out


@router.post("/{task_id}/update")
def update_task(
    task_id: int,
    body: TaskUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    if body.planned_date is not None:
        if not _valid_date(body.planned_date):
            raise HTTPException(status_code=400, detail="invalid planned_date")
        task.planned_date = body.planned_date
    if body.name is not None and body.name.strip():
        task.name = body.name.strip()
    if body.description is not None:
        task.description = body.description
    if body.estimated_minutes is not None:
        task.estimated_minutes = max(5, int(body.estimated_minutes))
    if body.status is not None:
        task.status = body.status
        task.completed_at = utc_now() if body.status == "done" else None
    if body.priority is not None:
        pri = (body.priority or "normal").lower()
        if pri not in {"high", "normal", "low"}:
            raise HTTPException(status_code=400, detail="invalid priority")
        task.priority = pri
    db.commit()
    return serialize_task(task)
