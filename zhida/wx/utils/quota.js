/** 免费目标名额用尽时引导开通会员 */

function isQuotaExceeded(errOrMsg) {
  const msg =
    typeof errOrMsg === 'string'
      ? errOrMsg
      : (errOrMsg && (errOrMsg.message || errOrMsg.detail)) || '';
  return (
    msg.includes('免费用户最多') ||
    msg.includes('不释放名额') ||
    msg.includes('开通会员不限') ||
    msg.includes('名额已满')
  );
}

function isQuotaFull(userOrQuota) {
  if (!userOrQuota) return false;
  if (userOrQuota.is_member) return false;
  const q = userOrQuota.goal_quota || userOrQuota;
  if (q.is_member) return false;
  const remaining = Number(q.remaining);
  if (Number.isFinite(remaining)) return remaining <= 0;
  const used = Number(q.used);
  const limit = Number(q.limit);
  if (Number.isFinite(used) && Number.isFinite(limit)) return used >= limit;
  return false;
}

function goMembership(content) {
  const text =
    content ||
    '免费用户最多保留 5 个目标（进行中/暂停/已完成/待确认/已终止均计入）。终止或放弃不释放名额；开通会员不限数量。';
  return new Promise((resolve) => {
    wx.showModal({
      title: '免费名额已满',
      content: String(text).slice(0, 200),
      confirmText: '去开通',
      cancelText: '取消',
      success(res) {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/membership/membership' });
        }
        resolve(!!res.confirm);
      },
      fail: () => resolve(false)
    });
  });
}

/** 捕获错误：若是名额满则弹窗跳会员，返回 true 表示已处理 */
function handleQuotaError(err) {
  if (!isQuotaExceeded(err)) return false;
  goMembership(err && err.message);
  return true;
}

module.exports = {
  isQuotaExceeded,
  isQuotaFull,
  goMembership,
  handleQuotaError
};
