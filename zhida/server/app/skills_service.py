"""技能档案读写与候选建议。未确认技能不得用于跳过阶段。"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from .models import Goal, GoalStage, SkillEvidence, Task, User, UserSkill
from .timeutil import utc_now

LEVEL_LABELS = {0: "未知", 1: "入门", 2: "会用", 3: "熟练", 4: "能教人"}
FREE_SKILL_LIMIT = 20


def serialize_skill(s: UserSkill) -> dict:
    return {
        "id": s.id,
        "skill_name": s.skill_name,
        "domain": s.domain,
        "level": int(s.level or 0),
        "level_label": LEVEL_LABELS.get(int(s.level or 0), "未知"),
        "status": s.status,
        "evidence": s.evidence or "",
        "source": s.source,
        "confirmed": bool(s.confirmed),
        "updated_at": s.updated_at.isoformat() if s.updated_at else "",
    }


def list_confirmed_skills(db: Session, user_id: int) -> list[UserSkill]:
    return (
        db.query(UserSkill)
        .filter(
            UserSkill.user_id == user_id,
            UserSkill.status == "active",
            UserSkill.confirmed == 1,
        )
        .order_by(UserSkill.updated_at.desc())
        .all()
    )


def skills_context_for_plan(db: Session, user_id: int) -> list[dict]:
    rows = list_confirmed_skills(db, user_id)
    return [
        {
            "skill_name": r.skill_name,
            "domain": r.domain,
            "level": int(r.level or 0),
            "level_label": LEVEL_LABELS.get(int(r.level or 0), "未知"),
        }
        for r in rows
    ]


def skill_count(db: Session, user_id: int) -> int:
    return (
        db.query(UserSkill)
        .filter(UserSkill.user_id == user_id, UserSkill.status == "active")
        .count()
    )


def upsert_skill(
    db: Session,
    user: User,
    *,
    skill_name: str,
    domain: str = "其他",
    level: int = 1,
    source: str = "self_report",
    evidence: str = "",
    confirmed: bool = True,
    goal_id: int = 0,
    stage_id: int = 0,
    task_id: int = 0,
) -> UserSkill:
    name = (skill_name or "").strip()
    if not name:
        raise ValueError("skill_name required")
    level = max(0, min(4, int(level)))
    existing = (
        db.query(UserSkill)
        .filter(
            UserSkill.user_id == user.id,
            UserSkill.skill_name == name,
            UserSkill.status == "active",
        )
        .first()
    )
    if not existing and user.membership == "free" and skill_count(db, user.id) >= FREE_SKILL_LIMIT:
        raise ValueError(f"免费用户技能档案最多 {FREE_SKILL_LIMIT} 条，开通会员可无限")

    from_level = int(existing.level) if existing else 0
    if existing:
        if level < existing.level and source != "self_report":
            # AI/证据建议不自动降级
            level = int(existing.level)
        existing.level = level
        existing.domain = domain or existing.domain
        existing.source = source
        if evidence:
            existing.evidence = evidence
        existing.confirmed = 1 if confirmed else 0
        existing.updated_at = utc_now()
        skill = existing
    else:
        skill = UserSkill(
            user_id=user.id,
            skill_name=name,
            domain=domain or "其他",
            level=level,
            status="active",
            evidence=evidence,
            source=source,
            confirmed=1 if confirmed else 0,
        )
        db.add(skill)
        db.flush()

    db.add(
        SkillEvidence(
            user_id=user.id,
            skill_id=skill.id,
            goal_id=goal_id,
            stage_id=stage_id,
            task_id=task_id,
            skill_name=name,
            from_level=from_level,
            to_level=level,
            source=source,
            note=evidence,
            confirmed=1 if confirmed else 0,
        )
    )
    db.flush()
    return skill


def _primary_skill_for_goal(goal: Goal) -> tuple[str, str, int]:
    """返回 (domain, 主技能名, 基础等级)。阶段名不再单独成技能。"""
    domain_map = {
        "python": ("技术", "Python", 2),
        "english": ("语言", "英语", 2),
        "fitness": ("运动", "体能训练", 2),
    }
    mapped = domain_map.get((goal.goal_type or "").strip().lower())
    if mapped:
        return mapped
    # 无类型时：用较短目标名作主技能，避免把整句目标塞进档案
    title = (goal.title or "").strip() or "未命名技能"
    name = title[:20]
    return ("其他", name, 2)


def propose_skills_for_goal(db: Session, user: User, goal: Goal) -> list[dict]:
    """阶段/目标完成时生成待确认技能候选（不落库）。

    只提议「主技能」一条；已完成阶段写入证据说明，不再把阶段名拆成多个技能。
    """
    stages = (
        db.query(GoalStage)
        .filter(GoalStage.goal_id == goal.id)
        .order_by(GoalStage.sort_order.asc())
        .all()
    )
    done_stages = [s for s in stages if s.status == "done"]
    if not done_stages and goal.status != "done":
        return []

    tasks = db.query(Task).filter(Task.goal_id == goal.id, Task.status == "done").all()
    domain, skill_name, base_level = _primary_skill_for_goal(goal)

    goal_done = goal.status == "done" or (stages and len(done_stages) == len(stages) and len(stages) > 0)
    level = base_level
    if goal_done:
        level = min(4, base_level + (1 if len(tasks) >= 8 else 0) + 1)
    elif len(done_stages) >= 2:
        level = min(4, base_level + 1)

    stage_bits = [((s.name or "").strip() or "阶段")[:18] for s in done_stages[:6]]
    if goal_done:
        reason = f"完成目标「{goal.title}」"
        if stage_bits:
            reason += f"；阶段：{'、'.join(stage_bits)}"
    else:
        reason = f"目标「{goal.title}」已完成 {len(done_stages)}/{len(stages) or len(done_stages)} 阶段"
        if stage_bits:
            reason += f"：{'、'.join(stage_bits)}"

    existing = {r.skill_name: r for r in list_confirmed_skills(db, user.id)}
    cur = existing.get(skill_name)
    return [
        {
            "skill_name": skill_name,
            "domain": domain,
            "suggested_level": level,
            "reason": reason,
            "goal_id": goal.id,
            "stage_id": 0,
            "current_level": int(cur.level) if cur else 0,
            "current_level_label": LEVEL_LABELS.get(int(cur.level) if cur else 0, "未知"),
            "suggested_level_label": LEVEL_LABELS.get(level, "入门"),
        }
    ]


def mark_stage_progress(db: Session, goal_id: int) -> list[GoalStage]:
    """根据任务完成情况刷新阶段状态。"""
    stages = (
        db.query(GoalStage)
        .filter(GoalStage.goal_id == goal_id)
        .order_by(GoalStage.sort_order.asc())
        .all()
    )
    newly_done = []
    for s in stages:
        tasks = db.query(Task).filter(Task.stage_id == s.id, Task.status != "cancelled").all()
        if not tasks:
            continue
        if all(t.status == "done" for t in tasks):
            if s.status != "done":
                s.status = "done"
                newly_done.append(s)
        elif any(t.status == "done" for t in tasks):
            if s.status != "done":
                s.status = "doing"
        else:
            if s.status not in ("done",):
                s.status = "pending"
    return newly_done


def maybe_complete_goal(db: Session, goal: Goal) -> bool:
    stages = db.query(GoalStage).filter(GoalStage.goal_id == goal.id).all()
    if stages and all(s.status == "done" for s in stages):
        if goal.status != "done":
            goal.status = "done"
            return True
    else:
        tasks = db.query(Task).filter(Task.goal_id == goal.id, Task.status != "cancelled").all()
        if tasks and all(t.status == "done" for t in tasks) and goal.status != "done":
            goal.status = "done"
            return True
    return False


def skills_digest_json(skills: list[dict]) -> str:
    return json.dumps(skills, ensure_ascii=False)


def build_skill_graph(db: Session, user_id: int) -> dict:
    """按领域聚类的简易技能图谱（节点 + 同域边）。"""
    rows = list_confirmed_skills(db, user_id)
    nodes = [
        {
            "id": r.id,
            "name": r.skill_name,
            "domain": r.domain or "其他",
            "level": int(r.level or 0),
            "level_label": LEVEL_LABELS.get(int(r.level or 0), "未知"),
        }
        for r in rows
    ]
    by_domain: dict[str, list[dict]] = {}
    for n in nodes:
        by_domain.setdefault(n["domain"], []).append(n)
    edges = []
    for domain, group in by_domain.items():
        for i in range(len(group) - 1):
            edges.append(
                {
                    "from": group[i]["id"],
                    "to": group[i + 1]["id"],
                    "relation": "same_domain",
                    "domain": domain,
                }
            )
        # 高等级指向低等级同域（示意传承）
        ranked = sorted(group, key=lambda x: x["level"], reverse=True)
        if len(ranked) >= 2 and ranked[0]["level"] >= 3:
            edges.append(
                {
                    "from": ranked[0]["id"],
                    "to": ranked[1]["id"],
                    "relation": "can_mentor",
                    "domain": domain,
                }
            )
    return {
        "nodes": nodes,
        "edges": edges,
        "domains": [
            {"name": d, "count": len(g), "avg_level": round(sum(x["level"] for x in g) / len(g), 1)}
            for d, g in by_domain.items()
        ],
    }


def export_skills_payload(db: Session, user_id: int) -> dict:
    rows = (
        db.query(UserSkill)
        .filter(UserSkill.user_id == user_id, UserSkill.status == "active")
        .order_by(UserSkill.domain.asc(), UserSkill.skill_name.asc())
        .all()
    )
    return {
        "exported_at": utc_now().isoformat() + "Z",
        "count": len(rows),
        "skills": [serialize_skill(r) for r in rows],
    }
