Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/today/today', text: '概览' },
      { pagePath: '/pages/calendar/calendar', text: '日历' },
      { pagePath: '/pages/goals/goals', text: '目标' },
      { pagePath: '/pages/market/market', text: '市场' },
      { pagePath: '/pages/mine/mine', text: '我的' }
    ]
  },

  methods: {
    onSwitch(e) {
      const { path, index } = e.currentTarget.dataset;
      wx.switchTab({ url: path });
      this.setData({ selected: index });
    }
  }
});
