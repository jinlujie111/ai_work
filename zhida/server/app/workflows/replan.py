from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..llm import LLMError, chat_json
from ..models import AiUsage, Goal, PlanVersion, Task, User
from .fallback import build_replan_fallback, today_str
from .plan import serialize_task


REPLAN_SYSTEM = """你是目标执行计划调整助手。根据未完成原因，输出严格 JSON：
{
  "tasks": [
    {
      "id": 123,
      "planned_date": "YYYY-MM-DD",
      "estimated_minutes": 30,
      "description": "可选更新说明",
      "status": "todo"
    }
  ],
  "analysis": {
    "reason": "用户原因",
    "summary": "调整说明",
    "moved": [{"id": 123, "name": "任务名", "from": "旧日期", "to": "新日期"}]
  }
}
规则：不要简单把所有任务顺延同一天；可拆分过大任务（降低 estimated_minutes）；尽量保持原 deadline 可行；只返回需要改动的任务也可以，但必须带 id。"""


async def generate_replan_draft(
    db: Session,
    user: User,
    *,
    goal_id: int,
    unfinished_task_ids: list[int],
    reason: str,
) -> dict:
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise ValueError("goal not found")

    tasks = (
        db.query(Task)
        .filter(Task.goal_id == goal_id, Task.user_id == user.id)
        .order_by(Task.sort_order.asc(), Task.id.asc())
        .all()
    )
    payload_tasks = [serialize_task(t) for t in tasks]
    before = {t.id: t.planned_date for t in tasks}

    user_prompt = json.dumps(
        {
            "today": today_str(),
            "reason": reason,
            "deadline": goal.deadline,
            "unfinished_task_ids": unfinished_task_ids,
            "tasks": payload_tasks,
        },
        ensure_ascii=False,
    )

    try:
        data, meta = await chat_json(REPLAN_SYSTEM, user_prompt, purpose="replan")
        db.add(
            AiUsage(
                user_id=user.id,
                purpose="replan",
                model=meta.get("model", ""),
                prompt_tokens=int(meta.get("prompt_tokens") or 0),
                completion_tokens=int(meta.get("completion_tokens") or 0),
                tokens_accurate=1 if meta.get("tokens_accurate") else 0,
            )
        )
        db.commit()
        by_id = {t["id"]: t for t in payload_tasks}
        for item in data.get("tasks") or []:
            tid = int(item["id"])
            if tid in by_id:
                by_id[tid].update({k: v for k, v in item.items() if k != "id"})
        next_tasks = list(by_id.values())
        moved = data.get("analysis", {}).get("moved")
        if not moved:
            moved = []
            for t in next_tasks:
                old = before.get(t["id"])
                if old and t.get("planned_date") != old:
                    moved.append(
                        {
                            "id": t["id"],
                            "name": t["name"],
                            "from": old,
                            "to": t.get("planned_date"),
                        }
                    )
        analysis = data.get("analysis") or {}
        analysis["moved"] = moved
        analysis["source"] = "llm"
        return {"goal_id": goal_id, "tasks": next_tasks, "analysis": analysis, "before": before}
    except LLMError:
        data = build_replan_fallback(
            tasks=payload_tasks,
            unfinished_ids=unfinished_task_ids,
            deadline=goal.deadline,
            reason=reason,
        )
        return {
            "goal_id": goal_id,
            "tasks": data["tasks"],
            "analysis": data["analysis"],
            "before": before,
        }


def apply_replan(
    db: Session,
    user: User,
    *,
    goal_id: int,
    tasks_payload: list[dict],
    reason: str,
    unfinished_task_ids: list[int] | None = None,
) -> dict:
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise ValueError("goal not found")

    unfinished_task_ids = unfinished_task_ids or []
    if not tasks_payload:
        raise ValueError("tasks payload required")

    # fail-fast：任一 id 不属于该用户该目标则整单拒绝
    resolved: list[tuple[dict, Task]] = []
    for item in tasks_payload:
        try:
            tid = int(item["id"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("invalid task id in payload") from exc
        task = db.get(Task, tid)
        if not task or task.user_id != user.id or task.goal_id != goal_id:
            raise ValueError(f"invalid task id: {tid}")
        resolved.append((item, task))

    for item, task in resolved:
        if "planned_date" in item and item["planned_date"]:
            task.planned_date = item["planned_date"]
        if "estimated_minutes" in item and item["estimated_minutes"] is not None:
            task.estimated_minutes = int(item["estimated_minutes"])
        if "description" in item and item["description"] is not None:
            task.description = item["description"]
        if "status" in item and item["status"]:
            task.status = item["status"]
        if task.id in unfinished_task_ids:
            task.defer_reason = reason
            if task.status == "deferred":
                task.status = "todo"

    version = (
        db.query(PlanVersion)
        .filter(PlanVersion.goal_id == goal_id)
        .count()
        + 1
    )
    snapshot = {"tasks": tasks_payload, "reason": reason}
    db.add(
        PlanVersion(
            goal_id=goal_id,
            version=version,
            reason=reason,
            snapshot_json=json.dumps(snapshot, ensure_ascii=False),
        )
    )
    db.commit()
    tasks = (
        db.query(Task)
        .filter(Task.goal_id == goal_id)
        .order_by(Task.sort_order.asc(), Task.id.asc())
        .all()
    )
    return {"goal_id": goal_id, "tasks": [serialize_task(t) for t in tasks]}
