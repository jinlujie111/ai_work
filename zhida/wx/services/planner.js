/**
 * P0 本地规划器：结构化拆解，不调用云端模型。
 * 后端 LangGraph 接入后，用同一 JSON 形状替换本模块输出。
 */
const { createId } = require('./id');

function addDays(dateStr, n) {
  const d = new Date(dateStr.replace(/-/g, '/'));
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function detectTemplate(text) {
  const t = (text || '').toLowerCase();
  if (/python|数据分析|编程|代码/.test(t)) return 'python';
  if (/英语|english|托福|雅思|口语/.test(t)) return 'english';
  if (/健身|跑步|运动|减脂|力量/.test(t)) return 'fitness';
  return 'generic';
}

const TEMPLATES = {
  python: [
    {
      name: 'Python 基础',
      tasks: ['变量与数据类型', '条件与循环', '函数与模块', '完成基础练习']
    },
    {
      name: '数据处理',
      tasks: ['学习 NumPy 基础', '学习 Pandas 读写', '数据清洗练习']
    },
    {
      name: '分析与可视化',
      tasks: ['基础统计', 'matplotlib 可视化', '完成一个小案例']
    },
    {
      name: '项目实践',
      tasks: ['选定数据集', '清洗并分析', '输出可视化报告']
    }
  ],
  english: [
    {
      name: '输入积累',
      tasks: ['每日听力 20 分钟', '精读一篇短文', '整理生词本']
    },
    {
      name: '输出练习',
      tasks: ['跟读与影子跟读', '写 80 词短段落', '口语自述 3 分钟']
    },
    {
      name: '阶段检验',
      tasks: ['模考听力一节', '模考阅读一节', '复盘错题']
    }
  ],
  fitness: [
    {
      name: '启动适应',
      tasks: ['评估当前体能', '制定训练日', '完成 2 次低强度有氧']
    },
    {
      name: '习惯巩固',
      tasks: ['力量训练入门', '拉伸与恢复', '记录饮食与睡眠']
    },
    {
      name: '强度提升',
      tasks: ['增加一组力量', '一次中等强度有氧', '周复盘身体感受']
    }
  ],
  generic: [
    {
      name: '摸清现状',
      tasks: ['写下完成标准', '盘点已有基础', '列出可用时间']
    },
    {
      name: '建立节奏',
      tasks: ['拆出本周最小行动', '完成第一次练习', '记录卡点']
    },
    {
      name: '推进交付',
      tasks: ['完成一个可展示结果', '请人反馈或自检', '调整下周计划']
    }
  ]
};

function extractMinutes(text, fallback) {
  const m = (text || '').match(/每天.*?(\d+)\s*小时/) || (text || '').match(/每天.*?(\d+)\s*分钟/);
  if (!m) return fallback;
  if (/小时/.test(m[0])) return Number(m[1]) * 60;
  return Number(m[1]);
}

function extractDays(text, fallback) {
  const m = (text || '').match(/(\d+)\s*天/);
  return m ? Number(m[1]) : fallback;
}

/**
 * @param {object} input
 * @param {string} input.rawText
 * @param {string} [input.title]
 * @param {string} [input.baseline]
 * @param {number} [input.dailyMinutes]
 * @param {number} [input.totalDays]
 */
function buildPlanDraft(input) {
  const rawText = input.rawText || '';
  const templateKey = detectTemplate(rawText);
  const stagesDef = TEMPLATES[templateKey];
  const dailyMinutes = input.dailyMinutes || extractMinutes(rawText, 60);
  const totalDays = input.totalDays || extractDays(rawText, 60);
  const start = todayStr();
  const deadline = addDays(start, totalDays);
  const title =
    input.title ||
    rawText.split(/[，。,\n]/)[0].slice(0, 24) ||
    '未命名目标';

  const goalId = createId('goal');
  const stages = [];
  const tasks = [];
  let dayCursor = 0;
  let order = 0;

  stagesDef.forEach((stageDef, si) => {
    const stageId = createId('stage');
    stages.push({
      id: stageId,
      goalId,
      name: stageDef.name,
      order: si,
      status: 'pending'
    });

    stageDef.tasks.forEach((taskName, ti) => {
      const plannedDate = addDays(start, dayCursor);
      // 简单负载：每天约 1 个主任务；周末可叠一天
      dayCursor += 1;
      if (dayCursor >= totalDays) dayCursor = totalDays - 1;
      tasks.push({
        id: createId('task'),
        goalId,
        stageId,
        name: taskName,
        description: `${stageDef.name} · ${taskName}`,
        estimatedMinutes: Math.min(dailyMinutes, 60),
        priority: ti === 0 ? 'high' : 'normal',
        plannedDate,
        status: 'todo',
        order: order++,
        skillHint: templateKey === 'generic' ? '' : templateKey
      });
    });
  });

  const goal = {
    id: goalId,
    title,
    description: rawText,
    type: templateKey,
    baseline: input.baseline || '未说明',
    dailyMinutes,
    startDate: start,
    deadline,
    status: 'planning',
    completionCriteria: input.completionCriteria || '按阶段完成全部任务并达到自定完成标准',
    createdAt: new Date().toISOString()
  };

  return {
    goal,
    stages,
    tasks,
    analysis: {
      templateKey,
      reason: `按「${templateKey}」模板拆成 ${stages.length} 个阶段、${tasks.length} 个任务；每日约 ${dailyMinutes} 分钟，截止 ${deadline}。`,
      warnings: totalDays < tasks.length ? ['任务天数偏紧，确认后可再缩短单日任务或延长周期。'] : []
    }
  };
}

/**
 * 延期重规划：未完成任务后移，拆分过大任务；保留截止日若仍可行。
 */
function buildReplanDraft({ goal, stages, tasks, unfinishedTaskIds, reason }) {
  const start = todayStr();
  const nextTasks = tasks.map((t) => Object.assign({}, t));
  const moved = [];

  unfinishedTaskIds.forEach((id, idx) => {
    const task = nextTasks.find((x) => x.id === id);
    if (!task) return;
    if (task.status === 'done') return;

    const newDate = addDays(start, 1 + idx);
    if (task.estimatedMinutes > 45) {
      task.estimatedMinutes = Math.ceil(task.estimatedMinutes / 2);
      task.description = `${task.description}（已拆半，降低单日负担）`;
    }
    task.plannedDate = newDate;
    if (task.status === 'deferred' || task.status === 'todo') {
      task.status = 'todo';
    }
    moved.push({ id: task.id, name: task.name, to: newDate });
  });

  // 已排在过去且未完成的任务一并推到明日之后
  nextTasks.forEach((t) => {
    if (t.status === 'done' || t.status === 'cancelled') return;
    if (t.plannedDate < start && unfinishedTaskIds.indexOf(t.id) === -1) {
      t.plannedDate = addDays(start, 1);
      moved.push({ id: t.id, name: t.name, to: t.plannedDate });
    }
  });

  return {
    goal,
    stages,
    tasks: nextTasks,
    analysis: {
      reason: reason || '执行出现偏差',
      summary: `未完成任务已后移并降低单日负担；目标截止日仍为 ${goal.deadline}。`,
      moved
    }
  };
}

module.exports = {
  todayStr,
  addDays,
  buildPlanDraft,
  buildReplanDraft,
  detectTemplate
};
