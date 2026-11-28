from .timeutil import utc_now

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from .db import Base


class User(Base):
    __tablename__ = "zd_users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    openid = Column(String(64), unique=True, nullable=False, index=True)
    unionid = Column(String(64), default="")
    nickname = Column(String(64), default="学习者")
    membership = Column(String(16), default="free")
    membership_expires_at = Column(DateTime, nullable=True)
    daily_minutes_weekday = Column(Integer, default=60)
    daily_minutes_weekend = Column(Integer, default=120)
    subscribe_daily = Column(Integer, default=0)
    subscribe_weekly = Column(Integer, default=0)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class Goal(Base):
    __tablename__ = "zd_goals"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    title = Column(String(128), nullable=False)
    description = Column(Text, default="")
    goal_type = Column(String(32), default="generic")
    baseline = Column(String(255), default="")
    daily_minutes = Column(Integer, default=60)
    start_date = Column(String(10), default="")
    deadline = Column(String(10), default="")
    status = Column(String(24), default="planning", index=True)
    # 学习优先级：数字越小越优先（1 最高）；多目标排期按此顺序
    priority_rank = Column(Integer, default=100)
    completion_criteria = Column(Text, default="")
    resources_json = Column(Text, default="[]")  # 目标级学习推荐（外部资料指针）
    learning_path_json = Column(Text, default="{}")  # 学什么/框架/怎么学
    # 待确认草案：技能分类 + 模块清单（确认前不写阶段/任务/日历）
    # {"skill_categories":[...],"modules":[{key,name,skills,learn,difficulty,...}]}
    modules_json = Column(Text, default="{}")
    # 规划来源：market / langgraph / fallback / local（运营命中率）
    plan_source = Column(String(32), default="", index=True)
    # 来自技能市场时记录，用于去重（0=无）
    market_item_id = Column(Integer, default=0, index=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class GoalStage(Base):
    __tablename__ = "zd_goal_stages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    goal_id = Column(Integer, ForeignKey("zd_goals.id"), nullable=False, index=True)
    name = Column(String(128), nullable=False)
    sort_order = Column(Integer, default=0)
    status = Column(String(24), default="pending")
    # 规划时建议可跳过（用户确认页默认不勾选）
    skippable = Column(Integer, default=0)
    skip_reason = Column(String(255), default="")


class Task(Base):
    __tablename__ = "zd_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    goal_id = Column(Integer, ForeignKey("zd_goals.id"), nullable=False, index=True)
    stage_id = Column(Integer, ForeignKey("zd_goal_stages.id"), nullable=True, index=True)
    user_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    estimated_minutes = Column(Integer, default=30)
    priority = Column(String(16), default="normal")
    planned_date = Column(String(10), default="", index=True)
    status = Column(String(24), default="todo", index=True)
    defer_reason = Column(String(255), default="")
    depends_on_json = Column(Text, default="[]")  # 前置任务 id 列表 JSON
    resources_json = Column(Text, default="[]")  # 任务级学习推荐
    sort_order = Column(Integer, default=0)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class PlanVersion(Base):
    __tablename__ = "zd_plan_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    goal_id = Column(Integer, ForeignKey("zd_goals.id"), nullable=False, index=True)
    version = Column(Integer, default=1)
    reason = Column(String(255), default="")
    snapshot_json = Column(Text, default="")
    created_at = Column(DateTime, default=utc_now)


class GoalReview(Base):
    __tablename__ = "zd_goal_reviews"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    review_type = Column(String(16), default="weekly")
    range_start = Column(String(10), default="")
    range_end = Column(String(10), default="")
    payload_json = Column(Text, default="")
    created_at = Column(DateTime, default=utc_now)


class AiUsage(Base):
    __tablename__ = "zd_ai_usage"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    purpose = Column(String(64), default="")
    model = Column(String(128), default="")
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    # 1=接口返回的真实 usage；0=历史估算/缺失，不算入成本
    tokens_accurate = Column(Integer, default=0)
    created_at = Column(DateTime, default=utc_now)


class AiConversation(Base):
    __tablename__ = "zd_ai_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    role = Column(String(16), default="user")
    content = Column(Text, default="")
    created_at = Column(DateTime, default=utc_now)


class UserSkill(Base):
    """用户技能档案（与目标分离，跨目标复用）。"""

    __tablename__ = "zd_user_skills"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    skill_name = Column(String(64), nullable=False)
    domain = Column(String(32), default="其他")
    level = Column(Integer, default=1)
    status = Column(String(16), default="active")
    evidence = Column(Text, default="")
    source = Column(String(32), default="self_report")
    confirmed = Column(Integer, default=1)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class SkillEvidence(Base):
    __tablename__ = "zd_skill_evidence"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    skill_id = Column(Integer, ForeignKey("zd_user_skills.id"), nullable=True, index=True)
    goal_id = Column(Integer, default=0)
    stage_id = Column(Integer, default=0)
    task_id = Column(Integer, default=0)
    skill_name = Column(String(64), default="")
    from_level = Column(Integer, default=0)
    to_level = Column(Integer, default=1)
    source = Column(String(32), default="ai_suggest")
    note = Column(Text, default="")
    confirmed = Column(Integer, default=0)
    created_at = Column(DateTime, default=utc_now)


class MembershipOrder(Base):
    """会员订单（P1 支持开发态一键开通，正式支付后续接微信）。"""

    __tablename__ = "zd_membership_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    plan = Column(String(16), default="month")
    amount_cents = Column(Integer, default=1990)
    status = Column(String(16), default="paid")
    note = Column(String(255), default="")
    created_at = Column(DateTime, default=utc_now)


class SkillMarketItem(Base):
    """技能市场：可复用的普遍技能学习包（个人定制规划不入库）。"""

    __tablename__ = "zd_skill_market"

    id = Column(Integer, primary_key=True, autoincrement=True)
    skill_name = Column(String(64), nullable=False, index=True)  # 规范名，如 Python入门
    title = Column(String(128), nullable=False)  # 展示标题
    slug = Column(String(64), unique=True, nullable=False, index=True)
    domain = Column(String(32), default="generic", index=True)
    aliases_json = Column(Text, default="[]")  # 匹配别名
    keywords_json = Column(Text, default="[]")  # 搜索关键词
    skill_overview = Column(Text, default="")
    skill_scenarios_json = Column(Text, default="[]")
    skill_categories_json = Column(Text, default="[]")
    modules_json = Column(Text, default="{}")  # {modules:[...]} 或直接 modules 列表包装
    resources_json = Column(Text, default="[]")
    learning_path_json = Column(Text, default="{}")
    scope = Column(String(16), default="universal")  # universal only
    source = Column(String(32), default="seed")  # seed / llm / admin
    use_count = Column(Integer, default=0)
    # pending=待上线(LLM入库) / active=已上线 / offline=已下线
    status = Column(String(16), default="pending", index=True)
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class PlanTemplate(Base):
    """D：可分享的学习计划模板（复制成个人草案，不共享日历）。"""

    __tablename__ = "zd_plan_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    source_goal_id = Column(Integer, default=0)
    share_code = Column(String(16), unique=True, nullable=False, index=True)
    title = Column(String(128), nullable=False)
    description = Column(Text, default="")
    goal_type = Column(String(32), default="generic")
    modules_json = Column(Text, default="{}")
    learning_path_json = Column(Text, default="{}")
    resources_json = Column(Text, default="[]")
    use_count = Column(Integer, default=0)
    status = Column(String(16), default="active")  # active / archived
    created_at = Column(DateTime, default=utc_now)


class StudyGroup(Base):
    """A：学习打卡群（个人目标执行，群内只看进度）。"""

    __tablename__ = "zd_study_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    name = Column(String(64), nullable=False)
    topic = Column(String(128), default="")
    invite_code = Column(String(16), unique=True, nullable=False, index=True)
    max_members = Column(Integer, default=30)
    status = Column(String(16), default="active")
    created_at = Column(DateTime, default=utc_now)


class GroupMember(Base):
    __tablename__ = "zd_group_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(Integer, ForeignKey("zd_study_groups.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    role = Column(String(16), default="member")  # owner / member
    status = Column(String(16), default="active")
    joined_at = Column(DateTime, default=utc_now)


class GroupGoalLink(Base):
    """成员把自己的学习目标挂到群，供进度墙展示。"""

    __tablename__ = "zd_group_goal_links"

    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(Integer, ForeignKey("zd_study_groups.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("zd_users.id"), nullable=False, index=True)
    goal_id = Column(Integer, ForeignKey("zd_goals.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=utc_now)
