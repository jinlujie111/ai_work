"""学习群（A）+ 计划模板分享（D）—— 薄路由，业务在 groups_service。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import groups_service as svc
from ..auth import get_current_user
from ..db import get_db
from ..models import User

router = APIRouter(prefix="/api/groups", tags=["groups"])
templates_router = APIRouter(prefix="/api/templates", tags=["templates"])
goal_share_router = APIRouter(prefix="/api/goals", tags=["goal-templates"])


class PublishTemplateIn(BaseModel):
    title: str | None = None


class CloneTemplateIn(BaseModel):
    share_code: str = Field(min_length=4, max_length=16)
    baseline: str = ""


class CreateGroupIn(BaseModel):
    name: str = Field(min_length=2, max_length=64)
    topic: str = ""


class JoinGroupIn(BaseModel):
    invite_code: str = Field(min_length=4, max_length=16)


class LinkGoalIn(BaseModel):
    goal_id: int


@goal_share_router.post("/{goal_id}/share-template")
def publish_template(
    goal_id: int,
    body: PublishTemplateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.publish_template(db, user, goal_id, body.title)


@templates_router.get("/{share_code}")
def get_template(share_code: str, db: Session = Depends(get_db)):
    return svc.get_template(db, share_code)


@templates_router.post("/clone")
def clone_template(
    body: CloneTemplateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.clone_template(db, user, body.share_code, body.baseline)


@router.get("")
def list_my_groups(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return svc.list_my_groups(db, user)


@router.post("")
def create_group(
    body: CreateGroupIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.create_group(db, user, body.name, body.topic)


@router.post("/join")
def join_group(
    body: JoinGroupIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.join_group(db, user, body.invite_code)


@router.get("/{group_id}")
def group_detail(
    group_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.group_detail(db, user, group_id)


@router.post("/{group_id}/link-goal")
def link_goal(
    group_id: int,
    body: LinkGoalIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.link_goal(db, user, group_id, body.goal_id)


@router.post("/{group_id}/leave")
def leave_group(
    group_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.leave_group(db, user, group_id)
