from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db
from ..models import MembershipOrder, User
from ..timeutil import utc_now
from ..workflows.plan import FREE_GOAL_LIMIT, _is_member, goal_quota_info, rebalance_user_open_tasks

router = APIRouter(prefix="/api/me", tags=["me"])

PLANS = {
    "month": {"days": 30, "amount_cents": 1990, "label": "月会员"},
    "year": {"days": 365, "amount_cents": 9900, "label": "年会员"},
}


class PrefIn(BaseModel):
    daily_minutes_weekday: int | None = None
    daily_minutes_weekend: int | None = None
    nickname: str | None = None


class MembershipActivateIn(BaseModel):
    plan: str = "month"
    note: str = "dev_activate"


class SubscribeIn(BaseModel):
    daily: bool | None = None
    weekly: bool | None = None


@router.get("")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member = _is_member(user)
    if user.membership != "free" and not member:
        user.membership = "free"
        db.commit()
    quota = goal_quota_info(db, user)
    return {
        "id": user.id,
        "nickname": user.nickname,
        "membership": user.membership if member else "free",
        "is_member": member,
        "membership_expires_at": (
            user.membership_expires_at.isoformat() if user.membership_expires_at else ""
        ),
        "daily_minutes_weekday": user.daily_minutes_weekday,
        "daily_minutes_weekend": user.daily_minutes_weekend,
        "subscribe_daily": bool(user.subscribe_daily),
        "subscribe_weekly": bool(user.subscribe_weekly),
        "synced_at": utc_now().isoformat() + "Z",
        "goal_quota": quota,
        "free_goal_limit": FREE_GOAL_LIMIT,
        "plans": [
            {
                "id": "month",
                "label": "月会员",
                "price": "¥19.9",
                "desc": f"不限目标数（免费 {FREE_GOAL_LIMIT} 个）· AI 规划 · 动态调整",
            },
            {"id": "year", "label": "年会员", "price": "¥99", "desc": "全部高级功能 · 技能无限"},
        ],
    }


@router.post("/prefs")
def update_prefs(
    body: PrefIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    minutes_changed = False
    if body.daily_minutes_weekday is not None:
        user.daily_minutes_weekday = body.daily_minutes_weekday
        minutes_changed = True
        # 「我的」目前只暴露一个每日可用时间：同步周末，避免工作日 60、周末仍 120
        if body.daily_minutes_weekend is None:
            user.daily_minutes_weekend = body.daily_minutes_weekday
    if body.daily_minutes_weekend is not None:
        user.daily_minutes_weekend = body.daily_minutes_weekend
        minutes_changed = True
    if body.nickname:
        user.nickname = body.nickname
    if minutes_changed:
        # 进行中目标的 daily_minutes 跟档案对齐
        from ..models import Goal

        for g in (
            db.query(Goal)
            .filter(Goal.user_id == user.id, Goal.status.in_(("active", "planning", "paused")))
            .all()
        ):
            g.daily_minutes = int(user.daily_minutes_weekday or 60)
        rebalance_user_open_tasks(db, user)
    db.commit()
    return {"ok": True}


@router.post("/membership/activate")
def activate_membership(
    body: MembershipActivateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """开发态一键开通会员；正式环境需接微信支付，本接口在 prod / 关闭 AUTH_DEV_MODE 时禁用。"""
    settings = get_settings()
    if not settings.dev_tools_enabled():
        raise HTTPException(status_code=403, detail="dev membership activate disabled")
    plan = (body.plan or "month").lower()
    if plan not in PLANS:
        raise HTTPException(status_code=400, detail="invalid plan")
    meta = PLANS[plan]
    now = utc_now()
    base = user.membership_expires_at if user.membership_expires_at and user.membership_expires_at > now else now
    user.membership = plan
    user.membership_expires_at = base + timedelta(days=meta["days"])
    db.add(
        MembershipOrder(
            user_id=user.id,
            plan=plan,
            amount_cents=meta["amount_cents"],
            # 开发开通不算真实收入；运营看板只统计 status=paid
            status="dev_paid",
            note=body.note or "dev_activate",
        )
    )
    db.commit()
    return {
        "ok": True,
        "membership": user.membership,
        "membership_expires_at": user.membership_expires_at.isoformat(),
        "label": meta["label"],
    }


@router.post("/subscribe")
def update_subscribe(
    body: SubscribeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.daily is not None:
        user.subscribe_daily = 1 if body.daily else 0
    if body.weekly is not None:
        user.subscribe_weekly = 1 if body.weekly else 0
    db.commit()
    return {
        "ok": True,
        "subscribe_daily": bool(user.subscribe_daily),
        "subscribe_weekly": bool(user.subscribe_weekly),
    }
