/**
 * 统一请求封装。apiBase 在 app.globalData 配置。
 */
function request({ url, method = 'GET', data = {}, header = {} }) {
  const app = getApp();
  const base = (app && app.globalData && app.globalData.apiBase) || '';

  return new Promise((resolve, reject) => {
    if (!base) {
      reject(new Error('apiBase 未配置'));
      return;
    }

    wx.request({
      url: `${base}${url}`,
      method,
      data,
      header: {
        'content-type': 'application/json',
        ...header
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(res);
        }
      },
      fail: reject
    });
  });
}

module.exports = {
  request
};
