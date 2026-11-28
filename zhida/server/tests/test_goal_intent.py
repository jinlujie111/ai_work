from app.workflows.goal_intent import classify_goal_intent


def test_keyword_rejects_travel_planning():
    r = classify_goal_intent("规划10天北京旅行")
    assert r["allow_llm"] is False


def test_keyword_passes_explicit_skill():
    r = classify_goal_intent("学 Python 数据分析")
    assert r["allow_llm"] is True
    assert r["intent"] == "learning"


def test_keyword_passes_loose_learning_word():
    # 第一关仍可能放过；第二关由 LLM 收紧
    r = classify_goal_intent("北京和天津进行学习")
    assert r["allow_llm"] is True
