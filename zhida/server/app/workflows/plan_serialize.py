from __future__ import annotations

import json

from ..models import Goal, GoalStage, Task
from ..resources_catalog import TYPE_LABEL, default_howto_find, normalize_origin


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
        out = dict(data)
        out["skill_categories"] = data.get("skill_categories") or []
        out["modules"] = data.get("modules") or []
        return out
    except json.JSONDecodeError:
        return {"skill_categories": [], "modules": []}


def _enrich_resources_with_content(resources: list, modules: list) -> list:
    """为资料补齐学习文档描述：优先自身 content，其次模块材料，再拼 note + 阶段要点。"""
    by_title: dict[str, dict] = {}
    for m in modules or []:
        if not isinstance(m, dict):
            continue
        stage_learn = (m.get("learn") or "").strip()
        stage_name = (m.get("name") or "").strip()
        for mat in m.get("materials") or m.get("resources") or []:
            if not isinstance(mat, dict):
                continue
            key = (mat.get("title") or "").strip().lower()
            if not key:
                continue
            by_title[key] = {
                **mat,
                "stage_learn": stage_learn,
                "stage_name": stage_name,
            }
    out = []
    for r in resources or []:
        if not isinstance(r, dict):
            continue
        item = dict(r)
        key = (item.get("title") or "").strip().lower()
        hit = by_title.get(key) or {}
        content = (item.get("content") or hit.get("content") or "").strip()
        note = (item.get("note") or hit.get("note") or "").strip()
        origin = (item.get("origin") or hit.get("origin") or "").strip()
        howto_find = (item.get("howto_find") or hit.get("howto_find") or "").strip()
        url = (item.get("url") or hit.get("url") or "").strip()
        stage_learn = (hit.get("stage_learn") or "").strip()
        if not content:
            parts = []
            if note:
                parts.append(note)
            if stage_learn:
                parts.append(f"所属阶段要点：{stage_learn}")
            content = "\n\n".join(parts)
        t = (item.get("type") or hit.get("type") or "doc").strip()
        title = (item.get("title") or hit.get("title") or "").strip()
        origin = normalize_origin(origin, mat_type=t, url=url, title=title)
        if not howto_find:
            howto_find = default_howto_find(
                title=title, mat_type=t, url=url, origin=origin
            )
        if not item.get("note") and note:
            item["note"] = note
        item["content"] = content
        item["origin"] = origin
        item["howto_find"] = howto_find
        if url and not item.get("url"):
            item["url"] = url
        item["type"] = t
        if not item.get("type_label"):
            item["type_label"] = TYPE_LABEL.get(t, t)
        if hit.get("stage_name"):
            item["stage_name"] = hit.get("stage_name")
        out.append(item)
    return out


def serialize_goal(goal: Goal) -> dict:
    blob = _parse_modules_blob(getattr(goal, "modules_json", None))
    modules = blob.get("modules") or []
    resources = _enrich_resources_with_content(
        _parse_resources(goal.resources_json), modules
    )
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
        "resources": resources,
        "learning_path": _parse_learning_path(goal.learning_path_json),
        "skill_categories": blob.get("skill_categories") or [],
        "skill_overview": blob.get("skill_overview") or "",
        "skill_scenarios": blob.get("skill_scenarios") or [],
        "modules": modules,
        "plan_source": getattr(goal, "plan_source", None) or "",
        "market_item_id": int(getattr(goal, "market_item_id", None) or 0),
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
    out["goal_type"] = (goal.goal_type if goal else "") or ""
    out["is_inbox"] = bool(goal and (goal.goal_type or "") == "inbox")
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
    if isinstance(resources, list):
        enriched = []
        for r in resources:
            if not isinstance(r, dict):
                continue
            item = dict(r)
            content = (item.get("content") or "").strip()
            note = (item.get("note") or "").strip()
            origin = (item.get("origin") or "").strip()
            howto_find = (item.get("howto_find") or "").strip()
            url = (item.get("url") or "").strip()
            title = (item.get("title") or "").strip()
            mat_type = (item.get("type") or "doc").strip()
            if not content:
                parts = []
                if note:
                    parts.append(note)
                if learn:
                    parts.append(f"任务要点：{learn}")
                content = "\n\n".join(parts)
            origin = normalize_origin(origin, mat_type=mat_type, url=url, title=title)
            if not howto_find:
                howto_find = default_howto_find(
                    title=title, mat_type=mat_type, url=url, origin=origin
                )
            item["content"] = content
            item["origin"] = origin
            item["howto_find"] = howto_find
            enriched.append(item)
        resources = enriched
    else:
        resources = []
    out["stage_id"] = task.stage_id
    out["stage_name"] = stage.name if stage else (mod.get("name") or "")
    out["stage_no"] = stage_no
    out["stage_total"] = len(stages) or len(modules)
    out["learn_content"] = learn
    out["resources"] = resources
    return out
