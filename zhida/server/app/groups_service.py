"""学习群与计划模板的业务逻辑。"""

from __future__ import annotations

import json
import secrets
import string
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .timeutil import utc_now

from .models import (
    Goal,
    GoalStage,
    GroupGoalLink,
    GroupMember,
    PlanTemplate,
    PlanVersion,
    StudyGroup,
    Task,
    User,
)
from .workflows.fallback import today_str
from .workflows.plan import goal_quota_info, serialize_goal


def code(n: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))


def parse_json(raw: str | None, fallback):
    if not raw:
        return fallback
    try:
        data = json.loads(raw)
        return data if isinstance(data, type(fallback)) else fallback
    except json.JSONDecodeError:
        return fallback


def unique_code(db: Session, model, field: str) -> str:
    for _ in range(12):
        c = code(8)
        exists = db.query(model).filter(getattr(model, field) == c).first()
        if not exists:
            return c
    raise HTTPException(status_code=500, detail="邀请码生成失败")


def member_of(db: Session, group_id: int, user_id: int) -> GroupMember | None:
    return (
        db.query(GroupMember)
        .filter(
            GroupMember.group_id == group_id,
            GroupMember.user_id == user_id,
            GroupMember.status == "active",
        )
        .first()
    )


def today_progress(db: Session, user_id: int, goal_id: int | None, day: str) -> dict:
    q = db.query(Task).filter(
        Task.user_id == user_id,
        Task.planned_date == day,
        Task.status != "cancelled",
    )
    if goal_id:
        q = q.filter(Task.goal_id == goal_id)
    tasks = q.all()
    total = len(tasks)
    done = len([t for t in tasks if t.status == "done"])
    return {
        "total": total,
        "done": done,
        "done_all": total > 0 and done == total,
        "has_tasks": total > 0,
    }


def serialize_template(tpl: PlanTemplate, detail: bool = False) -> dict:
    out = {
        "id": tpl.id,
        "share_code": tpl.share_code,
        "title": tpl.title,
        "description": tpl.description,
        "goal_type": tpl.goal_type,
        "use_count": tpl.use_count or 0,
        "created_at": tpl.created_at.isoformat() if tpl.created_at else "",
    }
    if detail:
        modules = parse_json(tpl.modules_json, {})
        out["modules"] = modules.get("modules") or []
        out["skill_categories"] = modules.get("skill_categories") or []
        out["learning_path"] = parse_json(tpl.learning_path_json, {})
        out["resources"] = parse_json(tpl.resources_json, [])
    return out


def modules_for_share(db: Session, goal: Goal) -> dict:
    modules = parse_json(goal.modules_json, {})
    if modules.get("modules"):
        return modules
    stages = (
        db.query(GoalStage)
        .filter(GoalStage.goal_id == goal.id)
        .order_by(GoalStage.sort_order.asc())
        .all()
    )
    if not stages:
        return modules
    return {
        "skill_categories": [goal.goal_type or "综合"],
        "modules": [
            {
                "key": f"m{i+1}",
                "name": s.name,
                "category": goal.goal_type or "综合",
                "skills": [],
                "learn": s.name,
                "difficulty": "medium",
                "difficulty_label": "进阶",
                "estimated_hours": 8,
                "skippable": bool(s.skippable),
                "skip_reason": s.skip_reason or "",
            }
            for i, s in enumerate(stages)
        ],
    }


def publish_template(db: Session, user: User, goal_id: int, title: str | None) -> dict:
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    modules = modules_for_share(db, goal)
    if not (modules.get("modules") or []):
        raise HTTPException(status_code=400, detail="该目标还没有可分享的模块")

    tpl = PlanTemplate(
        owner_id=user.id,
        source_goal_id=goal.id,
        share_code=unique_code(db, PlanTemplate, "share_code"),
        title=(title or goal.title or "学习计划")[:128],
        description=goal.description or "",
        goal_type=goal.goal_type or "generic",
        modules_json=json.dumps(modules, ensure_ascii=False),
        learning_path_json=goal.learning_path_json or "{}",
        resources_json=goal.resources_json or "[]",
    )
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return {
        "ok": True,
        "template": serialize_template(tpl),
        "share_path": f"/pages/template-join/template-join?code={tpl.share_code}",
        "share_text": f"学习计划「{tpl.title}」邀请码 {tpl.share_code}",
    }


def get_template(db: Session, share_code: str) -> dict:
    tpl = (
        db.query(PlanTemplate)
        .filter(PlanTemplate.share_code == share_code.upper(), PlanTemplate.status == "active")
        .first()
    )
    if not tpl:
        raise HTTPException(status_code=404, detail="模板不存在或已失效")
    return {"template": serialize_template(tpl, detail=True)}


def clone_template(db: Session, user: User, share_code: str, baseline: str = "") -> dict:
    code_u = share_code.strip().upper()
    tpl = (
        db.query(PlanTemplate)
        .filter(PlanTemplate.share_code == code_u, PlanTemplate.status == "active")
        .first()
    )
    if not tpl:
        raise HTTPException(status_code=404, detail="模板不存在或已失效")

    quota = goal_quota_info(db, user)
    if not quota["is_member"] and quota["remaining"] is not None and quota["remaining"] <= 0:
        raise HTTPException(
            status_code=400,
            detail="免费名额已满，请完成或删除目标后再复制，或开通会员",
        )

    minutes = int(user.daily_minutes_weekday or 60)
    start = today_str()
    modules = parse_json(tpl.modules_json, {})
    goal = Goal(
        user_id=user.id,
        title=tpl.title,
        description=tpl.description or f"来自分享模板 {tpl.share_code}",
        goal_type=tpl.goal_type or "generic",
        baseline=(baseline or "").strip() or "未说明",
        daily_minutes=minutes,
        start_date=start,
        deadline=start,
        status="planning",
        completion_criteria="按所选模块完成学习并达到自定标准",
        resources_json=tpl.resources_json or "[]",
        learning_path_json=tpl.learning_path_json or "{}",
        modules_json=json.dumps(modules, ensure_ascii=False),
    )
    db.add(goal)
    db.flush()
    db.add(
        PlanVersion(
            goal_id=goal.id,
            version=1,
            reason=f"复制模板 {tpl.share_code}",
            snapshot_json=json.dumps(
                {"phase": "modules", "from_template": tpl.id, "modules": modules},
                ensure_ascii=False,
            ),
        )
    )
    tpl.use_count = int(tpl.use_count or 0) + 1
    db.commit()
    db.refresh(goal)
    return {
        "ok": True,
        "goal": serialize_goal(goal),
        "modules": modules.get("modules") or [],
        "skill_categories": modules.get("skill_categories") or [],
    }


def list_my_groups(db: Session, user: User) -> dict:
    rows = (
        db.query(GroupMember, StudyGroup)
        .join(StudyGroup, StudyGroup.id == GroupMember.group_id)
        .filter(GroupMember.user_id == user.id, GroupMember.status == "active")
        .order_by(GroupMember.joined_at.desc())
        .all()
    )
    items = []
    for mem, g in rows:
        if g.status != "active":
            continue
        count = (
            db.query(GroupMember)
            .filter(GroupMember.group_id == g.id, GroupMember.status == "active")
            .count()
        )
        items.append(
            {
                "id": g.id,
                "name": g.name,
                "topic": g.topic,
                "invite_code": g.invite_code,
                "role": mem.role,
                "member_count": count,
            }
        )
    return {"items": items}


def create_group(db: Session, user: User, name: str, topic: str = "") -> dict:
    owned = (
        db.query(StudyGroup)
        .filter(StudyGroup.owner_id == user.id, StudyGroup.status == "active")
        .count()
    )
    quota = goal_quota_info(db, user)
    limit = None if quota["is_member"] else 2
    if limit is not None and owned >= limit:
        raise HTTPException(status_code=400, detail=f"免费用户最多创建 {limit} 个学习群")

    g = StudyGroup(
        owner_id=user.id,
        name=name.strip()[:64],
        topic=(topic or "").strip()[:128],
        invite_code=unique_code(db, StudyGroup, "invite_code"),
        max_members=50 if quota["is_member"] else 20,
    )
    db.add(g)
    db.flush()
    db.add(GroupMember(group_id=g.id, user_id=user.id, role="owner", status="active"))
    db.commit()
    db.refresh(g)
    return {
        "ok": True,
        "group": {
            "id": g.id,
            "name": g.name,
            "topic": g.topic,
            "invite_code": g.invite_code,
            "max_members": g.max_members,
        },
        "share_path": f"/pages/group-join/group-join?code={g.invite_code}",
    }


def join_group(db: Session, user: User, invite_code: str) -> dict:
    code_u = invite_code.strip().upper()
    g = (
        db.query(StudyGroup)
        .filter(StudyGroup.invite_code == code_u, StudyGroup.status == "active")
        .first()
    )
    if not g:
        raise HTTPException(status_code=404, detail="邀请码无效")
    existing = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == g.id, GroupMember.user_id == user.id)
        .first()
    )
    if existing and existing.status == "active":
        return {"ok": True, "group_id": g.id, "already": True}
    count = (
        db.query(GroupMember)
        .filter(GroupMember.group_id == g.id, GroupMember.status == "active")
        .count()
    )
    if count >= int(g.max_members or 20):
        raise HTTPException(status_code=400, detail="群人数已满")
    if existing:
        existing.status = "active"
        existing.role = existing.role or "member"
        existing.joined_at = utc_now()
    else:
        db.add(GroupMember(group_id=g.id, user_id=user.id, role="member", status="active"))
    db.commit()
    return {"ok": True, "group_id": g.id, "already": False}


def group_detail(db: Session, user: User, group_id: int) -> dict:
    g = db.get(StudyGroup, group_id)
    if not g or g.status != "active":
        raise HTTPException(status_code=404, detail="not found")
    mem = member_of(db, group_id, user.id)
    if not mem:
        raise HTTPException(status_code=403, detail="不在该群中")

    day = today_str()
    members = (
        db.query(GroupMember, User)
        .join(User, User.id == GroupMember.user_id)
        .filter(GroupMember.group_id == group_id, GroupMember.status == "active")
        .order_by(GroupMember.joined_at.asc())
        .all()
    )
    links = db.query(GroupGoalLink).filter(GroupGoalLink.group_id == group_id).all()
    link_by_user = {lk.user_id: lk for lk in links}
    wall = []
    for m, u in members:
        lk = link_by_user.get(u.id)
        goal = db.get(Goal, lk.goal_id) if lk else None
        if goal and goal.status not in ("active", "planning"):
            goal = None
        prog = today_progress(db, u.id, goal.id if goal else None, day)
        wall.append(
            {
                "user_id": u.id,
                "nickname": u.nickname or "同学",
                "role": m.role,
                "goal_id": goal.id if goal else None,
                "goal_title": goal.title if goal else "",
                "goal_status": goal.status if goal else "",
                "today_done": prog["done"],
                "today_total": prog["total"],
                "today_done_all": prog["done_all"],
                "has_tasks": prog["has_tasks"],
                "is_me": u.id == user.id,
            }
        )

    my_link = link_by_user.get(user.id)
    return {
        "group": {
            "id": g.id,
            "name": g.name,
            "topic": g.topic,
            "invite_code": g.invite_code,
            "max_members": g.max_members,
            "owner_id": g.owner_id,
            "my_role": mem.role,
        },
        "members": wall,
        "my_linked_goal_id": my_link.goal_id if my_link else None,
        "today": day,
        "share_path": f"/pages/group-join/group-join?code={g.invite_code}",
    }


def link_goal(db: Session, user: User, group_id: int, goal_id: int) -> dict:
    if not member_of(db, group_id, user.id):
        raise HTTPException(status_code=403, detail="不在该群中")
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="目标不存在")
    if goal.status not in ("active", "planning"):
        raise HTTPException(status_code=400, detail="只能挂进行中或待确认的目标")

    existing = (
        db.query(GroupGoalLink)
        .filter(GroupGoalLink.group_id == group_id, GroupGoalLink.user_id == user.id)
        .first()
    )
    if existing:
        existing.goal_id = goal.id
    else:
        db.add(GroupGoalLink(group_id=group_id, user_id=user.id, goal_id=goal.id))
    db.commit()
    return {"ok": True, "goal_id": goal.id}


def leave_group(db: Session, user: User, group_id: int) -> dict:
    g = db.get(StudyGroup, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="not found")
    mem = member_of(db, group_id, user.id)
    if not mem:
        raise HTTPException(status_code=400, detail="不在该群中")
    if mem.role == "owner":
        g.status = "archived"
        db.query(GroupMember).filter(GroupMember.group_id == group_id).update(
            {"status": "left"}, synchronize_session=False
        )
    else:
        mem.status = "left"
        db.query(GroupGoalLink).filter(
            GroupGoalLink.group_id == group_id, GroupGoalLink.user_id == user.id
        ).delete()
    db.commit()
    return {"ok": True}
