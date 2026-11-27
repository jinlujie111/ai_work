"""运营监控：P0/P1/P2 指标均来自库内实测，不做模拟推演。"""

from __future__ import annotations

import json
import secrets
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import (
    AiUsage,
    Goal,
    GoalReview,
    GoalStage,
    GroupGoalLink,
    GroupMember,
    MembershipOrder,
    PlanVersion,
    SkillEvidence,
    SkillMarketItem,
    StudyGroup,
    Task,
    User,
    UserSkill,
)
from ..timeutil import utc_now
from ..workflows.plan_quota import FREE_GOAL_LIMIT, _is_member

router = APIRouter(prefix="/api/admin/ops", tags=["admin-ops"])

_CONFIRMED = ("active", "paused", "done", "terminated")
_OPS_JWT_DAYS = 7


class OpsLoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


def _issue_ops_token(username: str) -> str:
    settings = get_settings()
    payload = {
        "sub": username,
        "role": "ops_admin",
        "exp": utc_now() + timedelta(days=_OPS_JWT_DAYS),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _verify_ops_jwt(token: str) -> str:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="invalid session") from exc
    if payload.get("role") != "ops_admin":
        raise HTTPException(status_code=401, detail="invalid session")
    return str(payload.get("sub") or "")


def require_admin(
    authorization: Annotated[str | None, Header()] = None,
    x_admin_token: Annotated[str | None, Header()] = None,
) -> str:
    """网页：Bearer ops JWT；机器：可选 X-Admin-Token。"""
    settings = get_settings()
    if authorization and authorization.lower().startswith("bearer "):
        return _verify_ops_jwt(authorization.split(" ", 1)[1].strip())

    expected = (settings.admin_token or "").strip()
    if expected and (x_admin_token or "").strip() == expected:
        return "token"

    raise HTTPException(status_code=401, detail="login required")


@router.post("/login")
def ops_login(body: OpsLoginIn):
    settings = get_settings()
    user = (settings.admin_username or "").strip()
    pwd = settings.admin_password or ""
    if not user or not pwd:
        raise HTTPException(status_code=503, detail="admin login not configured")
    u_in = body.username.strip()
    # 等长比较，避免长度差异触发 compare_digest 异常
    ok_user = len(u_in) == len(user) and secrets.compare_digest(u_in, user)
    ok_pwd = len(body.password) == len(pwd) and secrets.compare_digest(body.password, pwd)
    if not (ok_user and ok_pwd):
        raise HTTPException(status_code=401, detail="invalid username or password")
    token = _issue_ops_token(user)
    return {"ok": True, "token": token, "username": user, "expires_days": _OPS_JWT_DAYS}


@router.get("/me")
def ops_me(admin: str = Depends(require_admin)):
    return {"ok": True, "username": admin if admin != "token" else "token"}


def _day_start(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _parse_range(days: int) -> tuple[datetime, datetime]:
    end = utc_now()
    start = _day_start(end) - timedelta(days=max(1, min(days, 90)) - 1)
    return start, end


_ACCURATE = or_(
    AiUsage.tokens_accurate == 1,
    and_(AiUsage.tokens_accurate == 0, AiUsage.prompt_tokens > 0),
)


def _pct(num: float, den: float) -> float | None:
    if den <= 0:
        return None
    return round(num / den, 4)


def _percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return round(sorted_vals[0], 4)
    k = (len(sorted_vals) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return round(sorted_vals[f], 4)
    return round(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f), 4)


def _goal_plan_source(db: Session) -> dict[int, str]:
    """优先 Goal.plan_source；否则从该目标最早 PlanVersion.snapshot 解析。"""
    out: dict[int, str] = {}
    for gid, src in db.query(Goal.id, Goal.plan_source).all():
        if (src or "").strip():
            out[int(gid)] = src.strip()
    versions = (
        db.query(PlanVersion)
        .order_by(PlanVersion.goal_id.asc(), PlanVersion.version.asc(), PlanVersion.id.asc())
        .all()
    )
    seen: set[int] = set()
    for pv in versions:
        if pv.goal_id in seen or pv.goal_id in out:
            seen.add(pv.goal_id)
            continue
        seen.add(pv.goal_id)
        try:
            snap = json.loads(pv.snapshot_json or "{}")
        except json.JSONDecodeError:
            snap = {}
        src = (snap.get("source") or (snap.get("analysis") or {}).get("source") or "").strip()
        if not src:
            reason = pv.reason or ""
            if "市场" in reason:
                src = "market"
            elif "langgraph" in reason.lower():
                src = "langgraph"
            elif "本地" in reason or "fallback" in reason.lower():
                src = "fallback"
        if src:
            out[int(pv.goal_id)] = src
    return out


def _activity_days(db: Session) -> dict[int, set[str]]:
    """用户活跃日：完成任务 / 复盘 / AI 调用 / 建目标（均为真实事件日）。"""
    days: dict[int, set[str]] = defaultdict(set)
    for uid, completed_at in db.query(Task.user_id, Task.completed_at).filter(Task.completed_at.isnot(None)):
        days[int(uid)].add(completed_at.strftime("%Y-%m-%d"))
    for uid, created_at in db.query(GoalReview.user_id, GoalReview.created_at).all():
        if created_at:
            days[int(uid)].add(created_at.strftime("%Y-%m-%d"))
    for uid, created_at in db.query(AiUsage.user_id, AiUsage.created_at).all():
        if created_at:
            days[int(uid)].add(created_at.strftime("%Y-%m-%d"))
    for uid, created_at in db.query(Goal.user_id, Goal.created_at).all():
        if created_at:
            days[int(uid)].add(created_at.strftime("%Y-%m-%d"))
    return days


def _cohort_retention(
    users: list[User],
    activity: dict[int, set[str]],
    *,
    offsets: tuple[int, ...] = (1, 7, 30),
) -> dict:
    """按注册日队列：D+N 是否有活跃。只统计注册已满 N 天的用户。"""
    now = utc_now()
    today = now.date()
    result = {}
    for off in offsets:
        eligible = 0
        retained = 0
        for u in users:
            if not u.created_at:
                continue
            reg = u.created_at.date()
            if (today - reg).days < off:
                continue
            eligible += 1
            target = (reg + timedelta(days=off)).strftime("%Y-%m-%d")
            if target in activity.get(u.id, set()):
                retained += 1
        result[f"d{off}"] = {
            "eligible": eligible,
            "retained": retained,
            "rate": _pct(retained, eligible),
            "definition": f"注册满 {off} 天的用户中，注册日+{off} 有完成任务/复盘/AI/建目标",
        }
    return result


@router.get("/summary")
def ops_summary(
    _: None = Depends(require_admin),
    db: Session = Depends(get_db),
    days: int = Query(30, ge=1, le=90),
):
    start, end = _parse_range(days)
    now = utc_now()
    today0 = _day_start(now)
    today_s = today0.strftime("%Y-%m-%d")
    week_ago = (today0 - timedelta(days=6)).strftime("%Y-%m-%d")
    in_range = and_(AiUsage.created_at >= start, AiUsage.created_at <= end)

    users = db.query(User).all()
    users_total = len(users)
    users_new = sum(1 for u in users if u.created_at and start <= u.created_at <= end)
    users_today = sum(1 for u in users if u.created_at and u.created_at >= today0)
    members_active = sum(1 for u in users if _is_member(u))
    free_users = users_total - members_active

    goal_counts = dict(
        db.query(Goal.user_id, func.count(Goal.id)).group_by(Goal.user_id).all()
    )
    free_capped = sum(
        1
        for u in users
        if not _is_member(u) and int(goal_counts.get(u.id, 0)) >= FREE_GOAL_LIMIT
    )
    users_with_goal = len(goal_counts)

    goals_total = db.query(func.count(Goal.id)).scalar() or 0
    goals_new = (
        db.query(func.count(Goal.id)).filter(Goal.created_at >= start, Goal.created_at <= end).scalar() or 0
    )
    status_rows = db.query(Goal.status, func.count(Goal.id)).group_by(Goal.status).all()
    goals_by_status = {str(st or "unknown"): int(n) for st, n in status_rows}
    goals_confirmed = (
        db.query(func.count(Goal.id)).filter(Goal.status.in_(_CONFIRMED)).scalar() or 0
    )
    goals_planning = goals_by_status.get("planning", 0)

    # —— 任务完成（总体 / 近 7 日计划日）——
    tasks_done = db.query(func.count(Task.id)).filter(Task.status == "done").scalar() or 0
    tasks_todo = db.query(func.count(Task.id)).filter(Task.status == "todo").scalar() or 0
    tasks_cancelled = db.query(func.count(Task.id)).filter(Task.status == "cancelled").scalar() or 0
    tasks_due = (
        db.query(func.count(Task.id))
        .filter(Task.planned_date != "", Task.planned_date.isnot(None), Task.status != "cancelled")
        .scalar()
        or 0
    )
    tasks_due_done = (
        db.query(func.count(Task.id))
        .filter(Task.planned_date != "", Task.planned_date.isnot(None), Task.status == "done")
        .scalar()
        or 0
    )
    week_due = (
        db.query(func.count(Task.id))
        .filter(
            Task.planned_date >= week_ago,
            Task.planned_date <= today_s,
            Task.status != "cancelled",
        )
        .scalar()
        or 0
    )
    week_done = (
        db.query(func.count(Task.id))
        .filter(
            Task.planned_date >= week_ago,
            Task.planned_date <= today_s,
            Task.status == "done",
        )
        .scalar()
        or 0
    )
    today_due = (
        db.query(func.count(Task.id))
        .filter(Task.planned_date == today_s, Task.status != "cancelled")
        .scalar()
        or 0
    )
    today_done = (
        db.query(func.count(Task.id))
        .filter(Task.planned_date == today_s, Task.status == "done")
        .scalar()
        or 0
    )
    deferred_n = (
        db.query(func.count(Task.id))
        .filter(or_(Task.defer_reason != "", Task.status == "deferred"))
        .scalar()
        or 0
    )

    # —— AI 成本（仅真实 usage）——
    ai_calls_all = db.query(func.count(AiUsage.id)).scalar() or 0
    ai_calls_range = db.query(func.count(AiUsage.id)).filter(in_range).scalar() or 0
    ai_accurate_range = db.query(func.count(AiUsage.id)).filter(in_range, _ACCURATE).scalar() or 0
    ai_inaccurate_range = ai_calls_range - ai_accurate_range

    def _token_sums(extra=()):
        row = (
            db.query(
                func.coalesce(func.sum(AiUsage.prompt_tokens), 0),
                func.coalesce(func.sum(AiUsage.completion_tokens), 0),
            )
            .filter(_ACCURATE, *extra)
            .one()
        )
        return int(row[0] or 0), int(row[1] or 0)

    ai_prompt_r, ai_comp_r = _token_sums((in_range,))
    ai_prompt_all, ai_comp_all = _token_sums()

    per_user_rows = (
        db.query(
            AiUsage.user_id,
            func.coalesce(func.sum(AiUsage.prompt_tokens), 0),
            func.coalesce(func.sum(AiUsage.completion_tokens), 0),
            func.count(AiUsage.id),
        )
        .filter(_ACCURATE)
        .group_by(AiUsage.user_id)
        .all()
    )
    per_user_totals = sorted(int(p) + int(c) for _, p, c, _ in per_user_rows)
    ai_user_cost = {
        "users_with_accurate_usage": len(per_user_totals),
        "mean_tokens": int(round(sum(per_user_totals) / len(per_user_totals))) if per_user_totals else None,
        "p50_tokens": int(round(_percentile([float(x) for x in per_user_totals], 0.50) or 0))
        if per_user_totals
        else None,
        "p95_tokens": int(round(_percentile([float(x) for x in per_user_totals], 0.95) or 0))
        if per_user_totals
        else None,
        "max_tokens": per_user_totals[-1] if per_user_totals else None,
        "definition": "仅接口真实 usage；按用户汇总 token（非金额折算）",
    }

    purpose_rows = (
        db.query(
            AiUsage.purpose,
            func.count(AiUsage.id),
            func.coalesce(func.sum(case((_ACCURATE, AiUsage.prompt_tokens), else_=0)), 0),
            func.coalesce(func.sum(case((_ACCURATE, AiUsage.completion_tokens), else_=0)), 0),
            func.coalesce(func.sum(case((_ACCURATE, 1), else_=0)), 0),
        )
        .filter(in_range)
        .group_by(AiUsage.purpose)
        .all()
    )
    by_purpose = []
    for purpose, n, pt, ct, acc_n in purpose_rows:
        pt_i, ct_i = int(pt), int(ct)
        by_purpose.append(
            {
                "purpose": purpose or "unknown",
                "calls": int(n),
                "accurate_calls": int(acc_n),
                "prompt_tokens": pt_i,
                "completion_tokens": ct_i,
                "total_tokens": pt_i + ct_i,
            }
        )
    by_purpose.sort(key=lambda x: x["total_tokens"], reverse=True)

    # —— 收入：仅 status=paid 为真实收款；dev_paid 为开发测试，不计入收入/毛利 ——
    orders_q = db.query(
        func.count(MembershipOrder.id),
        func.coalesce(func.sum(MembershipOrder.amount_cents), 0),
    ).filter(MembershipOrder.status == "paid")
    orders_all = orders_q.one()
    orders_range = orders_q.filter(
        MembershipOrder.created_at >= start, MembershipOrder.created_at <= end
    ).one()
    plan_rows = (
        db.query(
            MembershipOrder.plan,
            func.count(MembershipOrder.id),
            func.coalesce(func.sum(MembershipOrder.amount_cents), 0),
        )
        .filter(
            MembershipOrder.status == "paid",
            MembershipOrder.created_at >= start,
            MembershipOrder.created_at <= end,
        )
        .group_by(MembershipOrder.plan)
        .all()
    )
    by_plan = [
        {"plan": p or "unknown", "orders": int(n), "amount_cents": int(cents)}
        for p, n, cents in plan_rows
    ]
    rev_all_cents = int(orders_all[1] or 0)
    rev_range_cents = int(orders_range[1] or 0)
    rev_range_cny = rev_range_cents / 100.0
    rev_all_cny = rev_all_cents / 100.0

    dev_q = db.query(
        func.count(MembershipOrder.id),
        func.coalesce(func.sum(MembershipOrder.amount_cents), 0),
    ).filter(MembershipOrder.status == "dev_paid")
    dev_all = dev_q.one()
    dev_range = dev_q.filter(
        MembershipOrder.created_at >= start, MembershipOrder.created_at <= end
    ).one()
    test_orders = {
        "orders_all": int(dev_all[0] or 0),
        "orders_in_range": int(dev_range[0] or 0),
        "amount_cny_all": round(int(dev_all[1] or 0) / 100.0, 2),
        "amount_cny_in_range": round(int(dev_range[1] or 0) / 100.0, 2),
        "definition": "开发态开通（status=dev_paid），不计入真实收入/毛利",
    }

    # —— 规划来源 / 市场 / fallback ——
    source_map = _goal_plan_source(db)
    source_counts: dict[str, int] = defaultdict(int)
    for src in source_map.values():
        source_counts[src] += 1
    known_src = sum(source_counts.values())
    market_n = source_counts.get("market", 0)
    fallback_n = source_counts.get("fallback", 0) + source_counts.get("local", 0)
    llm_n = source_counts.get("langgraph", 0) + source_counts.get("llm", 0)

    # 回填空 plan_source（只写库，便于下次）
    empty_goals = db.query(Goal).filter(or_(Goal.plan_source == "", Goal.plan_source.is_(None))).all()
    dirty = False
    for g in empty_goals:
        if g.id in source_map:
            g.plan_source = source_map[g.id]
            dirty = True
    if dirty:
        db.commit()

    # —— 调整：version≥2 的应用 vs 回滚；延期任务 ——
    versions = db.query(PlanVersion).all()
    v2_applied = 0
    rollback_versions = 0
    for pv in versions:
        reason = (pv.reason or "").strip()
        if reason.startswith("回滚"):
            rollback_versions += 1
            continue
        if int(pv.version or 1) >= 2:
            v2_applied += 1
    replan_calls = db.query(func.count(AiUsage.id)).filter(AiUsage.purpose == "replan").scalar() or 0
    adjust_accept = {
        "applied_versions_v2plus": v2_applied,
        "rollback_versions": rollback_versions,
        "replan_llm_calls": int(replan_calls),
        "deferred_tasks": int(deferred_n),
        "accept_rate": _pct(v2_applied, v2_applied + rollback_versions)
        if (v2_applied + rollback_versions) > 0
        else None,
        "definition": "version≥2 且非回滚视为已应用调整；reason 以「回滚」开头为回退",
    }

    # —— 技能 ——
    evidence_total = db.query(func.count(SkillEvidence.id)).scalar() or 0
    evidence_confirmed = (
        db.query(func.count(SkillEvidence.id)).filter(SkillEvidence.confirmed == 1).scalar() or 0
    )
    skills_total = db.query(func.count(UserSkill.id)).scalar() or 0
    users_with_skills = db.query(func.count(func.distinct(UserSkill.user_id))).scalar() or 0
    stages_total = db.query(func.count(GoalStage.id)).scalar() or 0
    stages_skipped = (
        db.query(func.count(GoalStage.id)).filter(GoalStage.skippable == 1).scalar() or 0
    )

    # —— 会员续费 / 到期（仅真实 paid）——
    payer_orders = (
        db.query(MembershipOrder.user_id, func.count(MembershipOrder.id))
        .filter(MembershipOrder.status == "paid")
        .group_by(MembershipOrder.user_id)
        .all()
    )
    payers = len(payer_orders)
    renewers = sum(1 for _, n in payer_orders if int(n) >= 2)
    expiring_7d = 0
    expired_members = 0
    for u in users:
        if u.membership in ("month", "year", "member", "pro") and u.membership_expires_at:
            if u.membership_expires_at < now:
                expired_members += 1
            elif u.membership_expires_at <= now + timedelta(days=7):
                expiring_7d += 1

    # —— 留存 ——
    activity = _activity_days(db)
    retention = _cohort_retention(users, activity)

    # —— 小组 ——
    groups_n = db.query(func.count(StudyGroup.id)).scalar() or 0
    group_members_n = db.query(func.count(GroupMember.id)).scalar() or 0
    group_links_n = db.query(func.count(GroupGoalLink.id)).scalar() or 0
    users_in_groups = db.query(func.count(func.distinct(GroupMember.user_id))).scalar() or 0

    # —— 市场库存 ——
    market_items = db.query(func.count(SkillMarketItem.id)).scalar() or 0
    market_uses = db.query(func.coalesce(func.sum(SkillMarketItem.use_count), 0)).scalar() or 0

    # —— 日序列 ——
    series = []
    for i in range((end.date() - start.date()).days + 1):
        d0 = _day_start(start) + timedelta(days=i)
        d1 = d0 + timedelta(days=1)
        day_filter = and_(AiUsage.created_at >= d0, AiUsage.created_at < d1)
        day_users = (
            db.query(func.count(User.id)).filter(User.created_at >= d0, User.created_at < d1).scalar() or 0
        )
        day_goals = (
            db.query(func.count(Goal.id)).filter(Goal.created_at >= d0, Goal.created_at < d1).scalar() or 0
        )
        day_calls = db.query(func.count(AiUsage.id)).filter(day_filter).scalar() or 0
        day_acc = db.query(func.count(AiUsage.id)).filter(day_filter, _ACCURATE).scalar() or 0
        pt, ct = _token_sums((day_filter,))
        day_rev_cents = (
            db.query(func.coalesce(func.sum(MembershipOrder.amount_cents), 0))
            .filter(
                MembershipOrder.status == "paid",
                MembershipOrder.created_at >= d0,
                MembershipOrder.created_at < d1,
            )
            .scalar()
            or 0
        )
        rev = int(day_rev_cents) / 100.0
        series.append(
            {
                "date": d0.strftime("%Y-%m-%d"),
                "new_users": int(day_users),
                "new_goals": int(day_goals),
                "ai_calls": int(day_calls),
                "ai_accurate_calls": int(day_acc),
                "prompt_tokens": pt,
                "completion_tokens": ct,
                "total_tokens": pt + ct,
                "revenue_cny": round(rev, 2),
            }
        )

    create_rate = _pct(users_with_goal, users_total)
    confirm_rate = _pct(goals_confirmed, goals_total)
    conversion = _pct(members_active, users_total)
    quota_cap_rate = _pct(free_capped, free_users) if free_users else None

    p0 = {
        "goal_create_rate": {
            "value": create_rate,
            "users_with_goal": users_with_goal,
            "users_total": users_total,
            "definition": "至少创建过 1 个目标的用户 / 注册用户",
        },
        "plan_confirm_rate": {
            "value": confirm_rate,
            "confirmed_goals": goals_confirmed,
            "goals_total": goals_total,
            "planning": goals_planning,
            "definition": "状态∈active/paused/done/terminated 的目标 / 全部目标",
        },
        "task_completion_rate": {
            "overall": _pct(tasks_due_done, tasks_due),
            "due": tasks_due,
            "due_done": tasks_due_done,
            "today": _pct(today_done, today_due),
            "today_due": today_due,
            "today_done": today_done,
            "week": _pct(week_done, week_due),
            "week_due": week_due,
            "week_done": week_done,
            "definition": "有计划日的任务中 status=done 占比；另给今日/近7日计划日切片",
        },
        "free_quota_capped_rate": {
            "value": quota_cap_rate,
            "capped_users": free_capped,
            "free_users": free_users,
            "limit": FREE_GOAL_LIMIT,
            "definition": "免费用户中目标数≥免费上限的占比",
        },
        "ai_cost_per_user": ai_user_cost,
        "membership_conversion_rate": {
            "value": conversion,
            "members_active": members_active,
            "users_total": users_total,
            "definition": "当前有效会员 / 注册用户",
        },
    }

    p1 = {
        "retention": {
            **retention,
            "activity_definition": "完成任务 / 复盘 / AI 调用 / 创建目标 记为活跃日",
        },
        "replan_accept_rate": adjust_accept,
        "skill_confirm_rate": {
            "value": _pct(evidence_confirmed, evidence_total),
            "confirmed": evidence_confirmed,
            "total": evidence_total,
            "user_skills": skills_total,
            "users_with_skills": users_with_skills,
            "definition": "SkillEvidence.confirmed=1 / 全部证据",
        },
        "market_hit_rate": {
            "value": _pct(market_n, known_src),
            "market": market_n,
            "llm": llm_n,
            "fallback": fallback_n,
            "known_goals": known_src,
            "by_source": dict(source_counts),
            "market_catalog_items": int(market_items),
            "market_use_count_sum": int(market_uses or 0),
            "definition": "目标 plan_source/首版 snapshot.source=market 的占比（仅已知来源）",
        },
        "membership_renewal": {
            "payers": payers,
            "renewers": renewers,
            "renewal_rate": _pct(renewers, payers),
            "expiring_in_7d": expiring_7d,
            "expired_still_flagged": expired_members,
            "definition": "≥2 笔已支付订单的用户 / 有支付用户；另统计 7 日内到期",
        },
    }

    p2 = {
        "skill_skip_hit_rate": {
            "value": _pct(stages_skipped, stages_total),
            "skipped_stages": stages_skipped,
            "stages_total": stages_total,
            "definition": "GoalStage.skippable=1 / 全部阶段（档案复用跳过）",
            "note": "跨目标「规划命中」需 skills_used 落库后可再细拆；当前为阶段跳过实测",
        },
        "groups": {
            "groups": int(groups_n),
            "members": int(group_members_n),
            "goal_links": int(group_links_n),
            "users_in_groups": int(users_in_groups),
            "user_join_rate": _pct(users_in_groups, users_total),
            "definition": "学习小组与成员/目标关联的实测计数",
        },
        "plan_fallback_rate": {
            "value": _pct(fallback_n, known_src),
            "fallback_goals": fallback_n,
            "known_goals": known_src,
            "definition": "plan_source∈fallback/local / 已知来源目标",
        },
        "ai_usage_quality": {
            "accurate_calls_in_range": int(ai_accurate_range),
            "inaccurate_calls_in_range": int(ai_inaccurate_range),
            "accurate_rate": _pct(ai_accurate_range, ai_calls_range),
            "definition": "区间内真实 usage 调用占比；假算 token 不计入",
        },
    }

    return {
        "range": {"days": days, "start": start.isoformat(), "end": end.isoformat()},
        "data_policy": {
            "revenue": "仅 MembershipOrder.status=paid（真实支付）",
            "test_orders": "status=dev_paid 仅展示、不计入收入",
            "ai": "仅接口返回的真实 token；不按单价折算成「真实成本」",
            "note": "无模拟打平、无开发订单充作收入",
        },
        "users": {
            "total": users_total,
            "new_in_range": users_new,
            "new_today": users_today,
            "members_active": members_active,
            "free": free_users,
            "free_quota_capped": free_capped,
            "with_goal": users_with_goal,
            "create_rate": create_rate,
            "conversion_rate": conversion,
        },
        "goals": {
            "total": goals_total,
            "new_in_range": goals_new,
            "by_status": goals_by_status,
            "planning": goals_planning,
            "confirmed": goals_confirmed,
            "confirm_rate": confirm_rate,
            "free_limit": FREE_GOAL_LIMIT,
            "by_plan_source": dict(source_counts),
        },
        "tasks": {
            "done": int(tasks_done),
            "todo": int(tasks_todo),
            "cancelled": int(tasks_cancelled),
            "due": int(tasks_due),
            "due_done": int(tasks_due_done),
            "completion_rate": _pct(tasks_due_done, tasks_due),
            "week_completion_rate": _pct(week_done, week_due),
            "today_completion_rate": _pct(today_done, today_due),
        },
        "ai": {
            "calls_all": int(ai_calls_all),
            "calls_in_range": int(ai_calls_range),
            "accurate_calls_in_range": int(ai_accurate_range),
            "inaccurate_calls_in_range": int(ai_inaccurate_range),
            "prompt_tokens_in_range": ai_prompt_r,
            "completion_tokens_in_range": ai_comp_r,
            "total_tokens_in_range": ai_prompt_r + ai_comp_r,
            "prompt_tokens_all": ai_prompt_all,
            "completion_tokens_all": ai_comp_all,
            "total_tokens_all": ai_prompt_all + ai_comp_all,
            "by_purpose": by_purpose,
            "per_user": ai_user_cost,
        },
        "revenue": {
            "orders_all": int(orders_all[0] or 0),
            "orders_in_range": int(orders_range[0] or 0),
            "amount_cents_all": rev_all_cents,
            "amount_cents_in_range": rev_range_cents,
            "amount_cny_all": round(rev_all_cny, 2),
            "amount_cny_in_range": round(rev_range_cny, 2),
            "by_plan": by_plan,
            "test_orders": test_orders,
        },
        "profit": {
            "revenue_cny": round(rev_range_cny, 2),
            "lifetime_revenue_cny": round(rev_all_cny, 2),
            "definition": "真实支付收入；未扣 LLM（无网关实收账单，不伪造成本金额）",
        },
        "metrics": {"p0": p0, "p1": p1, "p2": p2},
        "series": series,
    }
