from __future__ import annotations

import pytest


@pytest.fixture()
def force_llm_fallback(monkeypatch):
    from app.llm import LLMError

    async def _boom(*_a, **_k):
        raise LLMError("forced for test")

    monkeypatch.setattr("app.workflows.plan_graph.chat_json", _boom)
    monkeypatch.setattr("app.workflows.replan.chat_json", _boom)
    # expand 也走 chat_json
    monkeypatch.setattr("app.llm.chat_json", _boom)


def test_plan_draft_fallback(client, auth_header, force_llm_fallback):
    resp = client.post(
        "/api/goals/plan-draft",
        headers=auth_header,
        json={"raw_text": "我想在30天学会Python基础", "baseline": "零基础", "daily_minutes": 60},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["goal"]["id"] > 0
    assert body["goal"]["status"] == "planning"
    modules = body.get("modules") or body["goal"].get("modules") or []
    assert len(modules) >= 1


def test_confirm_then_today(client, auth_header, force_llm_fallback):
    draft = client.post(
        "/api/goals/plan-draft",
        headers=auth_header,
        json={"raw_text": "两周入门英语听力", "baseline": "初级", "daily_minutes": 45},
    )
    assert draft.status_code == 200, draft.text
    goal_id = draft.json()["goal"]["id"]
    modules = draft.json().get("modules") or []
    keys = [m["key"] for m in modules if m.get("key")][:2]
    assert keys, "fallback should yield module keys"

    confirm = client.post(
        f"/api/goals/{goal_id}/confirm",
        headers=auth_header,
        json={"confirm": True, "selected_module_keys": keys},
    )
    assert confirm.status_code == 200, confirm.text
    assert confirm.json().get("status") == "active" or confirm.json().get("goal", {}).get("status") == "active"

    today = client.get("/api/tasks/today", headers=auth_header)
    assert today.status_code == 200, today.text
    # 确认后可能任务在今天或后续日期；至少接口可用且结构正确
    body = today.json()
    assert "items" in body
    assert "total_count" in body


def test_replan_apply_rejects_invalid_task_id(client, auth_header, force_llm_fallback):
    draft = client.post(
        "/api/goals/plan-draft",
        headers=auth_header,
        json={"raw_text": "健身入门四周边", "baseline": "新手", "daily_minutes": 40},
    )
    assert draft.status_code == 200, draft.text
    goal_id = draft.json()["goal"]["id"]
    modules = draft.json().get("modules") or []
    keys = [m["key"] for m in modules if m.get("key")][:1]
    confirm = client.post(
        f"/api/goals/{goal_id}/confirm",
        headers=auth_header,
        json={"confirm": True, "selected_module_keys": keys},
    )
    assert confirm.status_code == 200, confirm.text

    detail = client.get(f"/api/goals/{goal_id}", headers=auth_header)
    assert detail.status_code == 200
    tasks = []
    for stage in detail.json().get("stages") or []:
        tasks.extend(stage.get("tasks") or [])
    assert tasks, "confirmed goal should have tasks"
    real_id = tasks[0]["id"]

    bad = client.post(
        "/api/plans/replan-apply",
        headers=auth_header,
        json={
            "goal_id": goal_id,
            "reason": "测试非法 id",
            "unfinished_task_ids": [real_id],
            "tasks": [
                {"id": real_id, "planned_date": tasks[0].get("planned_date"), "status": "todo"},
                {"id": 99999999, "planned_date": tasks[0].get("planned_date"), "status": "todo"},
            ],
        },
    )
    assert bad.status_code == 400, bad.text
