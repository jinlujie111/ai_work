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

from ..config import get_settings, wallet_id_for_model
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
    # .env 常见尾部空格 / \r；两端都 strip，避免「明明输对却失败」
    user = (settings.admin_username or "").strip()
    pwd = (settings.admin_password or "").strip()
    if not user or not pwd:
        raise HTTPException(status_code=503, detail="admin login not configured")
    u_in = (body.username or "").strip()
    p_in = (body.password or "").strip()
    # 等长比较，避免长度差异触发 compare_digest 异常
    ok_user = len(u_in) == len(user) and secrets.compare_digest(u_in.encode("utf-8"), user.encode("utf-8"))
    ok_pwd = len(p_in) == len(pwd) and secrets.compare_digest(p_in.encode("utf-8"), pwd.encode("utf-8"))
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

    settings = get_settings()
    llm_cfg = settings.resolve_llm()
    in_rate = float(settings.llm_input_cny_per_1m)
    out_rate = float(settings.llm_output_cny_per_1m)
    credits_per_cny = float(settings.token_plan_credits_per_list_cny or 0)

    def _cny(pt: int, ct: int) -> float:
        return round(pt / 1_000_000 * in_rate + ct / 1_000_000 * out_rate, 4)

    def _credits(cny: float) -> float:
        if credits_per_cny <= 0:
            return 0.0
        return round(cny * credits_per_cny, 2)

    # 自然月用量（Token Plan 按订阅月重置；此处用日历月作运营粗监控）
    month_start = end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_filter = and_(AiUsage.created_at >= month_start, AiUsage.created_at <= end, _ACCURATE)
    month_pt, month_ct = _token_sums((month_filter,))
    month_calls = (
        db.query(func.count(AiUsage.id)).filter(month_filter).scalar() or 0
    )
    range_cny = _cny(ai_prompt_r, ai_comp_r)
    month_cny = _cny(month_pt, month_ct)
    range_credits = _credits(range_cny)
    month_credits = _credits(month_cny)

    # 单次完整规划（modules + expand）均值 → 估免费用户容量
    purpose_avg = {r["purpose"]: r for r in by_purpose}
    modules = purpose_avg.get("plan_modules") or {}
    expand = purpose_avg.get("plan_expand") or {}

    def _avg_pair(row: dict, fallback_pt: int, fallback_ct: int) -> tuple[int, int]:
        calls = int(row.get("accurate_calls") or 0)
        if calls <= 0:
            return fallback_pt, fallback_ct
        return int(round(int(row.get("prompt_tokens") or 0) / calls)), int(
            round(int(row.get("completion_tokens") or 0) / calls)
        )

    m_pt, m_ct = _avg_pair(modules, 413, 1366)
    e_pt, e_ct = _avg_pair(expand, 1153, 2276)
    per_goal_pt, per_goal_ct = m_pt + e_pt, m_ct + e_ct
    per_goal_cny = _cny(per_goal_pt, per_goal_ct)
    per_goal_credits = _credits(per_goal_cny)
    per_free_user_credits = round(per_goal_credits * FREE_GOAL_LIMIT, 2)
    plan_quota = int(settings.token_plan_monthly_credits or 0)
    plan_enabled = bool(settings.token_plan_enabled) and plan_quota > 0 and credits_per_cny > 0
    util = round(month_credits / plan_quota, 4) if plan_enabled and plan_quota else None
    remaining = round(max(0.0, plan_quota - month_credits), 2) if plan_enabled else None
    users_capacity = (
        int(plan_quota // per_free_user_credits) if plan_enabled and per_free_user_credits > 0 else None
    )
    users_remaining = (
        int(remaining // per_free_user_credits)
        if plan_enabled and remaining is not None and per_free_user_credits > 0
        else None
    )
    level = "ok"
    if util is not None:
        if util >= float(settings.token_plan_critical_ratio):
            level = "critical"
        elif util >= float(settings.token_plan_warn_ratio):
            level = "warn"

    token_plan = {
        "enabled": plan_enabled,
        "name": settings.token_plan_name or "Lite",
        "monthly_credits": plan_quota,
        "credits_per_list_cny": credits_per_cny,
        "month_start": month_start.isoformat(),
        "month_prompt_tokens": month_pt,
        "month_completion_tokens": month_ct,
        "month_total_tokens": month_pt + month_ct,
        "month_accurate_calls": int(month_calls),
        "month_list_cny_estimate": month_cny,
        "month_credits_estimate": month_credits,
        "remaining_credits_estimate": remaining,
        "utilization": util,
        "level": level if plan_enabled else "off",
        "warn_ratio": float(settings.token_plan_warn_ratio),
        "critical_ratio": float(settings.token_plan_critical_ratio),
        "per_goal": {
            "prompt_tokens": per_goal_pt,
            "completion_tokens": per_goal_ct,
            "list_cny_estimate": per_goal_cny,
            "credits_estimate": per_goal_credits,
            "definition": "区间内 plan_modules + plan_expand 准确调用均值（无样本时用经验值）",
        },
        "per_free_user_credits_estimate": per_free_user_credits,
        "free_goal_limit": FREE_GOAL_LIMIT,
        "users_capacity_estimate": users_capacity,
        "users_remaining_estimate": users_remaining,
        "definition": "Credits 由真实 token×配置单价估算，非百炼实扣；用尽规则以控制台为准",
    }
    cost_estimate = {
        "input_cny_per_1m": in_rate,
        "output_cny_per_1m": out_rate,
        "range_list_cny": range_cny,
        "range_credits": range_credits,
        "month_list_cny": month_cny,
        "month_credits": month_credits,
        "provider": (settings.llm_provider or "").lower(),
        "model": llm_cfg.get("model") or "",
        "definition": "按 .env 单价估算标价成本，不是网关实收账单",
    }

    # —— 各模型 / 钱包：消耗、剩余预算、预计用尽 ——
    wallet_period = (settings.llm_wallet_period or "month").lower().strip()
    lookback = max(1, int(settings.llm_wallet_burn_lookback_days or 7))
    burn_start = end - timedelta(days=lookback)
    if wallet_period == "all":
        wallet_period_start = None
        period_filter = (_ACCURATE,)
    else:
        wallet_period_start = month_start
        period_filter = (AiUsage.created_at >= month_start, AiUsage.created_at <= end, _ACCURATE)

    wallet_defs = {w["id"]: w for w in settings.llm_wallets()}

    def _rate_for(wid: str) -> tuple[float, float]:
        w = wallet_defs.get(wid) or wallet_defs["other"]
        return float(w["input_cny_per_1m"]), float(w["output_cny_per_1m"])

    def _cny_wallet(wid: str, pt: int, ct: int) -> float:
        rin, rout = _rate_for(wid)
        return round(pt / 1_000_000 * rin + ct / 1_000_000 * rout, 4)

    model_period_rows = (
        db.query(
            AiUsage.model,
            func.count(AiUsage.id),
            func.coalesce(func.sum(AiUsage.prompt_tokens), 0),
            func.coalesce(func.sum(AiUsage.completion_tokens), 0),
        )
        .filter(*period_filter)
        .group_by(AiUsage.model)
        .all()
    )
    model_burn_rows = (
        db.query(
            AiUsage.model,
            func.coalesce(func.sum(AiUsage.prompt_tokens), 0),
            func.coalesce(func.sum(AiUsage.completion_tokens), 0),
        )
        .filter(AiUsage.created_at >= burn_start, AiUsage.created_at <= end, _ACCURATE)
        .group_by(AiUsage.model)
        .all()
    )
    burn_by_model = {
        (m or "") or "unknown": (int(pt), int(ct)) for m, pt, ct in model_burn_rows
    }

    models_out: list[dict] = []
    wallet_acc: dict[str, dict] = {
        wid: {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "calls": 0,
            "spent_cny": 0.0,
            "burn_prompt": 0,
            "burn_completion": 0,
            "models": [],
        }
        for wid in wallet_defs
    }

    for model, n, pt, ct in model_period_rows:
        name = (model or "").strip() or "unknown"
        wid = wallet_id_for_model(name)
        pt_i, ct_i = int(pt), int(ct)
        spent = _cny_wallet(wid, pt_i, ct_i)
        bpt, bct = burn_by_model.get(name, (0, 0))
        # unknown key fallback
        if (bpt, bct) == (0, 0) and name == "unknown":
            bpt, bct = burn_by_model.get("", (0, 0))
        burn_cny = _cny_wallet(wid, bpt, bct)
        daily_burn = round(burn_cny / lookback, 4)
        wallet_acc[wid]["prompt_tokens"] += pt_i
        wallet_acc[wid]["completion_tokens"] += ct_i
        wallet_acc[wid]["calls"] += int(n)
        wallet_acc[wid]["spent_cny"] = round(wallet_acc[wid]["spent_cny"] + spent, 4)
        wallet_acc[wid]["burn_prompt"] += bpt
        wallet_acc[wid]["burn_completion"] += bct
        models_out.append(
            {
                "model": name,
                "wallet_id": wid,
                "calls": int(n),
                "prompt_tokens": pt_i,
                "completion_tokens": ct_i,
                "total_tokens": pt_i + ct_i,
                "spent_cny": spent,
                "daily_burn_cny": daily_burn,
                "input_cny_per_1m": _rate_for(wid)[0],
                "output_cny_per_1m": _rate_for(wid)[1],
            }
        )

    # 无周期消耗但有回看烧钱的模型也列出来
    seen_models = {m["model"] for m in models_out}
    for name, (bpt, bct) in burn_by_model.items():
        label = name or "unknown"
        if label in seen_models:
            continue
        wid = wallet_id_for_model(label)
        burn_cny = _cny_wallet(wid, bpt, bct)
        models_out.append(
            {
                "model": label,
                "wallet_id": wid,
                "calls": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "spent_cny": 0.0,
                "daily_burn_cny": round(burn_cny / lookback, 4),
                "input_cny_per_1m": _rate_for(wid)[0],
                "output_cny_per_1m": _rate_for(wid)[1],
            }
        )

    wallets_out: list[dict] = []
    for wdef in settings.llm_wallets():
        wid = wdef["id"]
        acc = wallet_acc[wid]
        budget = float(wdef["budget_cny"] or 0)
        spent = round(float(acc["spent_cny"]), 4)
        has_budget = budget > 0
        remaining = round(max(0.0, budget - spent), 4) if has_budget else None
        util = round(spent / budget, 4) if has_budget else None
        burn_cny = _cny_wallet(wid, acc["burn_prompt"], acc["burn_completion"])
        daily_burn = round(burn_cny / lookback, 4)
        days_left = None
        exhaust_at = None
        if has_budget and remaining is not None and daily_burn > 0:
            days_left = round(remaining / daily_burn, 1)
            exhaust_at = (now + timedelta(days=days_left)).date().isoformat()
        elif has_budget and remaining is not None and remaining <= 0:
            days_left = 0.0
            exhaust_at = "已用尽"
        elif has_budget and remaining is not None and daily_burn <= 0:
            days_left = None
            exhaust_at = "消耗过低，暂无法预估"

        level = "off"
        if has_budget and util is not None:
            if util >= float(settings.token_plan_critical_ratio) or (remaining is not None and remaining <= 0):
                level = "critical"
            elif util >= float(settings.token_plan_warn_ratio):
                level = "warn"
            else:
                level = "ok"
        elif spent > 0 or daily_burn > 0:
            level = "ok"

        # Token Plan：Credits 折算金额与预算取更紧
        credits_remaining = None
        credits_cny_remaining = None
        if wdef.get("token_plan") and plan_enabled:
            tp_rem_credits = token_plan.get("remaining_credits_estimate")
            if tp_rem_credits is not None and credits_per_cny > 0:
                credits_remaining = float(tp_rem_credits)
                credits_cny_remaining = round(credits_remaining / credits_per_cny, 4)
                if remaining is None:
                    remaining = credits_cny_remaining
                    has_budget = True
                    budget = max(budget, float(token_plan.get("month_list_cny_estimate") or 0) + credits_cny_remaining)
                else:
                    remaining = round(min(remaining, credits_cny_remaining), 4)
                if daily_burn > 0 and remaining is not None:
                    days_left = round(remaining / daily_burn, 1)
                    exhaust_at = (now + timedelta(days=days_left)).date().isoformat()
                elif remaining is not None and remaining <= 0:
                    days_left = 0.0
                    exhaust_at = "已用尽"
                if budget > 0:
                    util = round(spent / budget, 4) if budget else util
                    if util is not None:
                        if util >= float(settings.token_plan_critical_ratio) or remaining <= 0:
                            level = "critical"
                        elif util >= float(settings.token_plan_warn_ratio):
                            level = "warn"
                        else:
                            level = "ok"

        wallet_models = [m for m in models_out if m["wallet_id"] == wid]
        for m in wallet_models:
            m_days = None
            m_eta = None
            if remaining is not None and m["daily_burn_cny"] > 0:
                m_days = round(remaining / m["daily_burn_cny"], 1)
                m_eta = (now + timedelta(days=m_days)).date().isoformat()
            elif remaining is not None and remaining <= 0:
                m_days = 0.0
                m_eta = "已用尽"
            m["remaining_cny"] = remaining
            m["days_left"] = m_days
            m["exhaust_at"] = m_eta
            m["budget_cny"] = budget if budget > 0 else None

        provider = (settings.llm_provider or "").lower().strip()
        active = wid == wallet_id_for_model(llm_cfg.get("model") or "") or wid == provider
        if provider in {"dashscope", "aliyun"} and wid == "qwen":
            active = True

        wallets_out.append(
            {
                "id": wid,
                "label": wdef["label"],
                "budget_cny": budget if budget > 0 else None,
                "has_budget": bool(budget > 0 or remaining is not None),
                "spent_cny": spent,
                "remaining_cny": remaining,
                "utilization": util,
                "level": level,
                "daily_burn_cny": daily_burn,
                "days_left": days_left,
                "exhaust_at": exhaust_at,
                "prompt_tokens": acc["prompt_tokens"],
                "completion_tokens": acc["completion_tokens"],
                "total_tokens": acc["prompt_tokens"] + acc["completion_tokens"],
                "calls": acc["calls"],
                "input_cny_per_1m": wdef["input_cny_per_1m"],
                "output_cny_per_1m": wdef["output_cny_per_1m"],
                "token_plan": bool(wdef.get("token_plan")),
                "credits_remaining_estimate": credits_remaining,
                "credits_cny_remaining_estimate": credits_cny_remaining,
                "models": sorted(wallet_models, key=lambda x: x["spent_cny"], reverse=True),
                "active": active,
            }
        )

    models_out.sort(key=lambda x: x["spent_cny"], reverse=True)
    llm_wallets_payload = {
        "period": wallet_period,
        "period_start": wallet_period_start.isoformat() if wallet_period_start else None,
        "burn_lookback_days": lookback,
        "wallets": wallets_out,
        "models": models_out,
        "definition": "消耗=真实 token×各钱包单价；剩余=预算−消耗（Qwen 另参考 Token Plan Credits）；用尽日=剩余/近N日日均。非网关实收余额。",
    }

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
            "ai": "仅接口返回的真实 token；金额/Credits 为按配置单价的估算，非实收账单",
            "token_plan": "Token Plan 容量条用自然月真实 token 估算 Credits，阈值百炼控制台",
            "wallets": "各模型消耗/剩余/用尽日按钱包预算与近N日日均估算；改 .env 预算后重启生效",
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
            "cost_estimate": cost_estimate,
            "token_plan": token_plan,
            "wallets": llm_wallets_payload,
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


# ── 技能市场审核（上线 / 下线）────────────────────────────────────────────

class MarketStatusIn(BaseModel):
    status: str = Field(description="pending | active | offline")


@router.get("/market/skills")
def ops_market_skills(
    status: str | None = Query(None, description="pending|active|offline|空=全部"),
    q: str = Query(""),
    domain: str | None = Query(None),
    limit: int = Query(100, ge=1, le=200),
    _: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from ..market_service import (
        MARKET_STATUS_LABEL,
        list_market_items_admin,
        market_status_counts,
        serialize_market_item,
    )

    items = list_market_items_admin(
        db, status=status, q=q, domain=domain, limit=limit
    )
    return {
        "ok": True,
        "counts": market_status_counts(db),
        "status_labels": MARKET_STATUS_LABEL,
        "items": [serialize_market_item(it, detail=False) for it in items],
    }


@router.get("/market/skills/{item_id}")
def ops_market_skill_detail(
    item_id: int,
    _: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from ..market_service import serialize_market_item

    item = db.get(SkillMarketItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="技能不存在")
    return {"ok": True, "item": serialize_market_item(item, detail=True)}


@router.post("/market/skills/{item_id}/online")
def ops_market_skill_online(
    item_id: int,
    _: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from ..market_service import serialize_market_item, set_market_item_status

    try:
        item = set_market_item_status(db, item_id, "active")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.commit()
    return {"ok": True, "item": serialize_market_item(item)}


@router.post("/market/skills/{item_id}/offline")
def ops_market_skill_offline(
    item_id: int,
    _: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from ..market_service import serialize_market_item, set_market_item_status

    try:
        item = set_market_item_status(db, item_id, "offline")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.commit()
    return {"ok": True, "item": serialize_market_item(item)}


@router.post("/market/skills/{item_id}/status")
def ops_market_skill_set_status(
    item_id: int,
    body: MarketStatusIn,
    _: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from ..market_service import serialize_market_item, set_market_item_status

    try:
        item = set_market_item_status(db, item_id, body.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    return {"ok": True, "item": serialize_market_item(item)}
