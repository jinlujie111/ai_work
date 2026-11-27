const api = require('../../services/api');

Page({
  data: {
    tab: 'daily',
    daily: {
      date: '',
      completionRate: 0,
      doneCount: 0,
      minutes: 0,
      advice: '',
      chart: null
    },
    rangeLabel: '',
    completionRate: 0,
    doneCount: 0,
    deferredCount: 0,
    minutes: 0,
    goalStats: [],
    advice: '',
    nextWeekLabel: '',
    nextWeekSummary: '',
    nextWeekPlan: [],
    skillChanges: [],
    dayChart: []
  },

  onLoad(q) {
    if (q.tab === 'weekly' || q.tab === 'daily') {
      this.setData({ tab: q.tab });
    }
  },

  onShow() {
    this.refresh();
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab });
    this.refresh();
  },

  refresh() {
    if (this.data.tab === 'daily') {
      this.loadDaily();
    } else {
      this.loadWeekly();
    }
  },

  loadDaily() {
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/reviews/daily' }))
      .then((data) => {
        this.setData({
          daily: {
            date: data.date,
            completionRate: data.completion_rate,
            doneCount: data.done_count,
            minutes: data.minutes,
            advice: data.advice,
            chart: data.chart
          }
        });
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  loadWeekly() {
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/reviews/weekly' }))
      .then((data) => {
        const nw = data.next_week_range || {};
        const maxDone = Math.max(1, ...((data.day_chart || []).map((d) => d.done || 0)));
        this.setData({
          rangeLabel: `${data.range_start} ~ ${data.range_end}`,
          completionRate: data.completion_rate,
          doneCount: data.done_count,
          deferredCount: data.deferred_count,
          minutes: data.minutes,
          goalStats: (data.goal_stats || []).map((g) => ({
            id: g.id,
            title: g.title,
            progress: g.progress
          })),
          advice: data.advice,
          nextWeekLabel: nw.start ? `${nw.start} ~ ${nw.end}` : '下周',
          nextWeekSummary: data.next_week_summary || '',
          nextWeekPlan: data.next_week_plan || [],
          skillChanges: data.skill_changes || [],
          dayChart: (data.day_chart || []).map((d) => ({
            ...d,
            barHeight: Math.max(8, Math.round(((d.done || 0) / maxDone) * 120))
          }))
        });
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  }
});
