const api = require('../../services/api');

Page({
  data: {
    groupId: '',
    group: null,
    members: [],
    today: '',
    myLinkedGoalId: null
  },

  onLoad(q) {
    this.setData({ groupId: q.id });
  },

  onShow() {
    if (this.data.groupId) this.refresh();
  },

  onShareAppMessage() {
    const g = this.data.group || {};
    return {
      title: `加入学习群「${g.name || ''}」`,
      path: `/pages/group-join/group-join?code=${g.invite_code || ''}`
    };
  },

  refresh() {
    api
      .ensureLogin()
      .then(() => api.request({ url: `/api/groups/${this.data.groupId}` }))
      .then((data) => {
        this.setData({
          group: data.group,
          members: data.members || [],
          today: data.today || '',
          myLinkedGoalId: data.my_linked_goal_id || null
        });
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onCopyCode() {
    const code = this.data.group && this.data.group.invite_code;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' })
    });
  },

  onLinkGoal() {
    api
      .request({ url: '/api/goals' })
      .then((data) => {
        const items = (data.items || []).filter(
          (g) => g.status === 'active' || g.status === 'planning'
        );
        if (!items.length) {
          wx.showModal({
            title: '还没有可挂目标',
            content: '请先创建并确认一个学习目标。',
            confirmText: '去创建',
            success: (res) => {
              if (res.confirm) wx.navigateTo({ url: '/pages/goal-create/goal-create' });
            }
          });
          return;
        }
        const names = items.map((g, i) => `${i + 1}. ${g.title}`).join('\n');
        wx.showModal({
          title: '选择要挂的目标序号',
          editable: true,
          placeholderText: '输入数字，如 1',
          content: names.slice(0, 500),
          success: (res) => {
            if (!res.confirm) return;
            const idx = Number(res.content) - 1;
            if (idx < 0 || idx >= items.length) {
              wx.showToast({ title: '序号无效', icon: 'none' });
              return;
            }
            api
              .request({
                url: `/api/groups/${this.data.groupId}/link-goal`,
                method: 'POST',
                data: { goal_id: items[idx].id }
              })
              .then(() => {
                wx.showToast({ title: '已挂上', icon: 'success' });
                this.refresh();
              })
              .catch((err) => wx.showToast({ title: err.message || '失败', icon: 'none' }));
          }
        });
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  onLeave() {
    const isOwner = this.data.group && this.data.group.my_role === 'owner';
    wx.showModal({
      title: isOwner ? '解散学习群？' : '退出学习群？',
      content: isOwner ? '所有成员将离开该群。' : '退出后不再出现在进度墙。',
      success: (res) => {
        if (!res.confirm) return;
        api
          .request({
            url: `/api/groups/${this.data.groupId}/leave`,
            method: 'POST'
          })
          .then(() => {
            wx.showToast({ title: isOwner ? '已解散' : '已退出', icon: 'success' });
            setTimeout(() => wx.navigateBack(), 400);
          })
          .catch((err) => wx.showToast({ title: err.message || '失败', icon: 'none' }));
      }
    });
  }
});
