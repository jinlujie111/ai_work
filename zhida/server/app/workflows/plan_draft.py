from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ..llm import LLMError
from ..models import AiUsage, Goal, PlanVersion, User
from ..resources_catalog import (
    catalog_for,
    infer_goal_type,
    learning_path_for,
    merge_learning_path,
    merge_resources,
    normalize_resources,
)
from ..market_service import (
    bump_use_count,
    find_market_match,
    market_item_to_plan_data,
    upsert_market_from_plan,
)
from ..skills_service import skills_context_for_plan
from .fallback import build_plan_fallback, today_str
from .goal_intent import assert_learning_intent, assert_learning_intent_llm
from .plan_common import ProgressCb, _emit
from .plan_graph import normalize_modules, reset_plan_graph, run_plan_graph
from .plan_persist import _apply_skills_skip
from .plan_quota import FREE_GOAL_LIMIT, goal_quota_info
from .plan_serialize import serialize_goal

async def generate_plan_draft(
    db: Session,
    user: User,
    *,
    raw_text: str,
    baseline: str = "",
    daily_minutes: int | None = None,
    on_event: ProgressCb | None = None,
) -> dict:
    """阶段一：关键词拦截 → LLM 意图复核 → 技能市场 → 学习拆解。"""
    await _emit(on_event, {"event": "progress", "step": "start", "message": "开始解析…"})
    await _emit(on_event, {"event": "progress", "step": "intent", "message": "关键词初筛…"})
    # 第一关：关键词硬拦截（不调 LLM）
    intent = assert_learning_intent(raw_text)
    await _emit(
        on_event,
        {
            "event": "progress",
            "step": "intent_ok",
            "message": "关键词通过，准备 AI 复核…",
            "intent": intent.get("intent"),
            "label": intent.get("label"),
        },
    )
    # 第二关：LLM 二次意图判断（未过则不进市场/拆解）
    await _emit(on_event, {"event": "progress", "step": "intent_llm", "message": "AI 二次确认意图…"})
    intent_llm, intent_meta = await assert_learning_intent_llm(raw_text)
    db.add(
        AiUsage(
            user_id=user.id,
            purpose="goal_intent",
            model=intent_meta.get("model", ""),
            prompt_tokens=int(intent_meta.get("prompt_tokens") or 0),
            completion_tokens=int(intent_meta.get("completion_tokens") or 0),
            tokens_accurate=1 if intent_meta.get("tokens_accurate") else 0,
        )
    )
    await _emit(
        on_event,
        {
            "event": "progress",
            "step": "intent_llm_ok",
            "message": "已确认为学习技能类",
            "intent": intent_llm.get("intent"),
            "label": intent_llm.get("label"),
        },
    )
    minutes = int(user.daily_minutes_weekday or daily_minutes or 60)
    skills_ctx = skills_context_for_plan(db, user.id)
    domain = infer_goal_type(raw_text)
    catalog = catalog_for(domain, raw_text)

    await _emit(on_event, {"event": "progress", "step": "quota", "message": "检查目标名额…"})
    quota = goal_quota_info(db, user)
    if not quota["is_member"] and quota["remaining"] <= 0:
        raise ValueError(
            f"免费用户最多保留 {FREE_GOAL_LIMIT} 个目标"
            "（进行中/暂停/已完成/待确认/已终止均计入）。"
            "终止或放弃不释放名额；开通会员不限数量。"
        )

    source = "local"
    await _emit(on_event, {"event": "progress", "step": "market", "message": "匹配技能市场…"})
    market_item = find_market_match(db, raw_text)
    published_market_id = None

    if market_item:
        await _emit(
            on_event,
            {
                "event": "progress",
                "step": "market_hit",
                "message": f"命中市场：{market_item.skill_name}",
            },
        )
        data = market_item_to_plan_data(
            market_item,
            raw_text=raw_text,
            baseline=baseline,
            daily_minutes=minutes,
        )
        source = "market"
        bump_use_count(db, market_item)
    else:
        await _emit(on_event, {"event": "progress", "step": "llm", "message": "AI 解析技能中…"})
        try:
            reset_plan_graph()
            data, meta = await run_plan_graph(
                raw_text=raw_text,
                baseline=baseline,
                daily_minutes=minutes,
                today=today_str(),
                skills_context=skills_ctx,
                catalog_hints=catalog,
                on_progress=on_event,
            )
            source = "langgraph"
            db.add(
                AiUsage(
                    user_id=user.id,
                    purpose="plan_modules",
                    model=meta.get("model", ""),
                    prompt_tokens=int(meta.get("prompt_tokens") or 0),
                    completion_tokens=int(meta.get("completion_tokens") or 0),
                    tokens_accurate=1 if meta.get("tokens_accurate") else 0,
                )
            )
            await _emit(on_event, {"event": "progress", "step": "llm_done", "message": "解析完成，整理草案…"})
        except LLMError:
            await _emit(on_event, {"event": "progress", "step": "fallback", "message": "改用本地模板…"})
            data = build_plan_fallback(
                raw_text=raw_text,
                baseline=baseline,
                daily_minutes=minutes,
            )
            source = "fallback"
            data["skill_overview"] = (
                data.get("skill_overview")
                or f"围绕「{(raw_text or '')[:24]}」建立可检验的学习路径，先打基础再交付。"
            )
            data["skill_scenarios"] = data.get("skill_scenarios") or [
                "日常工作中落地使用",
                "作品或面试展示",
                "自学进阶与复盘",
            ]
            data["marketable"] = False

    if skills_ctx and not (data.get("goal") or {}).get("baseline"):
        data.setdefault("goal", {})["baseline"] = "；".join(
            f"{s['skill_name']}·{s.get('level_label')}" for s in skills_ctx[:6]
        )
    data["modules"] = _apply_skills_skip(data.get("modules") or [], skills_ctx)
    data.setdefault("analysis", {})
    data["analysis"]["source"] = source
    data["analysis"]["phase"] = "modules"
    data["analysis"]["skills_used"] = skills_ctx

    g = data["goal"]
    goal_type = infer_goal_type(raw_text, g.get("goal_type") or domain)
    llm_res = normalize_resources(data.get("recommended_resources"), source="llm")
    # 汇总各阶段材料到目标级资料
    stage_mats = []
    for m in data.get("modules") or []:
        stage_mats.extend(m.get("materials") or [])
    goal_resources = merge_resources(
        catalog,
        merge_resources(normalize_resources(stage_mats, source="llm"), llm_res, limit=8),
        limit=8,
    )
    learning_path = merge_learning_path(
        learning_path_for(goal_type, raw_text),
        data.get("learning_path") if isinstance(data.get("learning_path"), dict) else None,
    )

    modules = normalize_modules(
        data.get("modules"),
        skill_categories=data.get("skill_categories") or [],
    )
    # 阶段仍无材料时用目录补
    for i, m in enumerate(modules):
        if m.get("materials"):
            continue
        if catalog:
            h = catalog[i % len(catalog)]
            m["materials"] = [
                {
                    "title": h.get("title") or "推荐资料",
                    "type": h.get("type") or "doc",
                    "url": h.get("url") or "",
                    "note": h.get("note") or "",
                }
            ]
    skill_categories = [
        str(c).strip() for c in (data.get("skill_categories") or []) if str(c).strip()
    ][:5]
    if not skill_categories:
        skill_categories = list({m["category"] for m in modules if m.get("category")}) or ["综合"]
    skill_overview = (data.get("skill_overview") or "").strip()
    skill_scenarios = data.get("skill_scenarios") or []
    if isinstance(skill_scenarios, str):
        skill_scenarios = [s.strip() for s in skill_scenarios.split("\n") if s.strip()]
    skill_scenarios = [str(s).strip() for s in skill_scenarios if str(s).strip()][:6]
    modules_blob = {
        "skill_categories": skill_categories,
        "skill_overview": skill_overview,
        "skill_scenarios": skill_scenarios,
        "modules": modules,
    }

    # 大模型生成的普遍技能 → 写入技能市场；个人规划 / 本地兜底不写
    if source == "langgraph":
        pub_data = {
            **data,
            "modules": modules,
            "skill_overview": skill_overview,
            "skill_scenarios": skill_scenarios,
            "skill_categories": skill_categories,
            "goal": g,
        }
        published = upsert_market_from_plan(
            db,
            raw_text=raw_text,
            data=pub_data,
            resources=goal_resources,
            learning_path=learning_path,
        )
        if published:
            published_market_id = published.id
            data.setdefault("analysis", {})
            data["analysis"]["published_market_id"] = published_market_id
            data["analysis"]["published_market_name"] = published.skill_name
        else:
            data.setdefault("analysis", {})
            data["analysis"]["publish_skipped"] = True
            data["analysis"]["publish_skip_reason"] = (
                "判定为个人规划或缺少技能名，未写入市场"
            )
    elif source == "fallback":
        data.setdefault("analysis", {})
        data["analysis"]["publish_skipped"] = True
        data["analysis"]["publish_skip_reason"] = "本地兜底未走大模型，不写入市场"

    await _emit(on_event, {"event": "progress", "step": "save", "message": "保存学习草案…"})
    start = g.get("start_date") or today_str()
    deadline = (g.get("deadline") or "").strip()
    # 市场命中等路径若未给截止日 / 误写成当天，按模块量 + 每日时长估算
    if not deadline or deadline <= start:
        from ..market_service import estimate_module_days
        from .fallback import add_days

        deadline = add_days(
            start,
            estimate_module_days(modules, daily_minutes=int(g.get("daily_minutes") or minutes)),
        )
    goal = Goal(
        user_id=user.id,
        title=g.get("title") or "未命名目标",
        description=g.get("description") or raw_text,
        goal_type=goal_type,
        baseline=g.get("baseline") or baseline or "未说明",
        daily_minutes=int(g.get("daily_minutes") or minutes),
        start_date=start,
        deadline=deadline,
        status="planning",
        completion_criteria=g.get("completion_criteria") or "",
        resources_json=json.dumps(goal_resources, ensure_ascii=False),
        learning_path_json=json.dumps(learning_path, ensure_ascii=False),
        modules_json=json.dumps(modules_blob, ensure_ascii=False),
        plan_source=source,
    )
    db.add(goal)
    db.flush()

    snapshot = {
        "phase": "modules",
        "skill_categories": skill_categories,
        "skill_overview": skill_overview,
        "skill_scenarios": skill_scenarios,
        "modules": modules,
        "recommended_resources": goal_resources,
        "learning_path": learning_path,
        "source": source,
        "market_id": getattr(market_item, "id", None) if market_item else published_market_id,
    }
    db.add(
        PlanVersion(
            goal_id=goal.id,
            version=1,
            reason="模块草案(未排期)" if source != "market" else "技能市场复用",
            snapshot_json=json.dumps(snapshot, ensure_ascii=False),
        )
    )
    db.commit()
    db.refresh(goal)
    await _emit(on_event, {"event": "progress", "step": "done", "message": "草案已就绪"})

    analysis = data.get("analysis") or {"reason": "", "warnings": [], "source": source}
    analysis["source"] = source
    analysis["skills_used"] = skills_ctx
    analysis["phase"] = "modules"
    if market_item:
        analysis["market_id"] = market_item.id
        analysis["market_skill_name"] = market_item.skill_name
    if published_market_id:
        analysis["published_market_id"] = published_market_id

    return {
        "goal": serialize_goal(goal),
        "skill_categories": skill_categories,
        "skill_overview": skill_overview,
        "skill_scenarios": skill_scenarios,
        "modules": modules,
        "stages": [],
        "recommended_resources": goal_resources,
        "learning_path": learning_path,
        "analysis": analysis,
    }

