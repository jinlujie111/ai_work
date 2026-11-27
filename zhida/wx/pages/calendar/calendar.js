const api = require('../../services/api');
const { confirmSkillProposals } = require('../../utils/skills');

function mapTask(t) {
  const resources = (t.resources || []).map((r) => ({
    title: r.title || '学习材料',
    note: r.note || r.desc || '',
    url: r.url || ''
  }));
  const priority = (t.priority || 'normal').toLowerCase();
  const priorityLabel =
    priority === 'high' ? '高优' : priority === 'low' ? '可延后' : '';
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    estimatedMinutes: t.estimated_minutes,
    goalTitle: t.goal_title,
    goalId: t.goal_id,
    stageNo: t.stage_no || 0,
    stageTotal: t.stage_total || 0,
    stageName: t.stage_name || '',
    learnContent: t.learn_content || '',
    priority,
    priorityLabel,
    resources
  };
}

Page({
  data: {
    year: 0,
    month: 0,
    monthLabel: '',
    today: '',
    selected: '',
    selectedLabel: '',
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    cells: [],
    dayItems: [],
    dayCount: 0,
    dayMinutes: 0,
    byDate: {},
    activeGoals: [],
    detail: null
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    const now = new Date();
    if (!this.data.year) {
      this.setData({ year: now.getFullYear(), month: now.getMonth() + 1 });
    }
    this.refresh();
  },

  _label(date) {
    if (!date) return '';
    const p = date.split('-');
    return `${p[0]}/${p[1]}/${p[2]}`;
  },

  _applyDay(date, byDate) {
    const items = (byDate[date] || []).slice();
    const dayMinutes = items.reduce((s, t) => s + (t.estimatedMinutes || 0), 0);
    this.setData({
      selected: date,
      selectedLabel: this._label(date),
      dayItems: items,
      dayCount: items.length,
      dayMinutes
    });
  },

  refresh() {
    const { year, month } = this.data;
    api
      .ensureLogin()
      .then(() =>
        Promise.all([
          api.request({ url: `/api/calendar/month?year=${year}&month=${month}` }),
          api.request({ url: '/api/tasks/today' })
        ])
      )
      .then(([data, todayData]) => {
        const byDate = {};
        (data.days || []).forEach((d) => {
          byDate[d.date] = (d.items || []).map(mapTask);
        });
        const first = new Date(year, month - 1, 1);
        let padDays = first.getDay() - 1;
        if (padDays < 0) padDays = 6;
        const cells = [];
        for (let i = 0; i < padDays; i++) {
          cells.push({ key: `p${i}`, pad: true, day: '', date: '', count: 0 });
        }
        (data.days || []).forEach((d) => {
          cells.push({
            key: d.date,
            pad: false,
            day: Number(d.date.slice(8)),
            date: d.date,
            count: d.count
          });
        });
        const selected = this.data.selected || data.today;
        this.setData({
          today: data.today,
          monthLabel: `${year}年${month}月`,
          cells,
          byDate,
          activeGoals: todayData.active_goals || []
        });
        this._applyDay(selected, byDate);
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onPrev() {
    let { year, month } = this.data;
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    this.setData({ year, month, selected: '' });
    this.refresh();
  },

  onNext() {
    let { year, month } = this.data;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    this.setData({ year, month, selected: '' });
    this.refresh();
  },

  onSelect(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this._applyDay(date, this.data.byDate);
  },

  _cleanLearn(text) {
    return String(text || '')
      .replace(/\s*[|｜]\s*推荐[:：].*$/, '')
      .replace(/\s*推荐[:：].*$/, '')
      .trim();
  },

  onOpenTask(e) {
    const id = e.currentTarget.dataset.id;
    const task = (this.data.dayItems || []).find((t) => t.id === id);
    if (!task) return;
    const stagePct =
      task.stageTotal > 0
        ? Math.max(8, Math.round((task.stageNo / task.stageTotal) * 100))
        : 0;
    this.setData({
      detail: {
        id: task.id,
        name: task.name,
        status: task.status,
        goalTitle: task.goalTitle,
        stageNo: task.stageNo,
        stageTotal: task.stageTotal,
        stageName: task.stageName,
        stagePct,
        learnContent: this._cleanLearn(task.learnContent),
        priority: task.priority || 'normal',
        priorityLabel: task.priorityLabel || '普通',
        resources: task.resources || []
      }
    });
  },

  onCloseDetail() {
    this.setData({ detail: null });
  },

  noop() {},

  onCopyResource(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) {
      wx.showToast({ title: '暂无链接', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
    });
  },

  onToggleFromDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ detail: null });
    this.onToggle({ currentTarget: { dataset: { id } } });
  },

  onToggle(e) {
    const id = e.currentTarget.dataset.id;
    const task = (this.data.dayItems || []).find((t) => t.id === id);
    if (!task) return;
    const next = task.status === 'done' ? 'todo' : 'done';
    api
      .request({
        url: `/api/tasks/${id}/status`,
        method: 'POST',
        data: { status: next }
      })
      .then((r) => {
        const proposals = r.skill_proposals || [];
        if (proposals.length) {
          return confirmSkillProposals(proposals).then(() => this.refresh());
        }
        this.refresh();
      })
      .catch((err) => wx.showToast({ title: err.message || '更新失败', icon: 'none' }));
  },

  onAddTask() {
    const goals = this.data.activeGoals || [];
    const date = this.data.selected || this.data.today;
    if (!goals.length) {
      wx.showModal({
        title: '还没有进行中的目标',
        confirmText: '去创建',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/goal-create/goal-create' });
        }
      });
      return;
    }
    const pickGoal = () =>
      new Promise((resolve, reject) => {
        if (goals.length === 1) {
          resolve(goals[0]);
          return;
        }
        wx.showActionSheet({
          itemList: goals.map((g) => g.title),
          success: (res) => resolve(goals[res.tapIndex]),
          fail: reject
        });
      });

    pickGoal()
      .then((goal) => {
        wx.showModal({
          title: '添加任务',
          editable: true,
          placeholderText: '任务名称',
          success: (res) => {
            if (!res.confirm) return;
            const name = (res.content || '').trim();
            if (!name) {
              wx.showToast({ title: '请输入任务名', icon: 'none' });
              return;
            }
            api
              .request({
                url: '/api/tasks',
                method: 'POST',
                data: {
                  goal_id: goal.id,
                  name,
                  planned_date: date,
                  estimated_minutes: 30
                }
              })
              .then(() => {
                wx.showToast({ title: '已添加', icon: 'success' });
                this.refresh();
              })
              .catch((err) => wx.showToast({ title: err.message || '添加失败', icon: 'none' }));
          }
        });
      })
      .catch(() => {});
  }
});
