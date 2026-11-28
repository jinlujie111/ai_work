from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..llm import LLMError
from ..models import AiUsage, Goal, PlanVersion, User
from ..resources_catalog import catalog_for
from ..skills_service import skills_context_for_plan
from .fallback import today_str
from .plan_common import ProgressCb, _emit
from .plan_graph import expand_selected_modules, schedule_stages
from .plan_persist import _persist_stages_and_tasks
from .plan_scheduling import apply_goal_priority_order, occupied_minutes_by_day, rebalance_user_open_tasks
from .plan_serialize import _parse_learning_path, _parse_modules_blob, _parse_resources
from .task_expand_quality import build_fallback_stages, build_upcoming_preview, filter_stages_by_drop_keys


def _selected_modules(goal: Goal, selected_module_keys: list[str]) -> tuple[list[dict], list[dict], list[str]]:
    blob = _parse_modules_blob(getattr(goal, "modules_json", None))
    all_modules = blob.get("modules") or []
    by_key = {m.get("key"): m for m in all_modules if m.get("key")}
    keys = [k for k in selected_module_keys if k in by_key]
    if not keys:
        raise ValueError("请至少选择一个有效模块")
    selected = [by_key[k] for k in keys]
    return all_modules, selected, keys


def _resolve_deadline(goal: Goal, selected: list[dict], start: str, weekday: int) -> str:
    """写入/预览日历前的截止日：用户明示周期优先，否则按勾选模块难度重估。"""
    from ..market_service import estimate_module_days
    from .fallback import add_days
    from .plan_graph import parse_user_duration_days

    # 只用 description（多为用户原文），避免标题里的「烧烤入门30天」被当成用户意图
    user_days = parse_user_duration_days(goal.description or "")
    estimated = estimate_module_days(selected, daily_minutes=weekday)
    if user_days is not None and user_days > 0:
        deadline = add_days(start, user_days)
    elif user_days == -1:
        deadline = (goal.deadline or "").strip()
        if not deadline or deadline <= start:
            deadline = add_days(start, estimated)
    else:
        deadline = add_days(start, estimated)
    goal.deadline = deadline
    return deadline


async def _expand_for_goal(
    db: Session,
    user: User,
    goal: Goal,
    selected: list[dict],
    *,
    on_event: ProgressCb | None = None,
) -> dict:
    catalog_hints = catalog_for(goal.goal_type or "generic", goal.description or goal.title)
    start = goal.start_date or today_str()
    weekday = max(15, int(user.daily_minutes_weekday or goal.daily_minutes or 60))
    weekend = max(15, int(user.daily_minutes_weekend or weekday))
    goal.daily_minutes = weekday
    goal.start_date = start
    deadline = _resolve_deadline(goal, selected, start, weekday)
    occupied = occupied_minutes_by_day(db, user.id, exclude_goal_id=goal.id, from_date=start)
    skills_ctx = skills_context_for_plan(db, user.id)

    await _emit(on_event, {"event": "progress", "step": "expand", "message": "AI 拆解可执行任务…"})
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
            skills_context=skills_ctx,
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
        expanded["_meta"] = meta
        return expanded
    except LLMError:
        await _emit(on_event, {"event": "progress", "step": "fallback", "message": "改用本地可执行模板…"})
        raw_stages = build_fallback_stages(selected, daily_minutes=weekday)
        scheduled, dl, warnings = schedule_stages(
            stages=raw_stages,
            daily_minutes=weekday,
            start_date=start,
            deadline=deadline,
            occupied=occupied,
            weekend_minutes=weekend,
        )
        return {
            "stages": scheduled,
            "deadline": dl,
            "reason": "本地可执行模板展开",
            "warnings": warnings,
            "upcoming_preview": build_upcoming_preview(scheduled, days=3),
        }


async def preview_goal_from_modules(
    db: Session,
    user: User,
    goal: Goal,
    *,
    selected_module_keys: list[str],
    on_event: ProgressCb | None = None,
) -> dict:
    """只展开并排期，不写入日历；供确认页预览前 3 天任务。"""
    await _emit(on_event, {"event": "progress", "step": "start", "message": "预览任务中…"})
    _all, selected, keys = _selected_modules(goal, selected_module_keys)
    expanded = await _expand_for_goal(db, user, goal, selected, on_event=on_event)
    stages = expanded.get("stages") or []
    upcoming = expanded.get("upcoming_preview") or build_upcoming_preview(stages, days=3)
    # 缓存到 modules_json，正式确认时复用，避免二次 LLM
    blob = _parse_modules_blob(getattr(goal, "modules_json", None))
    blob["_expand_preview"] = {
        "selected_module_keys": keys,
        "stages": stages,
        "deadline": expanded.get("deadline") or goal.deadline,
        "warnings": expanded.get("warnings") or [],
    }
    goal.modules_json = json.dumps(blob, ensure_ascii=False)
    if expanded.get("deadline"):
        goal.deadline = expanded["deadline"]
    db.commit()
    await _emit(on_event, {"event": "progress", "step": "done", "message": "预览已就绪"})
    return {
        "ok": True,
        "phase": "preview",
        "selected_module_keys": keys,
        "deadline": expanded.get("deadline") or goal.deadline,
        "warnings": expanded.get("warnings") or [],
        "upcoming_preview": upcoming,
        "task_count": sum(len(st.get("tasks") or []) for st in stages),
    }


async def materialize_goal_from_modules(
    db: Session,
    user: User,
    goal: Goal,
    *,
    selected_module_keys: list[str],
    goal_priority_order: list[int] | None = None,
    drop_task_keys: list[str] | None = None,
    on_event: ProgressCb | None = None,
) -> dict:
    """阶段二：按勾选模块展开任务、排期并激活目标。"""
    await _emit(on_event, {"event": "progress", "step": "start", "message": "开始写入日程…"})
    all_modules, selected, keys = _selected_modules(goal, selected_module_keys)
    goal_resources = _parse_resources(goal.resources_json)

    blob = _parse_modules_blob(getattr(goal, "modules_json", None))
    cached = blob.get("_expand_preview") if isinstance(blob.get("_expand_preview"), dict) else None
    cache_keys = list((cached or {}).get("selected_module_keys") or [])
    use_cache = (
        cached
        and cache_keys == keys
        and isinstance(cached.get("stages"), list)
        and cached.get("stages")
    )

    if use_cache:
        stages = filter_stages_by_drop_keys(cached.get("stages") or [], drop_task_keys)
        if not any(st.get("tasks") for st in stages):
            raise ValueError("请至少保留一个任务再写入日程")
        expanded = {
            "stages": stages,
            "deadline": cached.get("deadline") or goal.deadline,
            "reason": "确认预览任务并排期",
            "warnings": list(cached.get("warnings") or []),
            "upcoming_preview": build_upcoming_preview(stages, days=3),
        }
        await _emit(on_event, {"event": "progress", "step": "expand_done", "message": "使用预览任务"})
    else:
        expanded = await _expand_for_goal(db, user, goal, selected, on_event=on_event)
        if drop_task_keys:
            stages = filter_stages_by_drop_keys(expanded.get("stages") or [], drop_task_keys)
            if not any(st.get("tasks") for st in stages):
                raise ValueError("请至少保留一个任务再写入日程")
            expanded["stages"] = stages
            expanded["upcoming_preview"] = build_upcoming_preview(stages, days=3)

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
    apply_goal_priority_order(
        db, user, goal_priority_order, ensure_goal_id=goal.id
    )
    db.flush()
    start = goal.start_date or today_str()
    rebalance_user_open_tasks(db, user, from_date=start)
    if expanded.get("deadline"):
        goal.deadline = max(expanded["deadline"], goal.deadline or "")

    blob = _parse_modules_blob(getattr(goal, "modules_json", None))
    blob.pop("_expand_preview", None)
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
    upcoming = expanded.get("upcoming_preview") or build_upcoming_preview(
        expanded.get("stages") or [], days=3
    )
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
        "upcoming_preview": upcoming,
    }
