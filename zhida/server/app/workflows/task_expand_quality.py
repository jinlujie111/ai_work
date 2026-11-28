"""LLM 任务拆解质量：可执行约束、校验、重写与本地兜底。"""

from __future__ import annotations

import re
from typing import Any

# 任务名仅含这些虚词时视为不合格
_VAGUE_ONLY = re.compile(
    r"^(学习|了解|掌握|复习|提升|熟悉|理解|巩固|研究|看看|读读)[:：\s]*(.+)?$"
)
_VAGUE_START = re.compile(r"^(学习|了解|掌握|复习|提升|熟悉|理解)[:：]")
_HAS_OUTCOME = re.compile(
    r"(完成|写出|跑通|打印|整理|记录|提交|截图|复述|跟读|清洗|实现|做出|练完|"
    r"听完|读完|做完|保存|导出|对比|画|搭建|配置|安装|运行|调试|默写|口述)"
)
_DONE_HINTS = ("完成", "直到", "为止", "看到", "写出", "跑通", "记下", "能")


def default_task_minutes(daily_minutes: int) -> int:
    daily = max(15, int(daily_minutes or 60))
    return max(15, min(25, daily))


def clamp_task_minutes(value: Any, daily_minutes: int) -> int:
    daily = max(15, int(daily_minutes or 60))
    try:
        mins = int(value)
    except (TypeError, ValueError):
        mins = default_task_minutes(daily)
    return max(15, min(mins, daily))


def looks_vague_name(name: str) -> bool:
    text = (name or "").strip()
    if not text:
        return True
    if _VAGUE_ONLY.match(text):
        # 「学习：Pandas 并打印前5行」这类带结果的可放过
        rest = _VAGUE_ONLY.match(text).group(2) or ""
        if rest and _HAS_OUTCOME.search(rest):
            return False
        return True
    if _VAGUE_START.match(text) and not _HAS_OUTCOME.search(text):
        return True
    if len(text) < 4:
        return True
    return False


def has_done_when(task: dict) -> bool:
    done = (task.get("done_when") or "").strip()
    if done:
        return True
    desc = (task.get("description") or "").strip()
    if not desc:
        return False
    return any(h in desc for h in _DONE_HINTS) or bool(_HAS_OUTCOME.search(desc))


def task_quality_issues(task: dict, *, daily_minutes: int) -> list[str]:
    issues: list[str] = []
    name = (task.get("name") or "").strip()
    if looks_vague_name(name):
        issues.append("vague_name")
    if not has_done_when(task):
        issues.append("missing_done_when")
    try:
        mins = int(task.get("estimated_minutes") or 0)
    except (TypeError, ValueError):
        mins = 0
    if mins < 15 or mins > max(15, int(daily_minutes or 60)):
        issues.append("bad_minutes")
    return issues


def stages_quality_report(stages: list[dict], *, daily_minutes: int) -> dict:
    bad = 0
    total = 0
    samples: list[str] = []
    for st in stages or []:
        for t in st.get("tasks") or []:
            if not isinstance(t, dict):
                continue
            total += 1
            issues = task_quality_issues(t, daily_minutes=daily_minutes)
            if issues:
                bad += 1
                if len(samples) < 4:
                    samples.append(f"{t.get('name')}:{'|'.join(issues)}")
    ratio = (bad / total) if total else 1.0
    return {
        "total": total,
        "bad": bad,
        "ratio": ratio,
        "ok": total > 0 and ratio <= 0.34,
        "samples": samples,
    }


def rewrite_executable_task(
    *,
    skill: str,
    learn: str = "",
    daily_minutes: int = 40,
    priority: str = "normal",
    sort_order: int = 0,
    materials: list | None = None,
) -> dict:
    """本地可执行任务模板：禁止「学习：xxx」空壳。"""
    topic = (skill or learn or "本阶段要点").strip()[:40]
    mins = default_task_minutes(daily_minutes)
    done_when = f"完成一次关于「{topic}」的小练习，并写下 1 个卡点"
    name = f"完成「{topic}」小练习并记录卡点"
    desc = (
        f"用不超过 {mins} 分钟动手做：围绕「{topic}」。"
        f"{('参考：' + learn) if learn else ''} "
        f"完成标准：{done_when}。"
    ).strip()
    resources = []
    if materials:
        m0 = materials[0] if isinstance(materials[0], dict) else None
        if m0:
            resources = [m0]
    return {
        "name": name[:80],
        "description": desc[:400],
        "done_when": done_when[:120],
        "estimated_minutes": mins,
        "priority": priority,
        "sort_order": sort_order,
        "related_skills": [topic] if topic else [],
        "depends_on_names": [],
        "resources": resources[:1],
        "effort": "S",
    }


def build_fallback_stages(
    selected_modules: list[dict],
    *,
    daily_minutes: int,
) -> list[dict]:
    raw_stages = []
    for si, m in enumerate(selected_modules or []):
        skills = m.get("skills") or [m.get("learn") or m.get("name")]
        skills = [str(s).strip() for s in skills if str(s).strip()][:3]
        if not skills:
            skills = [m.get("name") or f"模块{si+1}"]
        mats = list(m.get("materials") or [])
        learn = (m.get("learn") or "").strip()
        # 每模块最多 2 个可执行任务，降低首周负担
        tasks = []
        for ti, sk in enumerate(skills[:2]):
            tasks.append(
                rewrite_executable_task(
                    skill=sk,
                    learn=learn,
                    daily_minutes=daily_minutes,
                    priority="high" if si == 0 and ti == 0 else "normal",
                    sort_order=ti,
                    materials=mats,
                )
            )
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
    return raw_stages


def sanitize_task(task: dict, *, daily_minutes: int, learn: str = "", materials: list | None = None) -> dict:
    item = dict(task)
    name = (item.get("name") or "").strip()
    done_when = (item.get("done_when") or "").strip()
    desc = (item.get("description") or "").strip()

    if looks_vague_name(name):
        skill = ""
        rel = item.get("related_skills") or []
        if rel:
            skill = str(rel[0])
        elif name:
            m = _VAGUE_ONLY.match(name)
            skill = (m.group(2) if m else name).strip(" ：:")
        rewritten = rewrite_executable_task(
            skill=skill or learn or "练习",
            learn=learn or desc,
            daily_minutes=daily_minutes,
            priority=(item.get("priority") or "normal"),
            sort_order=int(item.get("sort_order") or 0),
            materials=materials or item.get("resources") or [],
        )
        # 保留模型给的资料
        if item.get("resources"):
            rewritten["resources"] = item.get("resources")[:1]
        return rewritten

    item["name"] = name[:80]
    item["estimated_minutes"] = clamp_task_minutes(item.get("estimated_minutes"), daily_minutes)
    if not done_when:
        # 从描述抽一句，否则补默认
        if desc and _HAS_OUTCOME.search(desc):
            done_when = desc.split("。")[0][:120]
        else:
            done_when = f"按说明完成「{name}」并留下结果记录"
        item["done_when"] = done_when
    else:
        item["done_when"] = done_when[:120]

    if done_when and done_when not in desc:
        item["description"] = f"{desc} 完成标准：{done_when}".strip()[:400]
    elif not desc:
        item["description"] = f"完成标准：{item['done_when']}"[:400]

    pri = (item.get("priority") or "normal").lower()
    if pri not in {"high", "normal", "low"}:
        pri = "normal"
    item["priority"] = pri
    if not item.get("resources") and materials:
        item["resources"] = [materials[0]]
    return item


def sanitize_stages(
    stages: list[dict],
    *,
    selected_modules: list[dict],
    daily_minutes: int,
) -> list[dict]:
    by_key = {m.get("key"): m for m in selected_modules or []}
    out = []
    for si, st in enumerate(stages or []):
        key = st.get("module_key") or (
            selected_modules[si]["key"] if si < len(selected_modules or []) else ""
        )
        mod = by_key.get(key) or (
            selected_modules[si] if si < len(selected_modules or []) else {}
        )
        mats = list(mod.get("materials") or [])
        learn = (mod.get("learn") or "").strip()
        tasks_in = [t for t in (st.get("tasks") or []) if isinstance(t, dict)]
        # 每模块最多 3 个
        tasks_in = tasks_in[:3]
        if not tasks_in:
            tasks_in = [
                rewrite_executable_task(
                    skill=(mod.get("skills") or [mod.get("name") or "练习"])[0],
                    learn=learn,
                    daily_minutes=daily_minutes,
                    priority="high" if si == 0 else "normal",
                    materials=mats,
                )
            ]
        tasks = [
            sanitize_task(t, daily_minutes=daily_minutes, learn=learn, materials=mats)
            for t in tasks_in
        ]
        # 保证至少 1 个 high
        if tasks and not any(t.get("priority") == "high" for t in tasks):
            tasks[0]["priority"] = "high"
        out.append(
            {
                **st,
                "module_key": key,
                "name": st.get("name") or mod.get("name") or f"模块{si+1}",
                "skippable": bool(mod.get("skippable")),
                "skip_reason": mod.get("skip_reason") or "",
                "sort_order": si,
                "tasks": tasks,
            }
        )
    return out


def preview_key(date: str, name: str, idx: int) -> str:
    return f"{date}|{idx}|{(name or '')[:40]}"


def build_upcoming_preview(stages: list[dict], *, days: int = 3) -> list[dict]:
    """从已排期 stages 抽出最近 N 个日期的任务预览。"""
    by_date: dict[str, list[dict]] = {}
    flat_idx = 0
    for st in stages or []:
        stage_name = st.get("name") or ""
        for t in st.get("tasks") or []:
            if not isinstance(t, dict):
                continue
            day = (t.get("planned_date") or "").strip()
            if not day:
                continue
            by_date.setdefault(day, []).append(
                {
                    "key": preview_key(day, t.get("name") or "", flat_idx),
                    "date": day,
                    "name": t.get("name") or "",
                    "estimated_minutes": t.get("estimated_minutes") or 0,
                    "done_when": t.get("done_when") or "",
                    "priority": t.get("priority") or "normal",
                    "stage_name": stage_name,
                    "selected": True,
                }
            )
            flat_idx += 1
    dates = sorted(by_date.keys())[: max(1, days)]
    out: list[dict] = []
    for d in dates:
        out.extend(by_date[d])
    return out


def filter_stages_by_drop_keys(stages: list[dict], drop_keys: list[str] | None) -> list[dict]:
    if not drop_keys:
        return stages
    drop = set(drop_keys)
    flat_idx = 0
    out = []
    for st in stages or []:
        kept = []
        for t in st.get("tasks") or []:
            if not isinstance(t, dict):
                continue
            key = preview_key(t.get("planned_date") or "", t.get("name") or "", flat_idx)
            flat_idx += 1
            if key in drop:
                continue
            kept.append(t)
        if kept:
            out.append({**st, "tasks": kept})
    return out


EXPAND_SYSTEM = """你是学习任务拆解器。目标是让用户「今天就能动手并完成」，不是写完美大纲。只输出 JSON：
{
  "stages": [
    {
      "module_key": "与输入一致的 key",
      "name": "阶段名（可用模块名）",
      "sort_order": 0,
      "tasks": [
        {
          "name": "动词+具体对象+可验证结果",
          "description": "怎么做；可写用哪份资料",
          "done_when": "一句话完成标准（可自检）",
          "estimated_minutes": 25,
          "priority": "high|normal|low",
          "sort_order": 0,
          "related_skills": ["技能点"],
          "depends_on_names": [],
          "resources": [{"title": "资料名", "type": "doc|course|book|video|practice|tool|repo", "note": "", "url": ""}],
          "effort": "S"
        }
      ]
    }
  ],
  "reason": "拆任务理由"
}
硬性规则：
1. 只为给定 modules 生成 stages，顺序与输入一致；module_key 必须原样回传。
2. 每模块 1~3 个任务（优先 2 个）：1 个 high 主路径 + 0~2 个 normal；low 可省略。
3. 单任务时长必须在 15~daily_minutes 之间；默认 min(25, daily_minutes)，不要默认拉满整天。
4. 不要排日期（系统会排）。尽量带 1 条 resources；可复用模块 materials。
5. 任务名必须是「动词 + 具体对象 + 可验证结果」。禁止单独使用或仅以这些词开头且无结果：
   学习 / 了解 / 掌握 / 复习 / 提升 / 熟悉 / 理解。
6. 每条必须有 done_when（完成标准）。description 说明怎么做。
7. 每个模块的第一个任务必须是「今天就能动手」的最小实验，不要先堆纯概念阅读。
8. 坏例子：学习 Pandas；了解神经网络；掌握英语听力。
9. 好例子：用 Pandas 读取 csv 并打印前 5 行；精听 1 篇短文并写下 5 个生词；跑通示例脚本并保存运行截图。
"""


EXPAND_RETRY_HINT = (
    "上次输出含不可执行任务（名称过虚或缺少完成标准）。"
    "请重写：每条任务必须带可验证结果与 done_when，禁止「学习/了解/掌握」空壳标题。"
)
