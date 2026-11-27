"""技能市场 API。"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..market_service import (
    bump_use_count,
    list_market_categories,
    list_market_items,
    market_item_to_plan_data,
    serialize_market_item,
)
from ..models import Goal, PlanVersion, SkillMarketItem, User
from ..workflows.plan import FREE_GOAL_LIMIT, goal_quota_info, serialize_goal
from ..workflows.fallback import today_str
import json

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("")
def market_list(
    q: str = Query(default=""),
    domain: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    categories = list_market_categories(db)
    items = list_market_items(db, q=q, domain=domain, limit=80)
    return {
        "items": [serialize_market_item(it) for it in items],
        "categories": categories,
        # 兼容旧前端
        "domains": [c["key"] for c in categories],
        "total": len(items),
    }


@router.get("/{item_id}")
def market_detail(
    item_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(SkillMarketItem, item_id)
    if not item or item.status != "active":
        raise HTTPException(status_code=404, detail="not found")
    return {"item": serialize_market_item(item, detail=True)}


@router.post("/{item_id}/use")
def market_use(
    item_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """从技能市场一键生成待确认草案（不走大模型）。"""
    item = db.get(SkillMarketItem, item_id)
    if not item or item.status != "active":
        raise HTTPException(status_code=404, detail="not found")

    quota = goal_quota_info(db, user)
    if not quota["is_member"] and quota["remaining"] <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"免费用户最多保留 {FREE_GOAL_LIMIT} 个目标"
                "（进行中/暂停/已完成/待确认/已终止均计入，终止不释放）。"
            ),
        )

    # 与「我的」每日可用时间对齐，按模块量估算截止日（禁止写成当天）
    minutes = int(user.daily_minutes_weekday or 60)
    data = market_item_to_plan_data(
        item,
        raw_text=item.title,
        baseline="",
        daily_minutes=minutes,
    )
    g = data["goal"]
    modules_blob = {
        "skill_categories": data.get("skill_categories") or [],
        "skill_overview": data.get("skill_overview") or "",
        "skill_scenarios": data.get("skill_scenarios") or [],
        "modules": data.get("modules") or [],
    }
    start = g.get("start_date") or today_str()
    deadline = g.get("deadline") or start
    if deadline <= start:
        from ..market_service import estimate_module_days
        from ..workflows.fallback import add_days

        deadline = add_days(
            start,
            estimate_module_days(modules_blob.get("modules") or [], daily_minutes=minutes),
        )
    goal = Goal(
        user_id=user.id,
        title=g.get("title") or item.title,
        description=g.get("description") or item.skill_overview,
        goal_type=item.domain or "generic",
        baseline=g.get("baseline") or "未说明",
        daily_minutes=minutes,
        start_date=start,
        deadline=deadline,
        status="planning",
        completion_criteria=g.get("completion_criteria") or "",
        resources_json=item.resources_json or "[]",
        learning_path_json=item.learning_path_json or "{}",
        modules_json=json.dumps(modules_blob, ensure_ascii=False),
        plan_source="market",
    )
    db.add(goal)
    db.flush()
    bump_use_count(db, item)
    db.add(
        PlanVersion(
            goal_id=goal.id,
            version=1,
            reason="技能市场选用",
            snapshot_json=json.dumps(
                {
                    "phase": "modules",
                    "source": "market",
                    "market_id": item.id,
                    **modules_blob,
                },
                ensure_ascii=False,
            ),
        )
    )
    db.commit()
    db.refresh(goal)
    return {
        "goal": serialize_goal(goal),
        "skill_overview": modules_blob["skill_overview"],
        "skill_scenarios": modules_blob["skill_scenarios"],
        "modules": modules_blob["modules"],
        "analysis": {"source": "market", "market_id": item.id, "phase": "modules"},
    }
