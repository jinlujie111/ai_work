/**
 * 本地持久化（P0）。后端就绪后由 request 层替换读写，界面可保持不变。
 */
const STORAGE_KEY = 'zhida_v1';

const EMPTY = {
  user: {
    nickname: '学习者',
    dailyMinutesWeekday: 60,
    dailyMinutesWeekend: 120,
    membership: 'free'
  },
  goals: [],
  stages: [],
  tasks: [],
  planVersions: [],
  reviews: [],
  conversations: []
};

function read() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(EMPTY));
    return Object.assign(JSON.parse(JSON.stringify(EMPTY)), raw);
  } catch (e) {
    return JSON.parse(JSON.stringify(EMPTY));
  }
}

function write(state) {
  wx.setStorageSync(STORAGE_KEY, state);
  return state;
}

function update(mutator) {
  const state = read();
  mutator(state);
  return write(state);
}

function getActiveGoals() {
  return read().goals.filter((g) => g.status === 'active' || g.status === 'planning');
}

function getGoalBundle(goalId) {
  const state = read();
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) return null;
  const stages = state.stages
    .filter((s) => s.goalId === goalId)
    .sort((a, b) => a.order - b.order);
  const tasks = state.tasks
    .filter((t) => t.goalId === goalId)
    .sort((a, b) => (a.plannedDate || '').localeCompare(b.plannedDate || '') || a.order - b.order);
  return { goal, stages, tasks, state };
}

function getTodayTasks(dateStr) {
  const state = read();
  return state.tasks
    .filter((t) => t.plannedDate === dateStr && t.status !== 'cancelled')
    .sort((a, b) => a.order - b.order)
    .map((t) => {
      const goal = state.goals.find((g) => g.id === t.goalId);
      return Object.assign({}, t, { goalTitle: goal ? goal.title : '' });
    });
}

function countActiveGoals() {
  return read().goals.filter((g) => g.status === 'active' || g.status === 'planning').length;
}

module.exports = {
  STORAGE_KEY,
  read,
  write,
  update,
  getActiveGoals,
  getGoalBundle,
  getTodayTasks,
  countActiveGoals
};
