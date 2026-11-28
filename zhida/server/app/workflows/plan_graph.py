"""目标规划 LangGraph：两阶段。

1) 草案：只识别技能分类与学习模块（不含任务/日历）
2) 确认：按勾选模块展开任务并确定性排期
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from ..llm import LLMError, chat_json
from ..market_service import estimate_module_days
from ..resources_catalog import default_howto_find, normalize_origin
from .goal_intent import REJECT_MSG, is_llm_rejected


def parse_user_duration_days(raw: str) -> int | None:
    """用户是否写明学习周期。返回天数；绝对日期返回 -1；未说明返回 None。"""
    text = (raw or "").strip()
    if not text:
        return None
    if re.search(r"\d{4}\s*[-/年]\s*\d{1,2}\s*[-/月]\s*\d{1,2}", text):
        return -1
    if re.search(r"\d{1,2}\s*月\s*\d{1,2}\s*[日号]", text):
        return -1
    m = re.search(r"(\d+)\s*天", text)
    if m:
        return max(1, min(int(m.group(1)), 90))
    m = re.search(r"(\d+)\s*周", text)
    if m:
        return max(1, min(int(m.group(1)) * 7, 90))
    if re.search(r"[两俩二]\s*周", text):
        return 14
    if "半个月" in text:
        return 15
    m = re.search(r"(\d+)\s*个?月", text)
    if m:
        return max(1, min(int(m.group(1)) * 30, 90))
    if re.search(r"(一个月|1个月)", text):
        return 30
    return None


def strip_duration_from_title(title: str) -> str:
    """去掉标题里 LLM 擅自加的「N天/N周」，避免用户未说周期却显示 30 天。"""
    text = (title or "").strip()
    if not text:
        return text
    text = re.sub(r"\d+\s*天", "", text)
    text = re.sub(r"\d+\s*周", "", text)
    text = re.sub(r"\d+\s*个?月", "", text)
    text = re.sub(r"[·\-_|/]\s*$", "", text)
    text = re.sub(r"\s{2,}", " ", text).strip(" ·-_|/")
    return text or (title or "").strip()


class PlanGraphState(TypedDict, total=False):
    raw_text: str
    baseline: str
    daily_minutes: int
    today: str
    skills_context: list
    catalog_hints: list
    path_hint: dict
    on_progress: object
    extracted: dict
    feasibility: dict
    modules_draft: dict
    recommended_resources: list
    learning_path: dict
    warnings: list
    usage: list
    trace: list
    error: str


DIFF_LABEL = {"easy": "入门", "medium": "进阶", "hard": "较难"}


def _merge_usage(state: PlanGraphState, meta: dict) -> list:
    usage = list(state.get("usage") or [])
    usage.append(meta)
    return usage


def _append_trace(state: PlanGraphState, step: str, note: str = "") -> list:
    trace = list(state.get("trace") or [])
    trace.append({"step": step, "note": note})
    return trace


def _add_days(date_str: str, n: int) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=n)
    return d.strftime("%Y-%m-%d")


def _normalize_materials(raw) -> list[dict]:
    out = []
    for r in raw or []:
        if not isinstance(r, dict):
            continue
        title = (r.get("title") or r.get("name") or "").strip()
        if not title:
            continue
        note = (r.get("note") or r.get("desc") or "").strip()
        content = (
            r.get("content") or r.get("body") or r.get("description") or ""
        ).strip()
        if not content and note:
            content = note
        mat_type = (r.get("type") or "doc")[:24]
        url = (r.get("url") or "").strip()
        origin = normalize_origin(
            r.get("origin") or r.get("cite") or r.get("source_name") or r.get("from") or "",
            mat_type=mat_type,
            url=url,
            title=title,
        )
        howto_find = (
            r.get("howto_find")
            or r.get("how_to_find")
            or r.get("find")
            or r.get("search")
            or ""
        ).strip() or default_howto_find(
            title=title, mat_type=mat_type, url=url, origin=origin
        )
        out.append(
            {
                "title": title[:80],
                "type": mat_type,
                "url": url[:500],
                "note": note[:120],
                "content": content[:1200],
                "origin": origin[:120],
                "howto_find": howto_find[:240],
            }
        )
        if len(out) >= 4:
            break
    return out


def normalize_modules(raw_modules: list | None, *, skill_categories: list | None = None) -> list[dict]:
    out = []
    cats = [str(c).strip() for c in (skill_categories or []) if str(c).strip()]
    for i, m in enumerate(raw_modules or []):
        if not isinstance(m, dict):
            continue
        key = str(m.get("key") or f"m{i+1}").strip() or f"m{i+1}"
        diff = (m.get("difficulty") or "medium").lower()
        if diff not in DIFF_LABEL:
            diff = "medium"
        skills = m.get("skills") or m.get("skill_items") or []
        if isinstance(skills, str):
            skills = [s.strip() for s in skills.replace("，", ",").split(",") if s.strip()]
        skills = [str(s).strip() for s in skills if str(s).strip()][:12]
        learn = (m.get("learn") or m.get("learn_what") or m.get("summary") or "").strip()
        name = (m.get("name") or f"模块{i+1}").strip()[:64]
        cat = (m.get("category") or (cats[0] if cats else "") or "").strip()
        materials = _normalize_materials(m.get("materials") or m.get("resources"))
        out.append(
            {
                "key": key,
                "name": name,
                "category": cat,
                "skills": skills,
                "learn": learn or f"掌握「{name}」相关能力",
                "difficulty": diff,
                "difficulty_label": m.get("difficulty_label") or DIFF_LABEL[diff],
                "estimated_hours": max(1, min(int(m.get("estimated_hours") or 8), 80)),
                "skippable": bool(m.get("skippable")),
                "skip_reason": (m.get("skip_reason") or "")[:255],
                "materials": materials,
            }
        )
    return out[:8]


async def node_modules(state: PlanGraphState) -> dict:
    """一次 LLM：技能概括 + 使用场景 + 分阶段学习（含材料）。"""
    system = """你是学习技能拆解器。系统已确认输入为学习技能类。只输出 JSON：
{
  "title": "短标题≤16字，不要写天数（除非用户原文写了）",
  "description": "一句话目标",
  "goal_type": "ai|python|english|fitness|office|generic",
  "baseline": "当前基础",
  "total_days": 14,
  "completion_criteria": "可检验标准一句",
  "skill_overview": "对该技能的概括，2~4句，说清是什么、核心能力边界",
  "skill_scenarios": ["使用场景1", "使用场景2", "使用场景3"],
  "skill_categories": ["大类1"],
  "modules": [
    {
      "key": "m1",
      "name": "阶段名",
      "category": "大类",
      "skills": ["技能点1", "技能点2"],
      "learn": "本阶段要学的内容，具体可执行",
      "difficulty": "easy|medium|hard",
      "estimated_hours": 8,
      "skippable": false,
      "skip_reason": "",
      "materials": [
        {
          "title": "资料名（真实可检索）",
          "type": "doc|course|book|video|practice|tool|repo",
          "url": "有稳定公开链接就填；没有可空",
          "note": "一句话用法",
          "origin": "具体平台名：视频→B站/抖音/YouTube；文档→腾讯文档/飞书/语雀/知乎；网页→站点名如 Python官网；书→微信读书；禁止写「学习资料」",
          "howto_find": "怎么找到：平台+搜索词，如「打开B站，搜索：烧烤 炭火 安全 入门」",
          "content": "学习文档描述：学什么、关键要点、怎么练、练完如何自检（3~8句）"
        }
      ]
    }
  ],
  "marketable": true,
  "market_skill_name": "规范技能名，如 Python入门",
  "reason": "一句理由"
}
硬性规则：
1. 不要排日历/tasks；modules 正好 3~5 个，按学习顺序。
2. 每阶段 skills 2~4 个；learn 必填；estimated_hours 必填且务实：入门阶段 2~6、进阶 5~12、较难 10~20，禁止每个阶段都写 8~10 凑成 30 天。
3. 每条 material 必须给：content、origin、howto_find。origin 必须是具体软件/平台/网站名（视频→B站/抖音/YouTube；文档→腾讯文档/飞书/语雀/知乎专栏；网页→具体站名；书→微信读书等），严禁「学习资料/公开资料/推荐资料」等空话；howto_find 写清打开哪个 App/网站 + 搜索词。
4. total_days：仅当用户原文写了「N天/N周/截止日」才按其周期；用户没写时按难度估（烧烤/简单实操常见 7~14，中等技能 14~28，硬核 30~60），禁止无依据写 30，禁止把「30天」写进 title。
5. skill_overview、skill_scenarios 必填；场景 2~4 条。
6. baseline / skills_context 只用于同领域入门 skippable 或补现状，不得改写目标领域。
7. 只做技能学习拆解；若发现是规划/旅行/办事/闲聊等非学习技能，不要编造 modules，只输出：
   {"accepted": false, "reject_reason": "当前仅支持学习技能类目标，不支持规划类，请改成「我想学……」"}
8. marketable：普遍可复用技能为 true；过私/一次性为 false；true 时必须给 market_skill_name。
9. 合法学习目标可不写 accepted，或 accepted=true。"""
    skills = state.get("skills_context") or []
    hints = state.get("catalog_hints") or []
    raw = state.get("raw_text") or ""
    user = json.dumps(
        {
            "raw_text": raw,
            "baseline": state.get("baseline") or "",
            "daily_minutes": state.get("daily_minutes") or 60,
            "today": state["today"],
            "intent": "learning_skill",
            "skills_context": [
                {
                    "skill_name": s.get("skill_name"),
                    "level": s.get("level"),
                    "level_label": s.get("level_label"),
                }
                for s in skills[:6]
                if isinstance(s, dict)
            ],
            "catalog_hints": [
                {"title": h.get("title"), "type": h.get("type"), "url": h.get("url") or ""}
                for h in hints[:6]
                if isinstance(h, dict)
            ],
        },
        ensure_ascii=False,
    )
    data, meta = await chat_json(
        system,
        user,
        purpose="plan_modules",
        max_tokens=4096,
        temperature=0.2,
        on_progress=state.get("on_progress"),
    )

    reject = is_llm_rejected(data)
    if reject:
        # ValueError → 前端提示；勿用 LLMError（会落入本地模板误生成）
        raise ValueError(reject or REJECT_MSG)

    try:
        llm_days = int(data.get("total_days") or 0)
    except (TypeError, ValueError):
        llm_days = 0
    user_days = parse_user_duration_days(raw)
    daily_minutes = int(state.get("daily_minutes") or data.get("daily_minutes") or 60)

    extracted = {
        "intent": "create_goal",
        "title": data.get("title") or "未命名目标",
        "description": data.get("description") or state.get("raw_text") or "",
        "goal_type": (data.get("goal_type") or "generic").strip() or "generic",
        "baseline": data.get("baseline") or state.get("baseline") or "",
        "daily_minutes": daily_minutes,
        "total_days": max(1, llm_days or 21),
        "start_date": data.get("start_date") or state["today"],
        "deadline": data.get("deadline") or "",
        "completion_criteria": data.get("completion_criteria") or "",
        "missing_fields": data.get("missing_fields") or [],
    }
    if state.get("baseline") and not extracted.get("baseline"):
        extracted["baseline"] = state["baseline"]
    if (not extracted.get("baseline") or extracted["baseline"] in ("未说明", "")) and skills:
        extracted["baseline"] = "；".join(
            f"{s.get('skill_name')}·{s.get('level_label') or s.get('level')}" for s in skills[:8]
        )
    if state.get("daily_minutes"):
        extracted["daily_minutes"] = int(state["daily_minutes"])
        daily_minutes = extracted["daily_minutes"]
    extracted.setdefault("start_date", state["today"])

    feasibility = {
        "feasible": True,
        "score": 0.85,
        "summary": data.get("reason") or "已拆出学习模块，待勾选后排期",
        "risks": [],
        "suggestions": [],
    }
    warnings = list(state.get("warnings") or [])

    cats = [str(c).strip() for c in (data.get("skill_categories") or []) if str(c).strip()][:5]
    modules = normalize_modules(data.get("modules"), skill_categories=cats)
    if not modules:
        raise LLMError("plan_modules returned empty modules")
    if not cats:
        cats = list({m["category"] for m in modules if m.get("category")}) or ["综合"]

    # 周期：用户明示优先；否则一律按模块难度+课时估算（不信任 LLM 的 30 天）
    if user_days is not None and user_days > 0:
        extracted["total_days"] = user_days
        extracted["deadline"] = _add_days(extracted["start_date"], user_days)
    elif user_days == -1:
        # 用户给了绝对日期，保留 LLM deadline；缺省时再估
        if not extracted.get("deadline"):
            estimated = estimate_module_days(modules, daily_minutes=daily_minutes)
            extracted["total_days"] = estimated
            extracted["deadline"] = _add_days(extracted["start_date"], estimated)
        else:
            try:
                d0 = datetime.strptime(extracted["start_date"], "%Y-%m-%d")
                d1 = datetime.strptime(extracted["deadline"][:10], "%Y-%m-%d")
                extracted["total_days"] = max(1, (d1 - d0).days)
            except ValueError:
                pass
    else:
        estimated = estimate_module_days(modules, daily_minutes=daily_minutes)
        extracted["total_days"] = estimated
        extracted["deadline"] = _add_days(extracted["start_date"], estimated)
    # 标题不承载周期；「烧烤入门30天」→「烧烤入门」
    extracted["title"] = strip_duration_from_title(str(extracted.get("title") or "")) or str(
        extracted.get("title") or "未命名目标"
    )
    if not extracted.get("deadline"):
        extracted["deadline"] = _add_days(
            extracted["start_date"], max(int(extracted.get("total_days") or 14), 1)
        )

    overview = (data.get("skill_overview") or data.get("overview") or "").strip()
    scenarios = data.get("skill_scenarios") or data.get("scenarios") or []
    if isinstance(scenarios, str):
        scenarios = [s.strip() for s in scenarios.replace("；", "\n").split("\n") if s.strip()]
    scenarios = [str(s).strip() for s in scenarios if str(s).strip()][:6]
    if not overview:
        overview = feasibility.get("summary") or f"围绕「{extracted.get('title')}」建立可执行学习路径。"
    if not scenarios:
        scenarios = ["工作中解决实际问题", "面试或作品展示", "持续自学进阶"]

    # 阶段缺材料时，用目录提示补一条
    hint_pool = [h for h in (state.get("catalog_hints") or []) if isinstance(h, dict)]
    for i, m in enumerate(modules):
        if m.get("materials"):
            continue
        if hint_pool:
            h = hint_pool[i % len(hint_pool)]
            m["materials"] = _normalize_materials(
                [
                    {
                        "title": h.get("title"),
                        "type": h.get("type") or "doc",
                        "url": h.get("url") or "",
                        "note": h.get("note") or "",
                        "content": h.get("content") or h.get("note") or "",
                        "origin": h.get("origin") or "",
                        "howto_find": h.get("howto_find") or "",
                    }
                ]
            )

    marketable = data.get("marketable")
    if isinstance(marketable, str):
        marketable = marketable.strip().lower() in {"1", "true", "yes", "y"}
    elif marketable is None:
        marketable = None
    else:
        marketable = bool(marketable)
    market_skill_name = (data.get("market_skill_name") or extracted.get("title") or "").strip()[:64]

    return {
        "extracted": extracted,
        "feasibility": feasibility,
        "modules_draft": {
            "skill_categories": cats,
            "skill_overview": overview,
            "skill_scenarios": scenarios,
            "modules": modules,
            "marketable": marketable,
            "market_skill_name": market_skill_name,
            "reason": data.get("reason") or feasibility.get("summary") or "模块草案",
        },
        "recommended_resources": [],
        "learning_path": {},
        "warnings": warnings,
        "usage": _merge_usage(state, meta),
        "trace": _append_trace(
            state,
            "plan_modules",
            f"{extracted.get('title')} · {len(cats)} cats · {len(modules)} modules",
        ),
    }


def build_modules_graph():
    graph = StateGraph(PlanGraphState)
    graph.add_node("modules", node_modules)
    graph.add_edge(START, "modules")
    graph.add_edge("modules", END)
    return graph.compile()


_MODULES_GRAPH = None


def get_modules_graph():
    global _MODULES_GRAPH
    if _MODULES_GRAPH is None:
        _MODULES_GRAPH = build_modules_graph()
    return _MODULES_GRAPH


def reset_plan_graph() -> None:
    global _MODULES_GRAPH
    _MODULES_GRAPH = None


async def run_plan_graph(
    *,
    raw_text: str,
    baseline: str = "",
    daily_minutes: int = 60,
    today: str,
    skills_context: list | None = None,
    catalog_hints: list | None = None,
    path_hint: dict | None = None,
    on_progress=None,
) -> tuple[dict, dict]:
    """草案：返回模块规划（无日历）。失败抛 LLMError。"""
    app = get_modules_graph()
    init: PlanGraphState = {
        "raw_text": raw_text,
        "baseline": baseline,
        "daily_minutes": daily_minutes,
        "today": today,
        "skills_context": skills_context or [],
        "catalog_hints": catalog_hints or [],
        "path_hint": path_hint or {},
        "on_progress": on_progress,
        "warnings": [],
        "usage": [],
        "trace": [],
    }
    try:
        final: PlanGraphState = await app.ainvoke(init)
    except ValueError:
        raise
    except Exception as exc:  # noqa: BLE001
        # LangGraph 可能把节点 ValueError 包一层
        root = exc
        while root.__cause__ is not None and root is not root.__cause__:
            root = root.__cause__
            if isinstance(root, ValueError):
                raise root from exc
        msg = str(exc)
        if "不像学习目标" in msg or "accepted" in msg.lower():
            raise ValueError(msg or REJECT_MSG) from exc
        raise LLMError(str(exc)) from exc

    draft = final.get("modules_draft") or {}
    modules = draft.get("modules") or []
    if not modules:
        raise LLMError(final.get("error") or "langgraph produced empty modules")

    extracted = final.get("extracted") or {}
    plan = {
        "goal": {
            "title": extracted.get("title") or "未命名目标",
            "description": extracted.get("description") or raw_text,
            "goal_type": extracted.get("goal_type") or "generic",
            "baseline": extracted.get("baseline") or baseline or "未说明",
            "daily_minutes": int(extracted.get("daily_minutes") or daily_minutes),
            "start_date": extracted.get("start_date") or today,
            "deadline": extracted.get("deadline") or "",
            "completion_criteria": extracted.get("completion_criteria")
            or "按所选模块完成学习并达到自定标准",
        },
        "skill_categories": draft.get("skill_categories") or [],
        "skill_overview": draft.get("skill_overview") or "",
        "skill_scenarios": draft.get("skill_scenarios") or [],
        "modules": modules,
        "marketable": draft.get("marketable"),
        "market_skill_name": draft.get("market_skill_name") or "",
        "stages": [],  # 确认前不写阶段任务
        "recommended_resources": final.get("recommended_resources") or [],
        "learning_path": final.get("learning_path") or {},
        "analysis": {
            "reason": draft.get("reason")
            or (final.get("feasibility") or {}).get("summary")
            or "已拆出学习模块，确认后写入日程",
            "warnings": final.get("warnings") or [],
            "source": "langgraph",
            "feasibility": final.get("feasibility") or {},
            "trace": final.get("trace") or [],
            "phase": "modules",
        },
    }
    usage_list = final.get("usage") or []
    meta = {
        "model": (usage_list[-1].get("model") if usage_list else ""),
        "purpose": "plan_modules",
        "prompt_tokens": sum(int(u.get("prompt_tokens") or 0) for u in usage_list),
        "completion_tokens": sum(int(u.get("completion_tokens") or 0) for u in usage_list),
        "tokens_accurate": bool(usage_list)
        and all(bool(u.get("tokens_accurate")) for u in usage_list),
        "steps": [t.get("step") for t in (final.get("trace") or [])],
    }
    return plan, meta


def day_capacity(
    date_str: str,
    *,
    weekday_minutes: int = 60,
    weekend_minutes: int | None = None,
    fallback: int = 60,
) -> int:
    """按工作日/周末返回当日可用分钟。"""
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return max(10, int(fallback or 60))
    wd = max(10, int(weekday_minutes or fallback or 60))
    we = max(10, int(weekend_minutes if weekend_minutes is not None else wd))
    return we if d.weekday() >= 5 else wd


def schedule_stages(
    *,
    stages: list[dict],
    daily_minutes: int,
    start_date: str,
    deadline: str | None = None,
    total_days: int = 14,
    occupied: dict[str, int] | None = None,
    weekend_minutes: int | None = None,
) -> tuple[list[dict], str, list[str]]:
    """确定性排期：把任务铺到日历。返回 (stages, deadline, warnings)。

    occupied: 其他目标已占用的「日期 → 分钟」，保证跨目标不超过每日可用时间。
    weekend_minutes: 若提供，周末用该值，工作日用 daily_minutes。
    """
    daily = max(10, int(daily_minutes or 60))
    we = max(10, int(weekend_minutes if weekend_minutes is not None else daily))
    start = start_date
    dl = (deadline or "").strip() or None
    # 截止日为空或与起日相同 → 按任务量与传入 total_days 拉窗口（默认 14，不再 30）
    if not dl or dl <= start:
        n_tasks = sum(len(st.get("tasks") or []) for st in (stages or []))
        horizon = max(int(total_days or 14), max(5, n_tasks), 7)
        dl = _add_days(start, horizon)
    warnings: list[str] = []
    stages_out = []
    day_offset = 0
    # 当天已用 = 其他目标占用 + 本目标本轮已排
    occ = {k: int(v) for k, v in (occupied or {}).items()}
    global_order = 0

    def _cap(date_str: str) -> int:
        return day_capacity(
            date_str,
            weekday_minutes=daily,
            weekend_minutes=we,
            fallback=daily,
        )

    def _used(date_str: str) -> int:
        return int(occ.get(date_str) or 0)

    for si, stage in enumerate(stages or []):
        tasks_out = []
        for ti, task in enumerate((stage.get("tasks") or [])[:5]):
            # 单任务不超过工作日上限，避免工作日被周末额度撑破
            mins_raw = int(task.get("estimated_minutes") or daily)
            mins = max(10, min(mins_raw, daily))
            # 找到装得下的一天（硬约束：used + mins <= cap）
            guard = 0
            planned = start
            placed = False
            while guard < 800:
                planned = _add_days(start, day_offset)
                cap = _cap(planned)
                used = _used(planned)
                if used >= cap:
                    day_offset += 1
                    guard += 1
                    continue
                room = cap - used
                task_mins = max(10, min(mins, room, cap))
                if task_mins <= room:
                    mins = task_mins
                    placed = True
                    break
                day_offset += 1
                guard += 1
            if not placed:
                planned = _add_days(start, day_offset)
                cap = _cap(planned)
                room = max(10, cap - _used(planned))
                mins = max(10, min(mins, room, cap))

            if planned > dl:
                # 延长截止日继续铺，而不是全部压回最后一天
                if "任务量超过原截止日，已自动顺延。" not in warnings:
                    warnings.append("任务量超过原截止日，已自动顺延。")
                dl = planned
            resources = task.get("resources") or []
            desc = task.get("description") or ""
            if resources and "资源" not in desc:
                tips = "；".join(
                    f"{r.get('title') or ''}({r.get('type') or 'doc'})"
                    for r in resources[:1]
                    if isinstance(r, dict)
                )
                if tips:
                    desc = f"{desc}｜推荐：{tips}" if desc else f"推荐：{tips}"
            tasks_out.append(
                {
                    "name": task.get("name") or f"任务{ti+1}",
                    "description": desc,
                    "done_when": (task.get("done_when") or "")[:120],
                    "estimated_minutes": mins,
                    "priority": task.get("priority") or ("high" if global_order == 0 else "normal"),
                    "planned_date": planned,
                    "sort_order": int(
                        task.get("sort_order") if task.get("sort_order") is not None else global_order
                    ),
                    "related_skills": task.get("related_skills") or [],
                    "depends_on_names": task.get("depends_on_names") or [],
                    "resources": resources[:1],
                }
            )
            occ[planned] = _used(planned) + mins
            global_order += 1
            if _used(planned) >= _cap(planned):
                day_offset = max(day_offset, 0)
                # 推进到下一天，避免下一任务重复扫描
                next_day = _add_days(planned, 1)
                # day_offset 相对 start
                try:
                    day_offset = (
                        datetime.strptime(next_day, "%Y-%m-%d")
                        - datetime.strptime(start, "%Y-%m-%d")
                    ).days
                except ValueError:
                    day_offset += 1
        stages_out.append(
            {
                "name": stage.get("name") or f"阶段{si+1}",
                "sort_order": int(stage.get("sort_order") if stage.get("sort_order") is not None else si),
                "skippable": bool(stage.get("skippable")),
                "skip_reason": stage.get("skip_reason") or "",
                "module_key": stage.get("module_key") or "",
                "tasks": tasks_out,
            }
        )
    return stages_out, dl, warnings


async def expand_selected_modules(
    *,
    goal_title: str,
    goal_description: str,
    baseline: str,
    daily_minutes: int,
    start_date: str,
    deadline: str,
    selected_modules: list[dict],
    catalog_hints: list | None = None,
    occupied: dict[str, int] | None = None,
    weekend_minutes: int | None = None,
    skills_context: list | None = None,
    on_progress=None,
) -> tuple[dict, dict]:
    """确认后：把勾选模块展开为可执行任务并排期。"""
    from .task_expand_quality import (
        EXPAND_RETRY_HINT,
        EXPAND_SYSTEM,
        build_fallback_stages,
        build_upcoming_preview,
        sanitize_stages,
        stages_quality_report,
    )

    daily = max(15, int(daily_minutes or 60))
    user_payload = {
        "goal_title": goal_title,
        "goal_description": goal_description,
        "baseline": baseline,
        "daily_minutes": daily,
        "start_date": start_date,
        "deadline": deadline,
        "modules": selected_modules,
        "catalog_hints": (catalog_hints or [])[:6],
        "skills_context": [
            {
                "skill_name": s.get("skill_name"),
                "level": s.get("level"),
                "level_label": s.get("level_label"),
            }
            for s in (skills_context or [])[:6]
            if isinstance(s, dict)
        ],
        "guidance": "已会的技能不要再拆入门空壳任务；优先最小可动手实验。",
    }

    data: dict = {}
    meta: dict = {
        "model": "",
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "tokens_accurate": False,
        "purpose": "plan_expand",
    }
    raw_stages: list = []
    quality_notes: list[str] = []

    try:
        data, meta = await chat_json(
            EXPAND_SYSTEM,
            json.dumps(user_payload, ensure_ascii=False),
            purpose="plan_expand",
            max_tokens=4096,
            temperature=0.2,
            on_progress=on_progress,
        )
        raw_stages = data.get("stages") or []
        report = stages_quality_report(raw_stages, daily_minutes=daily)
        if raw_stages and not report["ok"]:
            quality_notes.append(
                f"首轮可执行率不足(bad={report['bad']}/{report['total']})，重试一次"
            )
            retry_payload = {
                **user_payload,
                "retry_hint": EXPAND_RETRY_HINT,
                "bad_samples": report.get("samples") or [],
            }
            data2, meta2 = await chat_json(
                EXPAND_SYSTEM + "\n" + EXPAND_RETRY_HINT,
                json.dumps(retry_payload, ensure_ascii=False),
                purpose="plan_expand_retry",
                max_tokens=4096,
                temperature=0.15,
                on_progress=on_progress,
            )
            meta = {
                **meta,
                "prompt_tokens": int(meta.get("prompt_tokens") or 0)
                + int(meta2.get("prompt_tokens") or 0),
                "completion_tokens": int(meta.get("completion_tokens") or 0)
                + int(meta2.get("completion_tokens") or 0),
                "retried": True,
            }
            raw_stages = data2.get("stages") or raw_stages
            data = data2
    except LLMError:
        raw_stages = []
        quality_notes.append("llm_failed_use_fallback")

    if not raw_stages:
        raw_stages = build_fallback_stages(selected_modules, daily_minutes=daily)
        data = {"reason": "本地可执行模板展开", "stages": raw_stages}
        quality_notes.append("used_executable_fallback")

    aligned = sanitize_stages(
        raw_stages,
        selected_modules=selected_modules,
        daily_minutes=daily,
    )

    try:
        d0 = datetime.strptime(start_date, "%Y-%m-%d")
        d1 = datetime.strptime((deadline or start_date)[:10], "%Y-%m-%d")
        span_days = max(5, (d1 - d0).days)
    except ValueError:
        span_days = 14
    scheduled, final_deadline, warnings = schedule_stages(
        stages=aligned,
        daily_minutes=daily,
        start_date=start_date,
        deadline=deadline,
        total_days=span_days,
        occupied=occupied,
        weekend_minutes=weekend_minutes,
    )
    # 排期后把 done_when 写回 description 已在 sanitize；补 preview
    warnings = list(warnings or [])
    warnings.extend(quality_notes)
    upcoming = build_upcoming_preview(scheduled, days=3)
    return {
        "stages": scheduled,
        "deadline": final_deadline,
        "reason": data.get("reason") or "按所选模块展开可执行任务",
        "warnings": warnings,
        "upcoming_preview": upcoming,
    }, meta
