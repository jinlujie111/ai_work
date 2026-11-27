from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import User
from ..schemas import ReplanApplyIn, ReplanDraftIn
from ..workflows.replan import apply_replan, generate_replan_draft

router = APIRouter(prefix="/api/plans", tags=["plans"])


@router.post("/replan-draft")
async def replan_draft(
    body: ReplanDraftIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reason = body.reason
    if body.note:
        reason = f"{body.reason}：{body.note}"
    try:
        return await generate_replan_draft(
            db,
            user,
            goal_id=body.goal_id,
            unfinished_task_ids=body.unfinished_task_ids,
            reason=reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/replan-apply")
def replan_apply(
    body: ReplanApplyIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return apply_replan(
            db,
            user,
            goal_id=body.goal_id,
            tasks_payload=[t.model_dump(exclude_none=True) for t in body.tasks],
            reason=body.reason,
            unfinished_task_ids=body.unfinished_task_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
