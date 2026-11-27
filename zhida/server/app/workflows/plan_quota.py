from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Goal, User
from ..timeutil import utc_now


FREE_GOAL_LIMIT = 5


# 免费名额：历史上创建过的目标一律计入（进行中/暂停/已完成/待确认/已终止）
# 终止、放弃也不释放名额；开通会员后不限
QUOTA_STATUSES = ("active", "planning", "paused", "done", "terminated")


def _is_member(user: User) -> bool:
    if user.membership in ("month", "year", "member", "pro"):
        if user.membership_expires_at and user.membership_expires_at < utc_now():
            return False
        return True
    return False


def count_quota_goals(db: Session, user_id: int) -> int:
    # 含已终止：硬删除会漏计历史名额，故放弃/终止一律软终止留档
    return db.query(Goal).filter(Goal.user_id == user_id).count()


def goal_quota_info(db: Session, user: User) -> dict:
    used = count_quota_goals(db, user.id)
    if _is_member(user):
        return {
            "is_member": True,
            "limit": None,
            "used": used,
            "remaining": None,
        }
    remaining = max(0, FREE_GOAL_LIMIT - used)
    return {
        "is_member": False,
        "limit": FREE_GOAL_LIMIT,
        "used": used,
        "remaining": remaining,
    }
