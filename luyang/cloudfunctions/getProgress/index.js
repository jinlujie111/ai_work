/* 云函数：读取用户进度 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, error: 'no_openid', progress: null };

  try {
    const res = await db.collection('user_progress').doc(openid).get();
    return { ok: true, progress: res.data || null };
  } catch (e) {
    return { ok: true, progress: null };
  }
};
