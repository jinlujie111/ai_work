/** 系统硬限制：仅学习技能类；规划/旅行等一律剔除（与服务端对齐，不调 LLM） */

const HARD_REJECT =
  /(今天|明天|外面)?.{0,4}(天气|气温|下雨|下雪|几度)|外卖|点餐|点个|讲个笑话|你是谁|在吗|^你好啊?$|^嗨$|^哈喽$|帮我点|开灯|关机|播放音乐|查一下股价/i;

const PLANNING_OR_ERRAND =
  /(规划|计划(?!书)|安排行程|行程|攻略|旅行|旅游|出行|度假|自驾|机票|酒店|婚礼|搬家|装修|订餐|购物清单|理财炒股|看球赛|办事|报名缴费)/i;

const LEARNING_SKILL =
  /(学|学习|学会|掌握|提升|入门|进阶|练习|备考|考证|技能|课程|训练|练琴|健身|英语|英文|编程|代码|python|java|javascript|typescript|go语言|excel|ppt|ai|人工智能|机器学习|深度学习|大模型|算法|数据结构|阅读|写作|考研|雅思|托福|科目[一二]|驾照理论|刷题|背单词|听力|口语|乐理|画画|素描|摄影|剪辑|设计|前端|后端|数据分析|钢琴|吉他|游泳|跑步训练|力量训练|减脂|增肌|how\s*to|tutorial|learn)/i;

const REJECT_MSG =
  '当前系统仅支持「学习技能类」目标，不支持旅行、办事、日常事务规划等。请改成例如：学 Python 数据分析、练雅思口语、备考科目一。';

function classifyGoalIntent(text) {
  const t = String(text || '').trim();
  if (t.length < 2) {
    return { intent: 'reject', allow_llm: false, reason: '请先描述你想学的技能或课题' };
  }
  const hasLearning = LEARNING_SKILL.test(t);
  const hasPlanning = PLANNING_OR_ERRAND.test(t);

  if (HARD_REJECT.test(t) && !hasLearning) {
    return { intent: 'reject', allow_llm: false, reason: REJECT_MSG };
  }
  if (/^(规划|计划|安排)/.test(t)) {
    return { intent: 'reject', allow_llm: false, reason: REJECT_MSG };
  }
  if (hasPlanning && !hasLearning) {
    return { intent: 'reject', allow_llm: false, reason: REJECT_MSG };
  }
  if (hasLearning) {
    return { intent: 'learning', allow_llm: true, reason: '' };
  }
  return { intent: 'reject', allow_llm: false, reason: REJECT_MSG };
}

function isNonLearningGoal(text) {
  return !classifyGoalIntent(text).allow_llm;
}

module.exports = {
  REJECT_MSG,
  classifyGoalIntent,
  isNonLearningGoal
};
