from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import Goal, User, UserSkill
from ..skills_service import (
    FREE_SKILL_LIMIT,
    build_skill_graph,
    export_skills_payload,
    list_confirmed_skills,
    propose_skills_for_goal,
    serialize_skill,
    skill_count,
    upsert_skill,
)

router = APIRouter(prefix="/api/skills", tags=["skills"])


class SkillUpsertIn(BaseModel):
    skill_name: str = Field(min_length=1, max_length=64)
    domain: str = "其他"
    level: int = 1
    evidence: str = ""


class SkillConfirmIn(BaseModel):
    skill_name: str = Field(min_length=1, max_length=64)
    domain: str = "其他"
    level: int = 1
    evidence: str = ""
    goal_id: int = 0
    stage_id: int = 0
    source: str = "ai_suggest"


class SkillBatchConfirmIn(BaseModel):
    items: list[SkillConfirmIn]


@router.get("")
def list_skills(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(UserSkill)
        .filter(UserSkill.user_id == user.id, UserSkill.status == "active")
        .order_by(UserSkill.updated_at.desc())
        .all()
    )
    return {
        "items": [serialize_skill(r) for r in rows],
        "count": len(rows),
        "limit": None if user.membership != "free" else FREE_SKILL_LIMIT,
        "confirmed_count": len([r for r in rows if r.confirmed]),
    }


@router.post("")
def create_or_update_skill(
    body: SkillUpsertIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        skill = upsert_skill(
            db,
            user,
            skill_name=body.skill_name,
            domain=body.domain,
            level=body.level,
            source="self_report",
            evidence=body.evidence or "用户自报",
            confirmed=True,
        )
        db.commit()
        db.refresh(skill)
        return {"ok": True, "skill": serialize_skill(skill)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/confirm")
def confirm_skills(
    body: SkillBatchConfirmIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not body.items:
        raise HTTPException(status_code=400, detail="empty items")
    out = []
    try:
        for item in body.items:
            skill = upsert_skill(
                db,
                user,
                skill_name=item.skill_name,
                domain=item.domain,
                level=item.level,
                source=item.source or "ai_suggest",
                evidence=item.evidence or "用户确认写入",
                confirmed=True,
                goal_id=item.goal_id,
                stage_id=item.stage_id,
            )
            out.append(serialize_skill(skill))
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "items": out, "count": skill_count(db, user.id)}


@router.get("/propose/{goal_id}")
def propose_for_goal(
    goal_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    goal = db.get(Goal, goal_id)
    if not goal or goal.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    return {"items": propose_skills_for_goal(db, user, goal)}


@router.delete("/{skill_id}")
def archive_skill(
    skill_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    skill = db.get(UserSkill, skill_id)
    if not skill or skill.user_id != user.id:
        raise HTTPException(status_code=404, detail="not found")
    skill.status = "archived"
    db.commit()
    return {"ok": True}


@router.get("/context")
def planning_context(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = list_confirmed_skills(db, user.id)
    return {
        "items": [serialize_skill(r) for r in rows],
        "summary": "、".join(f"{r.skill_name}({r.level})" for r in rows[:12]) or "暂无已确认技能",
    }


@router.get("/graph")
def skill_graph(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return build_skill_graph(db, user.id)


@router.get("/export")
def export_skills(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return export_skills_payload(db, user.id)
