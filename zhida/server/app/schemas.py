from typing import Literal

from pydantic import BaseModel, Field, field_validator


class DevLoginIn(BaseModel):
    device_id: str = Field(min_length=4, max_length=128)
    nickname: str = "学习者"


class WxLoginIn(BaseModel):
    code: str


class TokenOut(BaseModel):
    token: str
    user_id: int
    nickname: str
    membership: str


class PlanCreateIn(BaseModel):
    raw_text: str = Field(min_length=2, max_length=2000)
    baseline: str = ""
    daily_minutes: int | None = None


class GoalConfirmIn(BaseModel):
    confirm: bool = True
    # 勾选需要的模块 key（草案阶段）；确认后才展开任务并写入日历
    selected_module_keys: list[str] | None = None
    # 兼容旧客户端（已物化过阶段时）
    selected_stage_ids: list[int] | None = None
    # 多目标学习优先级：goal id 从高到低；确认后按此重排日历
    goal_priority_order: list[int] | None = None
    # 预览阶段去掉的任务 key（date|idx|name）
    drop_task_keys: list[str] | None = None


class GoalExpandPreviewIn(BaseModel):
    selected_module_keys: list[str] = Field(min_length=1)


class GoalPriorityIn(BaseModel):
    ordered_goal_ids: list[int] = Field(min_length=1)


class GoalPauseIn(BaseModel):
    """暂停目标。rebalance=true 时按剩余进行中目标重排日历。"""

    rebalance: bool = False


class GoalResumeIn(BaseModel):
    """恢复为目标进行中。rebalance=true 时把未完成任务重新铺进日历。"""

    rebalance: bool = False


TaskStatusLiteral = Literal["todo", "doing", "done", "deferred", "cancelled"]
TaskPriorityLiteral = Literal["high", "normal", "low"]


class TaskStatusIn(BaseModel):
    status: TaskStatusLiteral


class TaskUpdateIn(BaseModel):
    planned_date: str | None = None
    name: str | None = None
    description: str | None = None
    estimated_minutes: int | None = None
    status: TaskStatusLiteral | None = None
    priority: TaskPriorityLiteral | None = None


class TaskCreateIn(BaseModel):
    goal_id: int
    name: str = Field(min_length=1, max_length=255)
    planned_date: str | None = None
    estimated_minutes: int = 30
    description: str = ""
    priority: str = "normal"


class TaskQuickCreateIn(BaseModel):
    """Todoist 式快速添加：不绑学习目标拆解，不触发冲突重排。"""

    name: str = Field(min_length=1, max_length=255)
    planned_date: str | None = None
    estimated_minutes: int = 25
    description: str = ""
    priority: str = "normal"


class ReplanDraftIn(BaseModel):
    goal_id: int
    unfinished_task_ids: list[int]
    reason: str = "临时没时间"
    note: str = ""


class ReplanTaskPatch(BaseModel):
    id: int
    planned_date: str | None = None
    estimated_minutes: int | None = None
    description: str | None = None
    status: TaskStatusLiteral | None = None
    name: str | None = None
    defer_reason: str | None = None

    @field_validator("planned_date")
    @classmethod
    def _check_date(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return v
        import re

        if not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
            raise ValueError("planned_date must be YYYY-MM-DD")
        return v


class ReplanApplyIn(BaseModel):
    goal_id: int
    reason: str
    unfinished_task_ids: list[int] = []
    tasks: list[ReplanTaskPatch] = Field(min_length=1)


class AssistantIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
