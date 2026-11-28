/** 出处必须落到具体平台/软件，禁止「学习资料」空话 */

const BAD = /学习资料|公开资料|推荐资料|相关资料|参考资料|请按查找/;

const BY_TYPE = {
  video: 'B站（bilibili）',
  course: '中国大学MOOC / B站课程区',
  book: '微信读书 / 纸质书',
  repo: 'GitHub',
  tool: '对应官方 App / 官网',
  practice: '练习表：腾讯文档 / 飞书文档',
  doc: '公开图文：知乎 / 小红书 / 搜索引擎可检索文章'
};

function isBadOrigin(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  return BAD.test(s);
}

function originFromUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u) return '';
  const map = [
    ['bilibili.com', 'B站（bilibili）'],
    ['youtube.com', 'YouTube'],
    ['youtu.be', 'YouTube'],
    ['zhihu.com', '知乎'],
    ['xiaohongshu.com', '小红书'],
    ['douyin.com', '抖音'],
    ['docs.qq.com', '腾讯文档'],
    ['feishu.cn', '飞书文档'],
    ['yuque.com', '语雀'],
    ['github.com', 'GitHub'],
    ['csdn.net', 'CSDN'],
    ['juejin.cn', '掘金']
  ];
  for (let i = 0; i < map.length; i++) {
    if (u.indexOf(map[i][0]) >= 0) return map[i][1];
  }
  return u.indexOf('http') === 0 ? '公开网站' : '';
}

function mapType(type) {
  const t = String(type || 'doc').toLowerCase();
  if (BY_TYPE[t]) return t;
  if (/视频|video/.test(t)) return 'video';
  if (/课|course/.test(t)) return 'course';
  if (/书|book/.test(t)) return 'book';
  if (/仓|repo|github/.test(t)) return 'repo';
  if (/练|practice/.test(t)) return 'practice';
  if (/工具|tool/.test(t)) return 'tool';
  return 'doc';
}

function resolveOrigin(item) {
  const type = (item && (item.type || item.typeLabel || item.type_label)) || 'doc';
  const title = (item && item.title) || '';
  const url = (item && item.url) || '';
  const raw = (item && item.origin) || '';
  if (!isBadOrigin(raw)) return String(raw).trim();
  const fromUrl = originFromUrl(url);
  if (fromUrl) return fromUrl;
  const t = mapType(type);
  if (/视频|演示/.test(title)) return BY_TYPE.video;
  if (BY_TYPE[t]) return BY_TYPE[t];
  if (/指南|手册|清单|笔记|参考表|文档/.test(title)) return BY_TYPE.doc;
  return BY_TYPE.doc;
}

function resolveHowto(item, origin) {
  const raw = (item && (item.howtoFind || item.howto_find)) || '';
  if (raw && String(raw).trim()) return String(raw).trim();
  const url = (item && item.url) || '';
  if (url) return '复制链接，用手机浏览器打开';
  const name = ((item && item.title) || '资料名').slice(0, 24);
  const plat = origin || resolveOrigin(item);
  const t = String((item && (item.type || item.typeLabel)) || 'doc').toLowerCase();
  if (t === 'video') return `打开${plat}，搜索「${name}」，选有字幕/完播高的合集`;
  if (t === 'book') return `打开微信读书或购书平台，搜索书名「${name}」`;
  if (t === 'practice') return `在腾讯文档/飞书新建表格，按「${name}」要点列检查项`;
  return `打开${plat}，搜索「${name}」，对照标题选最近更新的图文`;
}

module.exports = {
  resolveOrigin,
  resolveHowto,
  isBadOrigin
};
