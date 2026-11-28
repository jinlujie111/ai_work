"""系统级意图硬限制：只允许「学习技能类」，禁止旅行/日常规划等。

流程：用户输入
  1) classify_goal_intent（关键词硬拦截，不调 LLM）
  2) 关键词通过后 → assert_learning_intent_llm（LLM 二次判断）
  3) 两关都过 → 才进市场匹配 / 技能拆解
"""

from __future__ import annotations

import json
import re

INTENT_LEARNING = "learning"
INTENT_REJECT = "reject"

REJECT_MSG = (
    "当前系统仅支持「学习技能类」目标，不支持旅行、办事、日常事务规划等。"
    "请改成例如：学 Python 数据分析、练雅思口语、备考科目一、入门力量训练。"
)

_INTENT_LLM_SYSTEM = """你是学习目标意图审核员。只判断用户输入是否为「可拆解的学习技能/课题」，输出 JSON：
{"accepted": true|false, "intent": "learning_skill"|"reject", "reason": "简短中文原因"}

判定规则：
1. accepted=true 仅当：明确要学某项技能/知识/考试/训练（如 Python、雅思口语、科目一、力量训练、摄影构图）。
2. accepted=false 当：旅行/出行/办事/日常安排、地点打卡、空泛「去某地学习」却无具体技能、闲聊、工具指令、纯规划行程。
3. 仅含「学/学习」但对象是城市/旅行/办事，不算学习技能。
4. 不要生成学习计划或模块，只做意图裁决。"""

# 闲聊 / 工具指令
_HARD_REJECT = re.compile(
    r"(今天|明天|外面)?.{0,4}(天气|气温|下雨|下雪|几度)|"
    r"外卖|点餐|点个|讲个笑话|你是谁|在吗|^你好啊?$|^嗨$|^哈喽$|"
    r"帮我点|开灯|关机|播放音乐|查一下股价",
    re.I,
)

# 规划 / 非学习事务（硬剔除；即使带「安排」「准备」也不放行，除非同时命中学习技能线索）
_PLANNING_OR_ERRAND = re.compile(
    r"(规划|计划(?!书)|安排行程|行程|攻略|"
    r"旅行|旅游|出行|度假|自驾|机票|酒店|"
    r"婚礼|搬家|装修|订餐|购物清单|理财炒股|看球赛|"
    r"办事|报名缴费|签证(?!口语))",
    re.I,
)

# 学习技能类硬线索（必须命中才放行）
_LEARNING_SKILL = re.compile(
    r"(学|学习|学会|掌握|提升|入门|进阶|练习|备考|考证|技能|课程|训练|"
    r"练琴|健身|英语|英文|编程|代码|python|java|javascript|typescript|go语言|"
    r"excel|ppt|ai|人工智能|机器学习|深度学习|大模型|算法|数据结构|"
    r"阅读|写作|考研|雅思|托福|科目[一二]|驾照理论|刷题|背单词|"
    r"听力|口语|乐理|画画|素描|摄影|剪辑|设计|前端|后端|数据分析|"
    r"钢琴|吉他|游泳|跑步训练|力量训练|减脂|增肌|"
    r"how\s*to|tutorial|learn)",
    re.I,
)


def classify_goal_intent(raw_text: str) -> dict:
    """本地意图识别，不调用 LLM。"""
    text = (raw_text or "").strip()
    if len(text) < 2:
        return {
            "intent": INTENT_REJECT,
            "label": "empty",
            "reason": "请先描述你想学的技能或课题",
            "allow_llm": False,
        }

    has_learning = bool(_LEARNING_SKILL.search(text))
    has_planning = bool(_PLANNING_OR_ERRAND.search(text))

    if _HARD_REJECT.search(text) and not has_learning:
        return {
            "intent": INTENT_REJECT,
            "label": "chitchat_or_utility",
            "reason": REJECT_MSG,
            "allow_llm": False,
        }

    # 规划类硬剔除（句式以规划/计划/安排起头 → 一律拒绝）
    if re.match(r"^(规划|计划|安排)", text):
        return {
            "intent": INTENT_REJECT,
            "label": "planning_primary",
            "reason": REJECT_MSG,
            "allow_llm": False,
        }

    # 含规划/旅行/办事等且没有学习技能线索 → 拒绝
    # 「学旅行摄影」有学+摄影 → 可过；「规划10天旅行」→ 拒绝
    if has_planning and not has_learning:
        return {
            "intent": INTENT_REJECT,
            "label": "planning_not_learning",
            "reason": REJECT_MSG,
            "allow_llm": False,
        }

    if has_learning:
        return {
            "intent": INTENT_LEARNING,
            "label": "learning_skill",
            "reason": "",
            "allow_llm": True,
        }

    return {
        "intent": INTENT_REJECT,
        "label": "not_learning_skill",
        "reason": REJECT_MSG,
        "allow_llm": False,
    }


def assert_learning_intent(raw_text: str) -> dict:
    """第一关：关键词硬拦截。未通过则抛 ValueError，不调 LLM。"""
    result = classify_goal_intent(raw_text)
    if result.get("intent") != INTENT_LEARNING or not result.get("allow_llm"):
        raise ValueError(result.get("reason") or REJECT_MSG)
    return result


async def assert_learning_intent_llm(raw_text: str) -> tuple[dict, dict]:
    """第二关：LLM 二次意图判断。未通过抛 ValueError；返回 (裁决, usage_meta)。"""
    from ..llm import LLMError, chat_json

    text = (raw_text or "").strip()
    user = json.dumps({"raw_text": text}, ensure_ascii=False)
    try:
        data, meta = await chat_json(
            _INTENT_LLM_SYSTEM,
            user,
            purpose="goal_intent",
            max_tokens=256,
            temperature=0,
        )
    except LLMError as exc:
        raise ValueError("意图复核暂时失败，请稍后重试") from exc

    accepted = data.get("accepted")
    intent = str(data.get("intent") or "").strip().lower()
    reason = (data.get("reason") or "").strip() or REJECT_MSG

    ok = accepted is True or (
        isinstance(accepted, str) and accepted.strip().lower() in {"true", "1", "yes", "y"}
    )
    if intent in {"reject", "rejected", "not_learning", "planning", "travel", "chitchat"}:
        ok = False
    if intent and intent not in {"learning_skill", "learning", "create_goal"} and accepted is not True:
        ok = False

    if not ok:
        raise ValueError(reason[:200] or REJECT_MSG)

    return {
        "intent": INTENT_LEARNING,
        "label": "learning_skill_llm",
        "reason": "",
        "allow_llm": True,
        "llm_intent": intent or "learning_skill",
    }, meta


def assert_learning_goal_text(raw_text: str) -> None:
    assert_learning_intent(raw_text)


def is_llm_rejected(data: dict | None) -> str | None:
    """LLM 二次保险。"""
    if not isinstance(data, dict):
        return None
    accepted = data.get("accepted")
    if accepted is False:
        return (data.get("reject_reason") or REJECT_MSG).strip()[:200] or REJECT_MSG
    if isinstance(accepted, str) and accepted.strip().lower() in {"false", "0", "no", "n"}:
        return (data.get("reject_reason") or REJECT_MSG).strip()[:200] or REJECT_MSG
    intent = str(data.get("intent") or "").strip().lower()
    if intent in {
        "reject",
        "rejected",
        "chitchat",
        "non_goal",
        "not_learning",
        "travel",
        "planning",
    }:
        return (data.get("reject_reason") or REJECT_MSG).strip()[:200] or REJECT_MSG
    if data.get("reject_reason") and not (data.get("modules") or data.get("title")):
        return str(data.get("reject_reason")).strip()[:200] or REJECT_MSG
    return None
