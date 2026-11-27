from __future__ import annotations

import json

from ..models import Goal, GoalStage, Task


def _parse_resources(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _parse_learning_path(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _parse_modules_blob(raw: str | None) -> dict:
    if not raw:
        return {"skill_categories": [], "modules": []}
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            return {"skill_categories": [], "modules": []}
        return {
            "skill_categories": data.get("skill_categories") or [],
            "modules": data.get("modules") or [],
        }
    except json.JSONDecodeError:
        return {"skill_categories": [], "modules": []}


def serialize_goal(goal: Goal) -> dict:
    blob = _parse_modules_blob(getattr(goal, "modules_json", None))
    return {
        "id": goal.id,
        "title": goal.title,
        "description": goal.description,
        "goal_type": goal.goal_type,
        "baseline": goal.baseline,
        "daily_minutes": goal.daily_minutes,
        "start_date": goal.start_date,
        "deadline": goal.deadline,
        "status": goal.status,
        "priority_rank": int(getattr(goal, "priority_rank", None) or 100),
        "completion_criteria": goal.completion_criteria,
        "resources": _parse_resources(goal.resources_json),
        "learning_path": _parse_learning_path(goal.learning_path_json),
        "skill_categories": blob.get("skill_categories") or [],
        "skill_overview": blob.get("skill_overview") or "",
        "skill_scenarios": blob.get("skill_scenarios") or [],
        "modules": blob.get("modules") or [],
    }


def serialize_task(task: Task) -> dict:
    deps = []
    if task.depends_on_json:
        try:
            raw = json.loads(task.depends_on_json)
            if isinstance(raw, list):
                deps = [int(x) for x in raw]
        except json.JSONDecodeError:
            deps = []
    return {
        "id": task.id,
        "goal_id": task.goal_id,
        "stage_id": task.stage_id,
        "name": task.name,
        "description": task.description,
        "estimated_minutes": task.estimated_minutes,
        "priority": task.priority,
        "planned_date": task.planned_date,
        "status": task.status,
        "defer_reason": task.defer_reason,
        "depends_on": deps,
        "resources": _parse_resources(task.resources_json),
        "sort_order": task.sort_order,
    }


def enrich_task_learning(
    db,
    task: Task,
    goal: Goal,
    item: dict | None = None,
    *,
    stages: list[GoalStage] | None = None,
    stage_by_id: dict[int, GoalStage] | None = None,
) -> dict:
    """为任务补齐阶段序号、学习内容、材料（概览/日历共用）。

    传入 stages / stage_by_id 可避免 N+1；未传则按需查库（兼容旧调用）。
    """
    out = dict(item or serialize_task(task))
    out["goal_title"] = goal.title if goal else out.get("goal_title") or ""
    if stages is None:
        stages = (
            db.query(GoalStage)
            .filter(GoalStage.goal_id == goal.id)
            .order_by(GoalStage.sort_order.asc(), GoalStage.id.asc())
            .all()
        )
    if stage_by_id is None:
        stage_by_id = {s.id: s for s in stages}
    stage = stage_by_id.get(task.stage_id) if task.stage_id else None
    stage_no = 0
    if stage and stages:
        for i, s in enumerate(stages):
            if s.id == stage.id:
                stage_no = i + 1
                break
    blob = _parse_modules_blob(getattr(goal, "modules_json", None))
    modules = blob.get("modules") or []
    if not isinstance(modules, list):
        modules = []
    mod = modules[stage_no - 1] if stage_no and stage_no <= len(modules) else {}
    learn = (
        (task.description or "").strip()
        or (mod.get("learn") or "").strip()
        or (stage.name if stage else "")
        or ""
    )
    resources = out.get("resources") or _parse_resources(task.resources_json)
    if not resources:
        resources = mod.get("materials") or mod.get("resources") or []
    out["stage_id"] = task.stage_id
    out["stage_name"] = stage.name if stage else (mod.get("name") or "")
    out["stage_no"] = stage_no
    out["stage_total"] = len(stages) or len(modules)
    out["learn_content"] = learn
    out["resources"] = resources if isinstance(resources, list) else []
    return out
