const api = require('../../services/api');
const { confirmSkillProposals } = require('../../utils/skills');
const materialOrigin = require('../../utils/materialOrigin');

function mapTask(t) {
  const isInbox = !!(t.is_inbox || t.goal_type === 'inbox' || t.source === 'quick');
  const resources = isInbox
    ? []
    : (t.resources || []).map((r) => ({
        title: r.title || '学习材料',
        typeLabel: r.type_label || r.type || '资料',
        note: r.note || r.desc || '',
        content: r.content || '',
        origin: r.origin || '',
        howtoFind: r.howto_find || r.howtoFind || '',
        url: r.url || ''
      }));
  const priority = (t.priority || 'normal').toLowerCase();
  const priorityLabel = isInbox
    ? ''
    : priority === 'high'
      ? '高优'
      : priority === 'low'
        ? '可延后'
        : '';
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    estimatedMinutes: t.estimated_minutes,
    goalTitle: t.goal_title || (isInbox ? '收集箱' : ''),
    goalId: t.goal_id,
    plannedDate: t.planned_date || '',
    stageNo: isInbox ? 0 : t.stage_no || 0,
    stageTotal: isInbox ? 0 : t.stage_total || 0,
    stageName: t.stage_name || '',
    learnContent: isInbox ? '' : t.learn_content || '',
    priority: isInbox ? 'normal' : priority,
    priorityLabel,
    isInbox,
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
    detail: null,
    matDetail: null,
    quickAddOpen: false
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
    // 收集箱快速待办不计入当日学习时长合计
    const dayMinutes = items.reduce(
      (s, t) => s + (t.isInbox ? 0 : t.estimatedMinutes || 0),
      0
    );
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
        goalTitle: task.goalTitle || (task.isInbox ? '收集箱' : ''),
        isInbox: !!task.isInbox,
        plannedDate: task.plannedDate || this.data.selected || '',
        stageNo: task.isInbox ? 0 : task.stageNo,
        stageTotal: task.isInbox ? 0 : task.stageTotal,
        stageName: task.isInbox ? '' : task.stageName,
        stagePct: task.isInbox ? 0 : stagePct,
        learnContent: task.isInbox ? '' : this._cleanLearn(task.learnContent),
        priority: task.priority || 'normal',
        priorityLabel: task.isInbox ? '' : task.priorityLabel || '',
        resources: task.isInbox ? [] : task.resources || []
      }
    });
  },

  onCloseDetail() {
    this.setData({ detail: null, matDetail: null });
  },

  noop() {},

  onOpenResource(e) {
    const idx = e.currentTarget.dataset.index;
    const item = ((this.data.detail && this.data.detail.resources) || [])[idx];
    if (!item) return;
    const content =
      (item.content || '').trim() ||
      (item.note || '').trim() ||
      (this.data.detail && this.data.detail.learnContent) ||
      '暂无详细学习说明';
    const origin = materialOrigin.resolveOrigin(item);
    const howtoFind = materialOrigin.resolveHowto(item, origin);
    this.setData({
      matDetail: {
        title: item.title || '学习资料',
        typeLabel: item.typeLabel || '资料',
        note: (item.note || '').trim(),
        content,
        origin,
        howtoFind,
        url: item.url || ''
      }
    });
  },

  onCloseMat() {
    this.setData({ matDetail: null });
  },

  onCopyResource(e) {
    const url =
      e.currentTarget.dataset.url ||
      (this.data.matDetail && this.data.matDetail.url);
    if (!url) {
      wx.showToast({ title: '暂无链接', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
    });
  },

  onCopyHowto(e) {
    const text =
      e.currentTarget.dataset.text ||
      (this.data.matDetail && this.data.matDetail.howtoFind) ||
      '';
    if (!text) {
      wx.showToast({ title: '暂无查找说明', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制查找方式', icon: 'success' })
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
    this.setData({ quickAddOpen: true });
  },

  onQuickAddClose() {
    this.setData({ quickAddOpen: false });
  },

  onQuickAddCreated() {
    this.setData({ quickAddOpen: false });
    this.refresh();
  }
});
