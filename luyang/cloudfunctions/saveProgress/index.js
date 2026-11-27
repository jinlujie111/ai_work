/* 云函数：保存用户进度（按 openid 分文档） */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, error: 'no_openid' };

  const progress = event.progress || {};
  progress.updatedAt = Date.now();
  progress._openid = openid;

  await db.collection('user_progress').doc(openid).set({
    data: progress
  });

  return { ok: true, progress: progress };
};
