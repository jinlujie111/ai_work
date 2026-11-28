const api = require('../../services/api');

const DOMAIN_ORDER = ['技术', '语言', '运动', '认知', '职业', '其他'];
const SOURCE_LABEL = {
  ai_suggest: 'AI 建议',
  self_report: '手动添加',
  user_adjust: '手动调整',
  evidence: '证据确认'
};

function sourceLabel(source) {
  const s = String(source || '').trim();
  if (!s) return '';
  return SOURCE_LABEL[s] || s;
}

function domainKey(raw) {
  return String(raw || '').trim() || '其他';
}

function parseGoalTitle(evidence) {
  const m = String(evidence || '').match(/目标「([^」]+)」/);
  return m ? m[1].trim() : '';
}

/** 阶段/模块名：关键词优先于短名例外，避免「环境与语法起步」被当成主技能 */
function isStageLikeName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (/[：:]/.test(n)) return true;
  if (/(起步|实战|集成|配置|重构|调试|流程|入门|进阶|阶段|模块|全流程|工具链|工程化|测试|语法|键盘|断点|界面)/.test(n)) {
    return true;
  }
  // 短名且不像阶段 → 主技能（Python、韩语、雅思）
  if (n.length <= 10) return false;
  return true;
}

function pickDomainParent(byName, domain) {
  const candidates = Object.values(byName).filter((s) => s.domain === domain && !s.isOrphan);
  if (!candidates.length) return '';
  candidates.sort((a, b) => {
    if ((b.level || 0) !== (a.level || 0)) return (b.level || 0) - (a.level || 0);
    return String(a.name).length - String(b.name).length;
  });
  return candidates[0].key;
}

/**
 * 列表只保留真正的技能名；阶段一律挂到详情。
 */
function buildSkillIndex(items) {
  const normalized = (items || []).map((it) => ({
    ...it,
    domain: domainKey(it.domain),
    sourceLabel: sourceLabel(it.source),
    goalTitle: parseGoalTitle(it.evidence),
    stageLike: isStageLikeName(it.skill_name)
  }));

  const byName = {};
  const goalToSkill = {};

  normalized.forEach((it) => {
    if (it.stageLike) return;
    const key = it.skill_name;
    if (!byName[key] || (it.level || 0) >= (byName[key].level || 0)) {
      byName[key] = {
        key,
        name: key,
        domain: it.domain,
        level: it.level || 0,
        level_label: it.level_label || '',
        primary: it,
        modules: [],
        goals: []
      };
    }
    if (it.goalTitle) goalToSkill[it.goalTitle] = key;
  });

  normalized.forEach((it) => {
    if (!it.stageLike) return;
    let parent = it.goalTitle ? goalToSkill[it.goalTitle] : '';
    if (!parent) parent = pickDomainParent(byName, it.domain);
    if (parent && byName[parent]) {
      byName[parent].modules.push(it);
      if (it.goalTitle && !byName[parent].goals.includes(it.goalTitle)) {
        byName[parent].goals.push(it.goalTitle);
      }
    } else {
      // 没有可挂靠的主技能时，仍不进列表：并入一个隐藏桶，详情可从「其他」看
      const orphanKey = `__orphan_${it.domain}__`;
      if (!byName[orphanKey]) {
        byName[orphanKey] = {
          key: orphanKey,
          name: `${it.domain}·待归类`,
          domain: it.domain,
          level: 0,
          level_label: '',
          primary: null,
          modules: [],
          goals: [],
          isOrphan: true
        };
      }
      byName[orphanKey].modules.push(it);
    }
  });

  Object.values(byName).forEach((s) => {
    const g = s.primary && s.primary.goalTitle;
    if (g && !s.goals.includes(g)) s.goals.push(g);
    s.modules.sort((a, b) => {
      if ((b.level || 0) !== (a.level || 0)) return (b.level || 0) - (a.level || 0);
      return String(a.skill_name || '').localeCompare(String(b.skill_name || ''), 'zh');
    });
    s.moduleCount = s.modules.length;
  });

  // 列表：只显示真正技能；孤儿桶默认不进主列表（除非该领域完全没有主技能）
  const list = Object.values(byName)
    .filter((s) => {
      if (!s.isOrphan) return true;
      const hasPeer = Object.values(byName).some(
        (x) => !x.isOrphan && x.domain === s.domain
      );
      return !hasPeer;
    })
    .sort((a, b) => {
      const ia = DOMAIN_ORDER.indexOf(a.domain);
      const ib = DOMAIN_ORDER.indexOf(b.domain);
      const sa = ia === -1 ? 99 : ia;
      const sb = ib === -1 ? 99 : ib;
      if (sa !== sb) return sa - sb;
      return String(a.name).localeCompare(String(b.name), 'zh');
    });

  return { index: byName, list };
}

function buildDomainSections(list, activeDomain) {
  const filtered =
    !activeDomain || activeDomain === 'all'
      ? list
      : list.filter((s) => s.domain === activeDomain);

  const map = {};
  filtered.forEach((s) => {
    if (!map[s.domain]) map[s.domain] = [];
    map[s.domain].push(s);
  });

  return Object.keys(map)
    .sort((a, b) => {
      const ia = DOMAIN_ORDER.indexOf(a);
      const ib = DOMAIN_ORDER.indexOf(b);
      const sa = ia === -1 ? 99 : ia;
      const sb = ib === -1 ? 99 : ib;
      if (sa !== sb) return sa - sb;
      return a.localeCompare(b, 'zh');
    })
    .map((domain) => ({
      domain,
      items: map[domain]
    }));
}

function buildDomainTabs(list) {
  const counts = {};
  (list || []).forEach((it) => {
    counts[it.domain] = (counts[it.domain] || 0) + 1;
  });
  const tabs = [{ key: 'all', label: '全部', count: list.length || 0 }];
  DOMAIN_ORDER.forEach((d) => {
    if (counts[d]) tabs.push({ key: d, label: d, count: counts[d] });
  });
  return tabs;
}

Page({
  data: {
    tab: 'list',
    skillList: [],
    sections: [],
    skillIndex: {},
    domainTabs: [],
    activeDomain: 'all',
    skillCount: 0,
    detail: null,
    domains: [],
    edges: []
  },

  onShow() {
    this.refresh();
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab, detail: null });
    this.refresh();
  },

  onFilter(e) {
    const key = e.currentTarget.dataset.key || 'all';
    this.setData({
      activeDomain: key,
      sections: buildDomainSections(this.data.skillList, key),
      detail: null
    });
  },

  _applyList(items) {
    const { index, list } = buildSkillIndex(items);
    const activeDomain = this.data.activeDomain || 'all';
    const domainTabs = buildDomainTabs(list);
    const stillValid =
      activeDomain === 'all' || domainTabs.some((t) => t.key === activeDomain);
    const nextDomain = stillValid ? activeDomain : 'all';
    this.setData({
      skillIndex: index,
      skillList: list,
      skillCount: list.length,
      activeDomain: nextDomain,
      domainTabs,
      sections: buildDomainSections(list, nextDomain),
      detail: null
    });
  },

  refresh() {
    if (this.data.tab === 'graph') {
      this.loadGraph();
      return;
    }
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/skills' }))
      .then((data) => {
        this._applyList(data.items || []);
      })
      .catch((err) => wx.showToast({ title: err.message || '加载失败', icon: 'none' }));
  },

  loadGraph() {
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/skills/graph' }))
      .then((data) => {
        const nodes = data.nodes || [];
        const byId = {};
        nodes.forEach((n) => {
          byId[n.id] = n;
        });
        const domains = (data.domains || []).map((d) => ({
          ...d,
          nodes: nodes.filter((n) => n.domain === d.name)
        }));
        const edges = (data.edges || []).map((e, idx) => ({
          idx,
          label: `${(byId[e.from] || {}).name || e.from} → ${(byId[e.to] || {}).name || e.to}（${e.relation}）`
        }));
        this.setData({ domains, edges });
      })
      .catch((err) => wx.showToast({ title: err.message || '图谱失败', icon: 'none' }));
  },

  onOpenSkill(e) {
    const key = e.currentTarget.dataset.key;
    const skill = this.data.skillIndex[key];
    if (!skill) return;
    this.setData({
      detail: {
        key: skill.key,
        name: skill.name,
        domain: skill.domain,
        isOrphan: !!skill.isOrphan,
        level: skill.level,
        level_label: skill.level_label,
        primary: skill.primary,
        modules: skill.modules || [],
        goals: skill.goals || [],
        moduleCount: skill.moduleCount || 0
      }
    });
  },

  onCloseDetail() {
    this.setData({ detail: null });
  },

  noop() {},

  onAdd() {
    wx.showModal({
      title: '添加技能',
      editable: true,
      placeholderText: '如：Python / 英语听力',
      success: (res) => {
        if (!res.confirm) return;
        const name = (res.content || '').trim();
        if (!name) return;
        wx.showActionSheet({
          itemList: DOMAIN_ORDER,
          success: (a) => {
            const domain = DOMAIN_ORDER[a.tapIndex];
            api
              .request({
                url: '/api/skills',
                method: 'POST',
                data: {
                  skill_name: name,
                  domain,
                  level: 1,
                  evidence: '用户自报'
                }
              })
              .then(() => {
                wx.showToast({ title: '已添加', icon: 'success' });
                this.refresh();
              })
              .catch((err) => wx.showToast({ title: err.message || '失败', icon: 'none' }));
          }
        });
      }
    });
  },

  onEdit(e) {
    const { name } = e.currentTarget.dataset;
    wx.showActionSheet({
      itemList: ['0 未知', '1 入门', '2 会用', '3 熟练', '4 能教人'],
      success: (res) => {
        api
          .request({
            url: '/api/skills',
            method: 'POST',
            data: {
              skill_name: name,
              level: res.tapIndex,
              evidence: '用户调整程度'
            }
          })
          .then(() => {
            wx.showToast({ title: '已更新', icon: 'success' });
            this.refresh();
          })
          .catch((err) => wx.showToast({ title: err.message || '失败', icon: 'none' }));
      }
    });
  },

  onArchive(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '归档该条目？',
      content: '归档后不再用于新建学习目标时读档。',
      success: (res) => {
        if (!res.confirm) return;
        api
          .request({ url: `/api/skills/${id}`, method: 'DELETE' })
          .then(() => this.refresh())
          .catch((err) => wx.showToast({ title: err.message || '失败', icon: 'none' }));
      }
    });
  },

  onExport() {
    api
      .ensureLogin()
      .then(() => api.request({ url: '/api/skills/export' }))
      .then((data) => {
        const text = JSON.stringify(data, null, 2);
        wx.setClipboardData({
          data: text,
          success: () => wx.showToast({ title: `已复制 ${data.count} 条`, icon: 'success' })
        });
      })
      .catch((err) => wx.showToast({ title: err.message || '导出失败', icon: 'none' }));
  }
});
