from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..llm import LLMError
from ..models import AiUsage, Goal, PlanVersion, User
from ..resources_catalog import catalog_for
from .fallback import today_str
from .plan_common import ProgressCb, _emit
from .plan_graph import expand_selected_modules, schedule_stages
from .plan_persist import _persist_stages_and_tasks
from .plan_scheduling import apply_goal_priority_order, occupied_minutes_by_day, rebalance_user_open_tasks
from .plan_serialize import _parse_learning_path, _parse_modules_blob, _parse_resources

async def materialize_goal_from_modules(
    db: Session,
    user: User,
    goal: Goal,
    *,
    selected_module_keys: list[str],
    goal_priority_order: list[int] | None = None,
    on_event: ProgressCb | None = None,
) -> dict:
    """阶段二：按勾选模块展开任务、排期并激活目标。"""
    await _emit(on_event, {"event": "progress", "step": "start", "message": "开始写入日程…"})
    blob = _parse_modules_blob(getattr(goal, "modules_json", None))
    all_modules = blob.get("modules") or []
    by_key = {m.get("key"): m for m in all_modules if m.get("key")}
    keys = [k for k in selected_module_keys if k in by_key]
    if not keys:
        raise ValueError("请至少选择一个有效模块")
    selected = [by_key[k] for k in keys]

    catalog_hints = catalog_for(goal.goal_type or "generic", goal.description or goal.title)
    goal_resources = _parse_resources(goal.resources_json)

    start = goal.start_date or today_str()
    # 始终跟「我的」每日可用时间对齐
    weekday = max(10, int(user.daily_minutes_weekday or goal.daily_minutes or 60))
    weekend = max(10, int(user.daily_minutes_weekend or weekday))
    goal.daily_minutes = weekday
    goal.start_date = start
    # 截止日无效（空 / 当天）时按模块估算，避免全部压到第一天
    deadline = (goal.deadline or "").strip()
    if not deadline or deadline <= start:
        from ..market_service import estimate_module_days
        from .fallback import add_days

        deadline = add_days(
            start,
            estimate_module_days(selected, daily_minutes=weekday),
        )
        goal.deadline = deadline
    # 排期时避开其他进行中目标已占用的分钟
    occupied = occupied_minutes_by_day(db, user.id, exclude_goal_id=goal.id, from_date=start)

    await _emit(on_event, {"event": "progress", "step": "expand", "message": "AI 拆解任务中…"})
    try:
        expanded, meta = await expand_selected_modules(
            goal_title=goal.title,
            goal_description=goal.description or "",
            baseline=goal.baseline or "",
            daily_minutes=weekday,
            start_date=start,
            deadline=deadline,
            selected_modules=selected,
            catalog_hints=catalog_hints,
            occupied=occupied,
            weekend_minutes=weekend,
            on_progress=on_event,
        )
        db.add(
            AiUsage(
                user_id=user.id,
                purpose="plan_expand",
                model=meta.get("model", ""),
                prompt_tokens=int(meta.get("prompt_tokens") or 0),
                completion_tokens=int(meta.get("completion_tokens") or 0),
                tokens_accurate=1 if meta.get("tokens_accurate") else 0,
            )
        )
        await _emit(on_event, {"event": "progress", "step": "expand_done", "message": "任务拆解完成"})
    except LLMError:
        await _emit(on_event, {"event": "progress", "step": "fallback", "message": "改用本地拆解…"})
        # 本地展开：每个模块 skills → 任务，再排期
        raw_stages = []
        for si, m in enumerate(selected):
            skills = m.get("skills") or [m.get("learn") or m.get("name")]
            tasks = [
                {
                    "name": f"学习：{sk}",
                    "description": m.get("learn") or "",
                    "estimated_minutes": min(weekday, 45),
                    "priority": "high" if si == 0 and ti == 0 else "normal",
                    "sort_order": ti,
                    "related_skills": [sk],
                    "resources": [],
                }
                for ti, sk in enumerate(skills[:3])
            ]
            raw_stages.append(
                {
                    "module_key": m.get("key"),
                    "name": m.get("name"),
                    "sort_order": si,
                    "skippable": bool(m.get("skippable")),
                    "skip_reason": m.get("skip_reason") or "",
                    "tasks": tasks,
                }
            )
        scheduled, dl, warnings = schedule_stages(
            stages=raw_stages,
            daily_minutes=weekday,
            start_date=start,
            deadline=deadline,
            occupied=occupied,
            weekend_minutes=weekend,
        )
        expanded = {
            "stages": scheduled,
            "deadline": dl,
            "reason": "本地按模块展开",
            "warnings": warnings,
        }

    await _emit(on_event, {"event": "progress", "step": "schedule", "message": "写入日历并重排…"})
    stage_payload = _persist_stages_and_tasks(
        db,
        goal=goal,
        user=user,
        stages_data=expanded.get("stages") or [],
        goal_resources=goal_resources,
    )
    goal.status = "active"
    # 必须先 flush：重排按 Goal.status==active 查库，不 flush 会漏掉刚激活目标，任务全堆当天
    db.flush()
    # 多目标：先落优先级，再按优先级重排日历
    apply_goal_priority_order(
        db, user, goal_priority_order, ensure_goal_id=goal.id
    )
    db.flush()
    rebalance_user_open_tasks(db, user, from_date=start)
    if expanded.get("deadline"):
        goal.deadline = max(expanded["deadline"], goal.deadline or "")

    blob["selected_module_keys"] = keys
    blob["selected_modules"] = [m.get("name") for m in selected]
    if goal_priority_order:
        blob["goal_priority_order"] = list(goal_priority_order)
    goal.modules_json = json.dumps(blob, ensure_ascii=False)

    path = _parse_learning_path(goal.learning_path_json)
    path["selected_modules"] = [m.get("name") for m in selected]
    path["summary"] = (
        f"{(path.get('summary') or '').rstrip('。')}。"
        f"已确认 {len(selected)} 个模块并写入日程"
    ).strip("。") + "。"
    goal.learning_path_json = json.dumps(path, ensure_ascii=False)

    snapshot = {
        "phase": "scheduled",
        "selected_module_keys": keys,
        "stages": [
            {
                "id": st.id,
                "name": st.name,
                "tasks": [
                    {
                        "id": t.id,
                        "name": t.name,
                        "planned_date": t.planned_date,
                        "estimated_minutes": t.estimated_minutes,
                    }
                    for t in tasks
                ],
            }
            for st, tasks in stage_payload
        ],
    }
    db.add(
        PlanVersion(
            goal_id=goal.id,
            version=2,
            reason=expanded.get("reason") or "确认模块并排期",
            snapshot_json=json.dumps(snapshot, ensure_ascii=False),
        )
    )
    db.commit()
    db.refresh(goal)

    task_count = sum(len(tasks) for _, tasks in stage_payload)
    await _emit(
        on_event,
        {
            "event": "progress",
            "step": "done",
            "message": f"已写入 {task_count} 项任务",
        },
    )
    return {
        "ok": True,
        "status": "active",
        "kept_modules": len(selected),
        "dropped_modules": max(0, len(all_modules) - len(selected)),
        "kept_tasks": task_count,
        "deadline": goal.deadline,
        "warnings": expanded.get("warnings") or [],
    }

