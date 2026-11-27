import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..models import Goal, GoalReview, Task, User, UserSkill
from ..workflows.fallback import today_str

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def _week_start(date_str: str) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d")
    day = d.isoweekday()
    start = d - timedelta(days=day - 1)
    return start.strftime("%Y-%m-%d")


def _add_days(date_str: str, n: int) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=n)
    return d.strftime("%Y-%m-%d")


@router.get("/daily")
def daily_review(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    day = today_str()
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.status != "cancelled",
            Task.planned_date == day,
        )
        .all()
    )
    done = [t for t in tasks if t.status == "done"]
    deferred = [t for t in tasks if t.status == "deferred" or t.defer_reason]
    todo = [t for t in tasks if t.status in ("todo", "doing")]
    rate = int(round(len(done) * 100 / len(tasks))) if tasks else 0
    minutes = sum(t.estimated_minutes or 0 for t in done)

    if not tasks:
        mood = "empty"
        advice = "今天还没有任务。创建或确认一个目标，让今日有明确下一步。"
    elif rate >= 100:
        mood = "great"
        advice = "今日计划已清完。可以提前看一眼明天，或打开技能档案巩固收获。"
    elif rate >= 60:
        mood = "ok"
        advice = "节奏不错。优先把剩余最高优先级任务做完，再考虑加码。"
    elif deferred:
        mood = "blocked"
        advice = "有延期项。记下原因后去做延期重规划，避免整日顺延堆积。"
    else:
        mood = "low"
        advice = "完成偏少。缩小今日范围：只保留一项必须完成的任务。"

    # 简易可视化：按小时桶不现实，改用完成/未完成/延期占比
    chart = {
        "done": len(done),
        "todo": len(todo),
        "deferred": len(deferred),
        "total": len(tasks),
    }

    payload = {
        "date": day,
        "completion_rate": rate,
        "done_count": len(done),
        "todo_count": len(todo),
        "deferred_count": len(deferred),
        "minutes": minutes,
        "mood": mood,
        "advice": advice,
        "chart": chart,
        "tasks": [
            {
                "id": t.id,
                "name": t.name,
                "status": t.status,
                "estimated_minutes": t.estimated_minutes,
                "goal_id": t.goal_id,
            }
            for t in tasks
        ],
    }
    db.query(GoalReview).filter(
        GoalReview.user_id == user.id,
        GoalReview.review_type == "daily",
        GoalReview.range_start == day,
        GoalReview.range_end == day,
    ).delete()
    db.add(
        GoalReview(
            user_id=user.id,
            review_type="daily",
            range_start=day,
            range_end=day,
            payload_json=json.dumps(payload, ensure_ascii=False),
        )
    )
    db.commit()
    return payload


@router.get("/weekly")
def weekly_review(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    end = today_str()
    start = _week_start(end)
    next_start = _add_days(end, 1)
    next_end = _add_days(end, 7)

    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.status != "cancelled",
            Task.planned_date >= start,
            Task.planned_date <= end,
        )
        .all()
    )
    done_tasks = [t for t in tasks if t.status == "done"]
    deferred = [t for t in tasks if t.defer_reason]
    minutes = sum(t.estimated_minutes or 0 for t in done_tasks)
    rate = int(round(len(done_tasks) * 100 / len(tasks))) if tasks else 0

    goals = (
        db.query(Goal)
        .filter(Goal.user_id == user.id, Goal.status.in_(["active", "planning"]))
        .all()
    )
    goal_stats = []
    for g in goals:
        gtasks = db.query(Task).filter(Task.goal_id == g.id, Task.status != "cancelled").all()
        gdone = len([t for t in gtasks if t.status == "done"])
        goal_stats.append(
            {
                "id": g.id,
                "title": g.title,
                "progress": int(round(gdone * 100 / len(gtasks))) if gtasks else 0,
            }
        )

    if not tasks:
        advice = "本周还没有排入任务。先创建并确认一个目标。"
    elif rate < 50:
        advice = "完成率偏低。建议减少每日任务量，或对未完成项做延期重规划。"
    elif len(deferred) > 2:
        advice = "延期较多。检查任务难度，必要时拆细。"
    elif rate >= 80:
        advice = "执行稳定。可适当提高下周挑战。"
    else:
        advice = "保持每日完成最重要的一项任务。"

    # 下周建议：未完成（含本周落下的）+ 已排在下周的任务
    pending = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.status.in_(["todo", "doing", "deferred"]),
        )
        .order_by(Task.planned_date.asc(), Task.sort_order.asc(), Task.id.asc())
        .all()
    )
    next_week_plan = []
    day_load: dict[str, int] = {}
    for t in pending:
        goal = db.get(Goal, t.goal_id)
        planned = t.planned_date or next_start
        if planned < next_start:
            # 落下的任务推到下周，按负载摊到较空的一天
            candidate = next_start
            for i in range(7):
                d = _add_days(next_start, i)
                if day_load.get(d, 0) < day_load.get(candidate, 0):
                    candidate = d
            planned = candidate
        if planned > next_end:
            continue
        mins = int(t.estimated_minutes or 30)
        day_load[planned] = day_load.get(planned, 0) + mins
        next_week_plan.append(
            {
                "task_id": t.id,
                "name": t.name,
                "goal_title": goal.title if goal else "",
                "planned_date": planned,
                "estimated_minutes": mins,
                "shifted": planned != (t.planned_date or planned),
            }
        )
        if len(next_week_plan) >= 21:
            break

    next_week_plan.sort(key=lambda x: (x["planned_date"], x["task_id"]))

    # 本期技能变化（本周更新的已确认技能）
    skill_rows = (
        db.query(UserSkill)
        .filter(
            UserSkill.user_id == user.id,
            UserSkill.status == "active",
            UserSkill.confirmed == 1,
            UserSkill.updated_at >= datetime.strptime(start, "%Y-%m-%d"),
        )
        .order_by(UserSkill.updated_at.desc())
        .all()
    )
    skill_changes = [
        {
            "skill_name": s.skill_name,
            "level": s.level,
            "domain": s.domain,
        }
        for s in skill_rows[:12]
    ]

    # 可视化：每日完成数
    day_chart = []
    for i in range(7):
        d = _add_days(start, i)
        if d > end:
            break
        day_tasks = [t for t in tasks if t.planned_date == d]
        day_done = [t for t in day_tasks if t.status == "done"]
        day_chart.append(
            {
                "date": d,
                "label": d[5:],
                "total": len(day_tasks),
                "done": len(day_done),
                "rate": int(round(len(day_done) * 100 / len(day_tasks))) if day_tasks else 0,
            }
        )

    payload = {
        "range_start": start,
        "range_end": end,
        "completion_rate": rate,
        "done_count": len(done_tasks),
        "deferred_count": len(deferred),
        "minutes": minutes,
        "goal_stats": goal_stats,
        "advice": advice,
        "skill_changes": skill_changes,
        "day_chart": day_chart,
        "next_week_range": {"start": next_start, "end": next_end},
        "next_week_plan": next_week_plan,
        "next_week_summary": (
            f"下周建议安排 {len(next_week_plan)} 项，合计约 {sum(i['estimated_minutes'] for i in next_week_plan)} 分钟。"
            if next_week_plan
            else "下周暂无待办，可创建新目标或确认现有计划。"
        ),
    }

    db.query(GoalReview).filter(
        GoalReview.user_id == user.id,
        GoalReview.review_type == "weekly",
        GoalReview.range_start == start,
        GoalReview.range_end == end,
    ).delete()
    db.add(
        GoalReview(
            user_id=user.id,
            review_type="weekly",
            range_start=start,
            range_end=end,
            payload_json=json.dumps(payload, ensure_ascii=False),
        )
    )
    db.commit()
    return payload
