from __future__ import annotations

from datetime import datetime, timedelta


def today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def add_days(date_str: str, n: int) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=n)
    return d.strftime("%Y-%m-%d")


TEMPLATES = {
    "ai": [
        ("AI 概念入门", ["监督/无监督学习", "训练与推理", "过拟合直觉"]),
        ("Python 数据基础", ["NumPy 够用即可", "Pandas 读写表", "小数据清洗"]),
        ("神经网络直觉", ["损失与梯度", "反向传播概念", "简单 MLP 跑通"]),
        ("大模型与工具", ["Transformer 直觉", "提示工程练习", "Hugging Face 试用"]),
        ("小项目交付", ["选定小任务", "用开源模型完成", "写下复盘"]),
    ],
    "python": [
        ("Python 基础", ["变量与数据类型", "条件与循环", "函数与模块", "完成基础练习"]),
        ("数据处理", ["NumPy 基础", "Pandas 读写", "数据清洗练习"]),
        ("分析与可视化", ["基础统计", "matplotlib 可视化", "完成小案例"]),
        ("项目实践", ["选定数据集", "清洗并分析", "输出可视化报告"]),
    ],
    "english": [
        ("输入积累", ["每日听力 20 分钟", "精读一篇短文", "整理生词本"]),
        ("输出练习", ["跟读练习", "写 80 词短段落", "口语自述 3 分钟"]),
        ("阶段检验", ["模考听力", "模考阅读", "复盘错题"]),
    ],
    "fitness": [
        ("启动适应", ["评估体能", "制定训练日", "完成 2 次低强度有氧"]),
        ("习惯巩固", ["力量训练入门", "拉伸与恢复", "记录饮食睡眠"]),
        ("强度提升", ["增加力量组", "中等强度有氧", "周复盘"]),
    ],
    "generic": [
        ("摸清现状", ["写下完成标准", "盘点已有基础", "列出可用时间"]),
        ("建立节奏", ["本周最小行动", "完成第一次练习", "记录卡点"]),
        ("推进交付", ["完成可展示结果", "自检或反馈", "调整下周计划"]),
    ],
}


def detect_template(text: str) -> str:
    """与 resources_catalog.infer_goal_type 对齐，避免「学 AI」掉进 generic。"""
    from ..resources_catalog import infer_goal_type

    key = infer_goal_type(text)
    return key if key in TEMPLATES else "generic"


CATEGORY_LABEL = {
    "python": "编程",
    "english": "英语",
    "fitness": "健身",
    "generic": "综合",
    "ai": "AI",
}


def build_plan_fallback(
    *,
    raw_text: str,
    baseline: str = "",
    daily_minutes: int = 60,
    total_days: int = 60,
) -> dict:
    """草案兜底：只出技能分类与模块，不写任务/日历。"""
    key = detect_template(raw_text)
    start = today_str()
    deadline = add_days(start, total_days)
    title = (raw_text.split("，")[0].split(",")[0].split("\n")[0] or "未命名目标")[:24]
    cat = CATEGORY_LABEL.get(key, "综合")
    modules = []
    for si, (stage_name, task_names) in enumerate(TEMPLATES[key]):
        modules.append(
            {
                "key": f"m{si+1}",
                "name": stage_name,
                "category": cat,
                "skills": list(task_names)[:6],
                "learn": f"完成本阶段：{'、'.join(task_names[:3])}",
                "difficulty": "easy" if si == 0 else ("hard" if si == len(TEMPLATES[key]) - 1 else "medium"),
                "difficulty_label": "入门" if si == 0 else ("较难" if si == len(TEMPLATES[key]) - 1 else "进阶"),
                "estimated_hours": max(4, len(task_names) * 2),
                "skippable": False,
                "skip_reason": "",
                "materials": [
                    {
                        "title": f"{stage_name}练习清单",
                        "type": "practice",
                        "url": "",
                        "note": "按技能点逐项完成并记录",
                    }
                ],
            }
        )

    return {
        "goal": {
            "title": title,
            "description": raw_text,
            "goal_type": key,
            "baseline": baseline or "未说明",
            "daily_minutes": daily_minutes,
            "start_date": start,
            "deadline": deadline,
            "completion_criteria": "按所选模块完成学习并达到自定标准",
        },
        "skill_categories": [cat],
        "skill_overview": f"「{title}」将按阶段推进：先建立基础，再形成可复用能力，最后完成可展示结果。",
        "skill_scenarios": [
            "工作中解决实际问题",
            "面试或作品展示",
            "持续自学与复盘",
        ],
        "modules": modules,
        "stages": [],
        "analysis": {
            "reason": f"本地兜底模板「{key}」：{len(modules)} 个学习模块（确认后再排期）",
            "warnings": [],
            "source": "fallback",
            "phase": "modules",
        },
    }


def build_replan_fallback(
    *,
    tasks: list[dict],
    unfinished_ids: list[int],
    deadline: str,
    reason: str,
) -> dict:
    start = today_str()
    moved = []
    next_tasks = []
    for idx, t in enumerate(tasks):
        item = dict(t)
        if item["id"] in unfinished_ids and item.get("status") != "done":
            item["planned_date"] = add_days(start, 1 + unfinished_ids.index(item["id"]))
            if int(item.get("estimated_minutes") or 30) > 45:
                item["estimated_minutes"] = max(20, int(item["estimated_minutes"]) // 2)
                item["description"] = (item.get("description") or "") + "（已拆半）"
            moved.append(
                {
                    "id": item["id"],
                    "name": item["name"],
                    "from": t.get("planned_date"),
                    "to": item["planned_date"],
                }
            )
        elif item.get("status") not in ("done", "cancelled") and item.get("planned_date", "") < start:
            item["planned_date"] = add_days(start, 1)
            moved.append(
                {
                    "id": item["id"],
                    "name": item["name"],
                    "from": t.get("planned_date"),
                    "to": item["planned_date"],
                }
            )
        next_tasks.append(item)
    return {
        "tasks": next_tasks,
        "analysis": {
            "reason": reason,
            "summary": f"未完成任务已后移并控制单日负担；截止日仍为 {deadline}。",
            "moved": moved,
            "source": "fallback",
        },
    }
