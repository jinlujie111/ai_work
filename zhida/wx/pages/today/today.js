const api = require('../../services/api');
const { confirmSkillProposals } = require('../../utils/skills');

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDate(base, days) {
  const d = new Date(base.replace(/-/g, '/'));
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(s) {
  const d = new Date(s.replace(/-/g, '/'));
  return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate(), wd: d.getDay() };
}

Page({
  data: {
    monthDay: '',
    fullDate: '',
    tasks: [],
    activeGoals: [],
    doneCount: 0,
    totalCount: 0,
    weekDays: [],
    weekCount: 0,
    detail: null
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    const now = new Date();
    this.setData({
      monthDay: `${now.getMonth() + 1}月${now.getDate()}日`,
      fullDate: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
    });
    this.refresh();
  },

  refresh() {
    const today = todayStr();
    const { y, m } = parseYmd(today);
    const next = shiftDate(today, 6);
    const nextMeta = parseYmd(next);
    const months = [{ y, m }];
    if (nextMeta.y !== y || nextMeta.m !== m) {
      months.push({ y: nextMeta.y, m: nextMeta.m });
    }

    api
      .ensureLogin()
      .then(() =>
        Promise.all([
          api.request({ url: '/api/tasks/today' }),
          ...months.map((mm) =>
            api.request({ url: `/api/calendar/month?year=${mm.y}&month=${mm.m}` })
          )
        ])
      )
      .then(([todayData, ...monthDatas]) => {
        const byDate = {};
        monthDatas.forEach((data) => {
          (data.days || []).forEach((d) => {
            byDate[d.date] = d;
          });
        });

        let maxVal = 1;
        let weekCount = 0;
        const weekDays = [];
        for (let i = 0; i < 7; i++) {
          const date = shiftDate(today, i);
          const bucket = byDate[date] || { count: 0, minutes: 0, items: [] };
          const count = bucket.count || 0;
          const minutes = bucket.minutes || 0;
          const weight = Math.max(count * 20, minutes);
          weekCount += count;
          if (weight > maxVal) maxVal = weight;
          weekDays.push({
            date,
            label: WEEK[parseYmd(date).wd],
            count,
            minutes,
            isToday: i === 0,
            weight
          });
        }
        weekDays.forEach((d) => {
          d.barHeight = d.weight
            ? Math.max(12, Math.round((d.weight / maxVal) * 100))
            : 8;
        });

        const tasks = (todayData.items || []).map((t) => {
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
            plannedDate: t.planned_date,
            stageNo: t.stage_no || 0,
            stageTotal: t.stage_total || 0,
            stageName: t.stage_name || '',
            learnContent: t.learn_content || '',
            priority,
            priorityLabel,
            resources
          };
        });

        this.setData({
          tasks,
          activeGoals: todayData.active_goals || [],
          doneCount: todayData.done_count,
          totalCount: todayData.total_count,
          weekDays,
          weekCount
        });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      });
  },

  onOpenCalendar() {
    wx.switchTab({ url: '/pages/calendar/calendar' });
  },

  _cleanLearn(text) {
    return String(text || '')
      .replace(/\s*[|｜]\s*推荐[:：].*$/, '')
      .replace(/\s*推荐[:：].*$/, '')
      .trim();
  },

  onOpenTask(e) {
    const id = e.currentTarget.dataset.id;
    const task = this.data.tasks.find((t) => t.id === id);
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
    const task = this.data.tasks.find((t) => t.id === id);
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

  onMore(e) {
    const id = e.currentTarget.dataset.id;
    const task = this.data.tasks.find((t) => t.id === id);
    if (!task) return;
    const today = todayStr();
    wx.showActionSheet({
      itemList: ['改到明天', '改到后天', '延期重规划'],
      success: (res) => {
        if (res.tapIndex === 2) {
          wx.navigateTo({
            url: `/pages/replan/replan?taskIds=${id}&goalId=${task.goalId || ''}`
          });
          return;
        }
        const date = shiftDate(today, res.tapIndex + 1);
        api
          .request({
            url: `/api/tasks/${id}/update`,
            method: 'POST',
            data: { planned_date: date }
          })
          .then(() => {
            wx.showToast({ title: `已改到 ${date}`, icon: 'none' });
            this.refresh();
          })
          .catch((err) => wx.showToast({ title: err.message || '修改失败', icon: 'none' }));
      }
    });
  },

  onAddTask() {
    const goals = this.data.activeGoals || [];
    if (!goals.length) {
      wx.showModal({
        title: '还没有进行中的目标',
        content: '先创建一个目标。',
        confirmText: '去创建',
        success: (res) => {
          if (res.confirm) this.onGoCreate();
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
                  planned_date: todayStr(),
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
  },

  onGoCreate() {
    wx.navigateTo({ url: '/pages/goal-create/goal-create' });
  }
});
