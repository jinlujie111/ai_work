from app.workflows.task_expand_quality import (
    build_fallback_stages,
    build_upcoming_preview,
    filter_stages_by_drop_keys,
    looks_vague_name,
    rewrite_executable_task,
    sanitize_task,
    stages_quality_report,
)


def test_vague_names():
    assert looks_vague_name("学习 Pandas")
    assert looks_vague_name("了解神经网络")
    assert looks_vague_name("掌握英语听力")
    assert not looks_vague_name("用 Pandas 读取 csv 并打印前 5 行")
    assert not looks_vague_name("精听 1 篇并写下 5 个生词")


def test_sanitize_rewrites_vague():
    out = sanitize_task(
        {"name": "学习：Pandas", "estimated_minutes": 120, "priority": "normal"},
        daily_minutes=40,
        learn="数据处理",
    )
    assert not looks_vague_name(out["name"])
    assert out["estimated_minutes"] <= 40
    assert out["estimated_minutes"] >= 15
    assert out.get("done_when")


def test_fallback_not_learn_prefix():
    stages = build_fallback_stages(
        [
            {
                "key": "m1",
                "name": "基础",
                "skills": ["变量", "函数"],
                "learn": "写小脚本",
                "materials": [],
            }
        ],
        daily_minutes=40,
    )
    names = [t["name"] for t in stages[0]["tasks"]]
    assert names
    assert all(not n.startswith("学习：") for n in names)
    assert all(t.get("done_when") for t in stages[0]["tasks"])


def test_quality_report_and_preview_filter():
    bad_stages = [
        {
            "tasks": [
                {"name": "学习 A", "estimated_minutes": 30},
                {"name": "学习 B", "estimated_minutes": 30},
                {"name": "完成练习并记录", "done_when": "写下卡点", "estimated_minutes": 25},
            ]
        }
    ]
    report = stages_quality_report(bad_stages, daily_minutes=40)
    assert report["bad"] >= 2
    assert report["ok"] is False

    good = rewrite_executable_task(skill="Pandas", daily_minutes=40)
    scheduled = [
        {
            "name": "阶段1",
            "tasks": [
                {**good, "planned_date": "2026-11-27", "name": "任务甲"},
                {**good, "planned_date": "2026-11-27", "name": "任务乙"},
                {**good, "planned_date": "2026-11-28", "name": "任务丙"},
            ],
        }
    ]
    preview = build_upcoming_preview(scheduled, days=3)
    assert len(preview) == 3
    drop = [preview[0]["key"]]
    filtered = filter_stages_by_drop_keys(scheduled, drop)
    left = sum(len(st["tasks"]) for st in filtered)
    assert left == 2
