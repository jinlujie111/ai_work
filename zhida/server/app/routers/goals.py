import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

logger = logging.getLogger("zhida.goals")
_STREAM_INTERNAL_MSG = "服务繁忙，请稍后重试"

from ..auth import get_current_user
from ..db import SessionLocal, get_db
from ..models import Goal, GoalStage, PlanVersion, Task, User
from ..query_helpers import load_stages_by_goal, load_tasks_by_goal
from ..schemas import GoalConfirmIn, GoalPauseIn, GoalPriorityIn, GoalResumeIn, PlanCreateIn
from ..timeutil import utc_now
from ..workflows.plan import (
    apply_goal_priority_order,
    generate_plan_draft,
    materialize_goal_from_modules,
    rebalance_user_open_tasks,
    serialize_goal,
    serialize_task,
)

router = APIRouter(prefix="/api/goals", tags=["goals"])


def _soft_terminate_goal(db: Session, goal: Goal) -> None:
    """放弃/终止：软终止留档，不删行，以免释放免费名额。"""
    goal.status = "terminated"
    db.query(Task).filter(
        Task.goal_id == goal.id,
        Task.status.notin_(["done", "cancelled"]),
    ).update({"status": "cancelled"}, synchronize_session=False)


def _extract_task_patches(snapshot: dict) -> list[dict]:
    """兼容初始规划与重规划两种 snapshot 结构。"""
    if not snapshot:
        return []
    if isinstance(snapshot.get("tasks"), list) and snapshot["tasks"]:
        first = snapshot["tasks"][0]
        if isinstance(first, dict) and "id" in first:
            return snapshot["tasks"]
    patches = []
    for stage in snapshot.get("stages") or []:
        for task in stage.get("tasks") or []:
            if isinstance(task, dict) and "id" in task:
                patches.append(task)
    return patches


@router.get("")
def list_goals(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    goals = (
        db.query(Goal)
        .filter(Goal.user_id == user.id)
        .order_by(Goal.priority_rank.asc(), Goal.id.desc())
        .all()
    )
    goal_ids = [g.id for g in goals]
    tasks_by_goal = load_tasks_by_goal(db, goal_ids)
    stages_by_goal = load_stages_by_goal(db, goal_ids)
    out = []
    for g in goals:
        tasks = tasks_by_goal.get(g.id) or []
        done = len([t for t in tasks if t.status == "done"])
        stages = stages_by_goal.get(g.id) or []
        current = next((s for s in stages if s.status != "done"), stages[0] if stages else None)
        out.append(
            {
                **serialize_goal(g),
                "progress": int(round(done * 100 / len(tasks))) if tasks else 0,
                "stage_name": current.name if current else "未拆解",
            }
        )
    return {"items": out}


@router.post("/plan-draft")
async def create_plan_draft(
    body: PlanCreateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return await generate_plan_draft(
            db,
            user,
            raw_text=body.raw_text.strip(),
            baseline=body.baseline.strip(),
            daily_minutes=body.daily_minutes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/plan-draft-stream")
async def create_plan_draft_stream(
    body: PlanCreateIn,
    user: User = Depends(get_current_user),
):
    """NDJSON 流式草案：边解析边推 progress/delta，最后 done。"""

    async def event_gen():
        queue: asyncio.Queue = asyncio.Queue()

        async def on_event(ev: dict):
            await queue.put(ev)

        async def runner():
            db = SessionLocal()
            try:
                result = await generate_plan_draft(
                    db,
                    user,
                    raw_text=body.raw_text.strip(),
                    baseline=body.baseline.strip(),
                    daily_minutes=body.daily_minutes,
                    on_event=on_event,
                )
                await queue.put({"event": "done", "data": result})
            except ValueError as exc:
                await queue.put({"event": "error", "code": "bad_request", "message": str(exc)})
            except Exception:  # noqa: BLE001
                logger.exception("plan-draft-stream failed")
                await queue.put(
                    {
                        "event": "error",
                        "code": "internal_error",
                        "message": _STREAM_INTERNAL_MSG,
                    }
                )
            finally:
                db.close()
                await queue.put(None)

        task = asyncio.create_task(runner())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield json.dumps(item, ensure_ascii=False) + "\n"
        finally:
            await task

    return StreamingResponse(
        event_gen(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{goal_id}")
def get_goal(goal_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    stages = (
        db.query(GoalStage)
        .filter(GoalStage.goal_id == goal_id)
        .order_by(GoalStage.sort_order.asc())
        .all()
    )
    tasks = (
        db.query(Task)
        .filter(Task.goal_id == goal_id)
        .order_by(Task.sort_order.asc(), Task.id.asc())
        .all()
    )
    stage_list = []
    for s in stages:
        stage_list.append(
            {
                "id": s.id,
                "name": s.name,
                "sort_order": s.sort_order,
                "status": s.status,
                "skippable": bool(getattr(s, "skippable", 0)),
                "skip_reason": getattr(s, "skip_reason", None) or "",
                "tasks": [serialize_task(t) for t in tasks if t.stage_id == s.id],
            }
        )
    g = serialize_goal(goal)
    active_goals = (
        db.query(Goal)
        .filter(Goal.user_id == user.id, Goal.status == "active")
        .order_by(Goal.priority_rank.asc(), Goal.id.asc())
        .all()
    )
    active_list = [
        {
            "id": ag.id,
            "title": ag.title,
            "priority_rank": int(getattr(ag, "priority_rank", None) or 100),
            "deadline": ag.deadline or "",
        }
        for ag in active_goals
    ]
    need_priority = goal.status == "planning" and len(active_list) >= 1
    return {
        "goal": g,
        "stages": stage_list,
        "skill_categories": g.get("skill_categories") or [],
        "skill_overview": g.get("skill_overview") or "",
        "skill_scenarios": g.get("skill_scenarios") or [],
        "modules": g.get("modules") or [],
        "phase": "scheduled" if stage_list else "modules",
        "active_goals": active_list,
        "need_priority": need_priority,
    }


def _reschedule_active_tasks(db: Session, goal: Goal) -> int:
    """去掉模块后，按用户每日可用时间跨目标重排未完成任务。"""
    user = db.get(User, goal.user_id)
    if not user:
        return 0
    return rebalance_user_open_tasks(db, user)


@router.post("/{goal_id}/confirm-stream")
async def confirm_goal_stream(
    goal_id: int,
    body: GoalConfirmIn,
    user: User = Depends(get_current_user),
):
    """NDJSON 流式确认写入日历。"""

    async def event_gen():
        queue: asyncio.Queue = asyncio.Queue()

        async def on_event(ev: dict):
            await queue.put(ev)

        async def runner():
            db = SessionLocal()
            try:
                # 流式另开 session：必须用本 session 重新取 user，避免跨 session 状态/漏 flush
                db_user = db.get(User, user.id)
                if not db_user:
                    await queue.put({"event": "error", "message": "unauthorized"})
                    return
                goal = db.get(Goal, goal_id)
                if not goal or goal.user_id != db_user.id:
                    await queue.put({"event": "error", "message": "not found"})
                    return
                if not body.confirm:
                    _soft_terminate_goal(db, goal)
                    db.commit()
                    await queue.put(
                        {"event": "done", "data": {"ok": True, "status": "terminated"}}
                    )
                    return
                keys = body.selected_module_keys
                if keys is None:
                    try:
                        blob = json.loads(goal.modules_json or "{}")
                        keys = [m.get("key") for m in (blob.get("modules") or []) if m.get("key")]
                    except json.JSONDecodeError:
                        keys = []
                result = await materialize_goal_from_modules(
                    db,
                    db_user,
                    goal,
                    selected_module_keys=list(keys or []),
                    goal_priority_order=body.goal_priority_order,
                    on_event=on_event,
                )
                await queue.put({"event": "done", "data": result})
            except ValueError as exc:
                await queue.put({"event": "error", "code": "bad_request", "message": str(exc)})
            except Exception:  # noqa: BLE001
                logger.exception("confirm-stream failed goal_id=%s", goal_id)
                await queue.put(
                    {
                        "event": "error",
                        "code": "internal_error",
                        "message": _STREAM_INTERNAL_MSG,
                    }
                )
            finally:
                db.close()
                await queue.put(None)

        task = asyncio.create_task(runner())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield json.dumps(item, ensure_ascii=False) + "\n"
        finally:
            await task

    return StreamingResponse(
        event_gen(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/{goal_id}/confirm")
async def confirm_goal(
    goal_id: int,
    body: GoalConfirmIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    if not body.confirm:
        # 放弃草案：软终止留档，不删行（免费名额不释放）
        _soft_terminate_goal(db, goal)
        db.commit()
        return {"ok": True, "status": "terminated"}

    # 优先：草案模块勾选 → 展开任务并写入日历
    if body.selected_module_keys is not None or (
        goal.status == "planning" and getattr(goal, "modules_json", None)
    ):
        keys = body.selected_module_keys
        if keys is None:
            try:
                blob = json.loads(goal.modules_json or "{}")
                keys = [m.get("key") for m in (blob.get("modules") or []) if m.get("key")]
            except json.JSONDecodeError:
                keys = []
        try:
            return await materialize_goal_from_modules(
                db,
                user,
                goal,
                selected_module_keys=list(keys or []),
                goal_priority_order=body.goal_priority_order,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # 兼容：已物化过阶段时，按 stage id 裁剪
    stages = (
        db.query(GoalStage)
        .filter(GoalStage.goal_id == goal_id)
        .order_by(GoalStage.sort_order.asc())
        .all()
    )
    if body.selected_stage_ids is not None and stages:
        keep = {int(x) for x in body.selected_stage_ids}
        if not keep:
            raise HTTPException(status_code=400, detail="请至少保留一个模块")
        dropped = 0
        for st in stages:
            if st.id in keep:
                continue
            db.query(Task).filter(Task.stage_id == st.id).delete()
            db.delete(st)
            dropped += 1
        kept_tasks = _reschedule_active_tasks(db, goal)
        try:
            path = json.loads(goal.learning_path_json or "{}")
            if isinstance(path, dict):
                kept = (
                    db.query(GoalStage)
                    .filter(GoalStage.goal_id == goal_id)
                    .order_by(GoalStage.sort_order.asc())
                    .all()
                )
                path["selected_modules"] = [s.name for s in kept]
                goal.learning_path_json = json.dumps(path, ensure_ascii=False)
        except Exception:
            pass
        goal.status = "active"
        apply_goal_priority_order(
            db, user, body.goal_priority_order, ensure_goal_id=goal.id
        )
        rebalance_user_open_tasks(db, user)
        db.commit()
        return {
            "ok": True,
            "status": "active",
            "dropped_modules": dropped,
            "kept_tasks": kept_tasks,
        }

    goal.status = "active"
    apply_goal_priority_order(
        db, user, body.goal_priority_order, ensure_goal_id=goal.id
    )
    rebalance_user_open_tasks(db, user)
    db.commit()
    return {"ok": True, "status": "active"}


@router.post("/priority")
def set_goal_priorities(
    body: GoalPriorityIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """调整进行中目标的学习优先级并重排日历。"""
    applied = apply_goal_priority_order(db, user, body.ordered_goal_ids)
    if not applied:
        raise HTTPException(status_code=400, detail="没有可调整的进行中目标")
    moved = rebalance_user_open_tasks(db, user)
    db.commit()
    return {"ok": True, "ordered_goal_ids": applied, "rescheduled_tasks": moved}


@router.post("/{goal_id}/pause")
def pause_goal(
    goal_id: int,
    body: GoalPauseIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """暂停：退出今日/日历（仅进行中进日历）；仍占免费名额。是否重排由客户端确认。"""
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    if goal.status != "active":
        raise HTTPException(status_code=400, detail="只有进行中的目标可以暂停")
    goal.status = "paused"
    db.flush()
    moved = 0
    if body.rebalance:
        moved = rebalance_user_open_tasks(db, user)
    db.commit()
    return {"ok": True, "status": "paused", "rescheduled_tasks": moved}


@router.post("/{goal_id}/resume")
def resume_goal(
    goal_id: int,
    body: GoalResumeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """恢复为进行中；是否重排日历由客户端确认。"""
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    if goal.status != "paused":
        raise HTTPException(status_code=400, detail="只有已暂停的目标可以恢复")
    goal.status = "active"
    db.flush()
    moved = 0
    if body.rebalance:
        moved = rebalance_user_open_tasks(db, user)
    db.commit()
    return {"ok": True, "status": "active", "rescheduled_tasks": moved}


@router.post("/{goal_id}/terminate")
def terminate_goal(
    goal_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    if goal.status not in ("active", "paused", "planning"):
        raise HTTPException(status_code=400, detail="当前状态不可终止")
    _soft_terminate_goal(db, goal)
    # 终止后腾出日历空档：重排剩余进行中目标（名额仍占用）
    moved = rebalance_user_open_tasks(db, user)
    db.commit()
    return {"ok": True, "status": "terminated", "rescheduled_tasks": moved}


@router.post("/{goal_id}/complete")
def complete_goal(
    goal_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """标记目标完成，并返回待确认技能候选。"""
    from ..skills_service import mark_stage_progress, propose_skills_for_goal

    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    mark_stage_progress(db, goal_id)
    goal.status = "done"
    db.commit()
    proposals = propose_skills_for_goal(db, user, goal)
    return {"ok": True, "status": "done", "skill_proposals": proposals}


@router.post("/{goal_id}/stages/{stage_id}/complete")
def complete_stage(
    goal_id: int,
    stage_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ..skills_service import maybe_complete_goal, propose_skills_for_goal

    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="goal not found")
    stage = db.get(GoalStage, stage_id)
    if not stage or stage.goal_id != goal_id:
        raise HTTPException(status_code=404, detail="stage not found")
    stage.status = "done"
    # 阶段内任务一并视为完成（用户显式确认阶段完成）
    tasks = db.query(Task).filter(Task.stage_id == stage_id, Task.status != "cancelled").all()
    for t in tasks:
        if t.status != "done":
            t.status = "done"
            t.completed_at = utc_now()
    goal_just_done = maybe_complete_goal(db, goal)
    db.commit()
    proposals = propose_skills_for_goal(db, user, goal)
    return {
        "ok": True,
        "stage_status": "done",
        "goal_status": goal.status,
        "goal_just_done": goal_just_done,
        "skill_proposals": proposals,
    }


@router.get("/{goal_id}/versions")
def list_versions(
    goal_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    rows = (
        db.query(PlanVersion)
        .filter(PlanVersion.goal_id == goal_id)
        .order_by(PlanVersion.version.desc())
        .all()
    )
    return {
        "items": [
            {
                "id": r.id,
                "version": r.version,
                "reason": r.reason,
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
            for r in rows
        ]
    }


@router.post("/{goal_id}/versions/{version_id}/rollback")
def rollback_version(
    goal_id: int,
    version_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="goal not found")
    row = db.get(PlanVersion, version_id)
    if not row or row.goal_id != goal_id:
        raise HTTPException(status_code=404, detail="version not found")

    try:
        snapshot = json.loads(row.snapshot_json or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="invalid snapshot") from exc

    patches = _extract_task_patches(snapshot)
    if not patches:
        raise HTTPException(status_code=400, detail="snapshot has no tasks to restore")

    restored = 0
    for item in patches:
        task = db.get(Task, int(item["id"]))
        if not task or task.goal_id != goal_id or task.user_id != user.id:
            continue
        if item.get("planned_date"):
            task.planned_date = item["planned_date"]
        if item.get("estimated_minutes") is not None:
            task.estimated_minutes = int(item["estimated_minutes"])
        if item.get("description") is not None:
            task.description = item["description"]
        if item.get("name"):
            task.name = item["name"]
        if item.get("status"):
            task.status = item["status"]
            task.completed_at = utc_now() if item["status"] == "done" else None
        restored += 1

    db.flush()
    version_no = (
        db.query(PlanVersion).filter(PlanVersion.goal_id == goal_id).count() + 1
    )
    current_tasks = db.query(Task).filter(Task.goal_id == goal_id).all()
    db.add(
        PlanVersion(
            goal_id=goal_id,
            version=version_no,
            reason=f"回滚到 v{row.version}",
            snapshot_json=json.dumps(
                {"tasks": [serialize_task(t) for t in current_tasks]},
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    return {"ok": True, "restored": restored, "rolled_back_to": row.version}
