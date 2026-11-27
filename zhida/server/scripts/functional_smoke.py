"""端到端功能冒烟（打真实本地 API）。用法: python scripts/functional_smoke.py [base]"""

from __future__ import annotations

import json
import sys
import traceback
import urllib.error
import urllib.request
import uuid
from typing import Any

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8002").rstrip("/")
TIMEOUT = 180


class Fail(Exception):
    pass


def req(method: str, path: str, data: Any = None, token: str | None = None) -> Any:
    body = None if data is None else json.dumps(data, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return None
            if resp.headers.get_content_type() == "text/calendar":
                return raw
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return raw
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise Fail(f"{method} {path} -> HTTP {e.code}: {detail[:400]}") from e
    except Exception as e:
        raise Fail(f"{method} {path} -> {e}") from e


def expect(cond: bool, msg: str) -> None:
    if not cond:
        raise Fail(msg)


results: list[tuple[str, str, str]] = []


def case(name: str, fn) -> None:
    try:
        detail = fn() or "ok"
        results.append((name, "PASS", str(detail)))
        print(f"[PASS] {name}: {detail}")
    except Exception as e:
        results.append((name, "FAIL", str(e)))
        print(f"[FAIL] {name}: {e}")
        if not isinstance(e, Fail):
            traceback.print_exc()


def main() -> int:
    device = f"ft_{uuid.uuid4().hex[:12]}"
    state: dict[str, Any] = {}

    def health():
        h = req("GET", "/health")
        expect(h.get("ok") is True, f"health={h}")
        expect(h.get("service") == "zhida", "service")
        return f"app_env={h.get('app_env')}"

    def auth_mode():
        m = req("GET", "/api/auth/mode")
        expect(m.get("dev_login_enabled") is True, f"dev login off: {m}")
        return f"dev_login={m.get('dev_login_enabled')} activate={m.get('dev_activate_enabled')}"

    def login():
        out = req("POST", "/api/auth/dev-login", {"device_id": device, "nickname": "功能测试"})
        expect(out.get("token"), "no token")
        state["token"] = out["token"]
        state["user_id"] = out["user_id"]
        return f"user_id={out['user_id']}"

    def me():
        out = req("GET", "/api/me", token=state["token"])
        expect(out.get("id") == state["user_id"], "me id mismatch")
        return f"membership={out.get('membership')} quota={out.get('goal_quota')}"

    def activate_member():
        out = req("POST", "/api/me/membership/activate", {"plan": "month"}, state["token"])
        expect(out.get("ok") is True, str(out))
        me = req("GET", "/api/me", token=state["token"])
        expect(me.get("is_member") is True, f"not member: {me}")
        return f"plan={out.get('membership')}"

    def plan_draft():
        out = req(
            "POST",
            "/api/goals/plan-draft",
            {
                "raw_text": "14天入门Python脚本，每天40分钟，能写小工具",
                "baseline": "零基础",
                "daily_minutes": 40,
            },
            state["token"],
        )
        expect(out.get("goal", {}).get("id"), "no goal")
        expect(out.get("goal", {}).get("status") == "planning", "status not planning")
        modules = out.get("modules") or []
        expect(len(modules) >= 1, "no modules")
        expect(len(out.get("stages") or []) == 0, "draft should not materialize stages")
        state["goal_id"] = out["goal"]["id"]
        state["modules"] = modules
        state["keys"] = [m["key"] for m in modules if m.get("key")][:2]
        expect(state["keys"], "no module keys")
        return f"goal={state['goal_id']} source={out.get('analysis', {}).get('source')} modules={len(modules)}"

    def confirm():
        out = req(
            "POST",
            f"/api/goals/{state['goal_id']}/confirm",
            {"confirm": True, "selected_module_keys": state["keys"]},
            state["token"],
        )
        expect(out.get("status") == "active" or out.get("ok") is True, str(out))
        detail = req("GET", f"/api/goals/{state['goal_id']}", token=state["token"])
        expect(detail["goal"]["status"] == "active", "goal not active")
        tasks = []
        for st in detail.get("stages") or []:
            tasks.extend(st.get("tasks") or [])
        expect(len(tasks) >= 1, "no tasks after confirm")
        state["tasks"] = tasks
        state["task_id"] = tasks[0]["id"]
        return f"stages={len(detail.get('stages') or [])} tasks={len(tasks)} kept={out.get('kept_tasks')}"

    def today_and_complete():
        today = req("GET", "/api/tasks/today", token=state["token"])
        expect("items" in today, str(today))
        # 可能不在今天；若今日有任务则完成一条，否则改日期后再完成
        items = today.get("items") or []
        tid = None
        if items:
            tid = items[0]["id"]
        else:
            # 把首个任务改到今天
            from datetime import date

            day = date.today().isoformat()
            req(
                "POST",
                f"/api/tasks/{state['task_id']}/update",
                {"planned_date": day},
                state["token"],
            )
            tid = state["task_id"]
            today = req("GET", "/api/tasks/today", token=state["token"])
            expect(any(i["id"] == tid for i in today.get("items") or []), "task not on today")
        done = req("POST", f"/api/tasks/{tid}/status", {"status": "done"}, state["token"])
        expect(done.get("status") == "done", str(done))
        state["done_task_id"] = tid
        return f"done_task={tid} today_total={today.get('total_count')}"

    def calendar_month():
        from datetime import date

        d = date.today()
        out = req("GET", f"/api/calendar/month?year={d.year}&month={d.month}", token=state["token"])
        expect(out.get("days"), "no days")
        return f"total_tasks={out.get('total_tasks')} days={len(out.get('days') or [])}"

    def replan_flow():
        unfinished = [t["id"] for t in state["tasks"] if t["id"] != state.get("done_task_id")][:3]
        if not unfinished:
            unfinished = [state["tasks"][0]["id"]]
        draft = req(
            "POST",
            "/api/plans/replan-draft",
            {
                "goal_id": state["goal_id"],
                "unfinished_task_ids": unfinished,
                "reason": "临时没时间",
            },
            state["token"],
        )
        expect(draft.get("tasks"), "no replan tasks")
        # 合法 apply
        patches = [
            {
                "id": t["id"],
                "planned_date": t.get("planned_date"),
                "status": t.get("status") or "todo",
                "estimated_minutes": t.get("estimated_minutes"),
            }
            for t in draft["tasks"]
            if t.get("id") in set(unfinished) or True
        ][:5]
        applied = req(
            "POST",
            "/api/plans/replan-apply",
            {
                "goal_id": state["goal_id"],
                "reason": "临时没时间",
                "unfinished_task_ids": unfinished,
                "tasks": patches,
            },
            state["token"],
        )
        expect(applied.get("goal_id") == state["goal_id"], str(applied))
        # 非法 id
        bad_ok = False
        try:
            req(
                "POST",
                "/api/plans/replan-apply",
                {
                    "goal_id": state["goal_id"],
                    "reason": "坏 id",
                    "tasks": [{"id": 99999991, "planned_date": "2099-01-01", "status": "todo"}],
                },
                state["token"],
            )
        except Fail as e:
            bad_ok = "400" in str(e)
        expect(bad_ok, "invalid replan id should 400")
        return f"draft_tasks={len(draft['tasks'])} apply_ok invalid_rejected"

    def skills():
        up = req(
            "POST",
            "/api/skills",
            {"skill_name": "Python基础", "domain": "技术", "level": 2, "evidence": "功能测试"},
            state["token"],
        )
        expect(up.get("skill", {}).get("id") or up.get("id"), str(up))
        lst = req("GET", "/api/skills", token=state["token"])
        count = lst.get("count") if isinstance(lst, dict) else None
        if count is None:
            count = len(lst.get("items") or lst.get("skills") or [])
        graph = req("GET", "/api/skills/graph", token=state["token"])
        expect(graph is not None, "graph empty")
        return f"skills≈{count} graph_keys={list(graph)[:4] if isinstance(graph, dict) else type(graph)}"

    def reviews():
        d = req("GET", "/api/reviews/daily", token=state["token"])
        w = req("GET", "/api/reviews/weekly", token=state["token"])
        expect("completion_rate" in d or "date" in d, str(d)[:120])
        expect("day_chart" in w or "completion_rate" in w, str(w)[:120])
        return f"daily={d.get('date') or d.get('completion_rate')} weekly_chart={len(w.get('day_chart') or [])}"

    def market():
        lst = req("GET", "/api/market", token=state["token"])
        items = lst.get("items") or []
        expect(isinstance(items, list), str(lst)[:120])
        used = None
        if items:
            mid = items[0]["id"]
            used = req("POST", f"/api/market/{mid}/use", {}, state["token"])
            expect(used.get("goal", {}).get("id") or used.get("goal_id"), str(used)[:200])
            state["market_goal_id"] = used.get("goal", {}).get("id") or used.get("goal_id")
        return f"items={len(items)} used_goal={state.get('market_goal_id')}"

    def groups_and_template():
        g = req(
            "POST",
            "/api/groups",
            {"name": "功能测试群", "topic": "Python"},
            state["token"],
        )
        expect(g.get("ok") is True, str(g))
        gid = g["group"]["id"]
        detail = req("GET", f"/api/groups/{gid}", token=state["token"])
        expect(detail.get("group", {}).get("id") == gid, str(detail)[:160])
        req(
            "POST",
            f"/api/groups/{gid}/link-goal",
            {"goal_id": state["goal_id"]},
            state["token"],
        )
        share = req(
            "POST",
            f"/api/goals/{state['goal_id']}/share-template",
            {"title": "功能测试模板"},
            state["token"],
        )
        expect(share.get("template", {}).get("share_code"), str(share)[:200])
        code = share["template"]["share_code"]
        tpl = req("GET", f"/api/templates/{code}")
        expect(tpl.get("template", {}).get("share_code") == code, str(tpl)[:160])
        cloned = req(
            "POST",
            "/api/templates/clone",
            {"share_code": code, "baseline": "复制测试"},
            state["token"],
        )
        expect(cloned.get("goal", {}).get("status") == "planning", str(cloned)[:200])
        req("POST", f"/api/groups/{gid}/leave", {}, state["token"])
        return f"group={gid} template={code} clone={cloned['goal']['id']}"

    def ics_export():
        raw = req("GET", "/api/calendar/ics?days=14", token=state["token"])
        text = raw if isinstance(raw, str) else str(raw)
        expect("BEGIN:VCALENDAR" in text, text[:80])
        return f"bytes≈{len(text)}"

    def list_goals():
        out = req("GET", "/api/goals", token=state["token"])
        items = out.get("items") or []
        expect(len(items) >= 1, "no goals")
        return f"count={len(items)}"

    case("01_health", health)
    case("02_auth_mode", auth_mode)
    case("03_dev_login", login)
    case("04_me", me)
    case("05_membership_activate", activate_member)
    case("06_plan_draft", plan_draft)
    case("07_confirm_modules", confirm)
    case("08_today_complete", today_and_complete)
    case("09_calendar_month", calendar_month)
    case("10_replan", replan_flow)
    case("11_skills", skills)
    case("12_reviews", reviews)
    case("13_market", market)
    case("14_groups_template", groups_and_template)
    case("15_ics", ics_export)
    case("16_list_goals", list_goals)

    passed = sum(1 for _, s, _ in results if s == "PASS")
    failed = sum(1 for _, s, _ in results if s == "FAIL")
    print("\n==== SUMMARY ====")
    print(f"base={BASE} passed={passed} failed={failed} total={len(results)}")
    for name, status, detail in results:
        if status == "FAIL":
            print(f"  - {name}: {detail}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
