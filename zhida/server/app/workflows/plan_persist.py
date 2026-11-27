from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..models import Goal, GoalStage, Task, User
from ..resources_catalog import normalize_resources
from .fallback import today_str


def _persist_stages_and_tasks(
    db: Session,
    *,
    goal: Goal,
    user: User,
    stages_data: list[dict],
    goal_resources: list[dict],
) -> list[tuple[GoalStage, list[Task]]]:
    """清空旧阶段/任务后写入新排期。"""
    db.query(Task).filter(Task.goal_id == goal.id).delete()
    db.query(GoalStage).filter(GoalStage.goal_id == goal.id).delete()
    db.flush()

    stage_payload: list[tuple[GoalStage, list[Task]]] = []
    catalog_cycle = goal_resources[:]
    ci = 0
    for si, stage in enumerate(stages_data or []):
        st = GoalStage(
            goal_id=goal.id,
            name=stage.get("name") or f"阶段{si+1}",
            sort_order=int(stage.get("sort_order") or si),
            status="pending",
            skippable=1 if stage.get("skippable") else 0,
            skip_reason=(stage.get("skip_reason") or "")[:255],
        )
        db.add(st)
        db.flush()
        stage_tasks: list[Task] = []
        name_to_task: dict[str, Task] = {}
        pending_deps: list[tuple[Task, list]] = []
        for ti, task in enumerate(stage.get("tasks") or []):
            task_res = normalize_resources(task.get("resources"), source="llm")
            if not task_res and catalog_cycle:
                task_res = [catalog_cycle[ci % len(catalog_cycle)]]
                ci += 1
            daily_cap = max(10, int(goal.daily_minutes or user.daily_minutes_weekday or 60))
            raw_mins = int(task.get("estimated_minutes") or daily_cap or 30)
            t = Task(
                goal_id=goal.id,
                stage_id=st.id,
                user_id=user.id,
                name=task.get("name") or f"任务{ti+1}",
                description=task.get("description") or "",
                estimated_minutes=max(10, min(raw_mins, daily_cap)),
                priority=task.get("priority") or "normal",
                planned_date=task.get("planned_date") or today_str(),
                status="todo",
                sort_order=int(task.get("sort_order") or ti),
                depends_on_json="[]",
                resources_json=json.dumps(task_res, ensure_ascii=False),
            )
            db.add(t)
            db.flush()
            name_to_task[t.name] = t
            stage_tasks.append(t)
            deps = task.get("depends_on") or task.get("depends_on_names") or []
            if deps:
                pending_deps.append((t, deps))
            elif ti > 0:
                pending_deps.append((t, [stage_tasks[ti - 1].name]))
        for t, deps in pending_deps:
            ids = []
            for d in deps:
                if isinstance(d, int):
                    ids.append(d)
                elif isinstance(d, str) and d in name_to_task:
                    ids.append(name_to_task[d].id)
            if ids:
                t.depends_on_json = json.dumps(ids, ensure_ascii=False)
        stage_payload.append((st, stage_tasks))
    return stage_payload


def _apply_skills_skip(modules: list[dict], skills_ctx: list[dict]) -> list[dict]:
    """按技能档案把明显入门模块标为可跳过。"""
    if not modules or not skills_ctx:
        return modules
    strong = {
        (s.get("skill_name") or "").lower()
        for s in skills_ctx
        if int(s.get("level") or 0) >= 3
    }
    if not strong:
        return modules
    out = []
    for m in modules:
        item = dict(m)
        name = (item.get("name") or "").lower()
        skills = " ".join(item.get("skills") or []).lower()
        blob = f"{name} {skills}"
        hit = [k for k in strong if k and k in blob]
        if hit and any(x in name for x in ("基础", "入门", "概念", "现状")):
            item["skippable"] = True
            item["skip_reason"] = item.get("skip_reason") or f"档案已覆盖：{hit[0]}"
        out.append(item)
    return out
