/**
 * 小程序前端配置（可随代码提交）。
 *
 * 职责边界：
 * - 本文件：api 地址、展示名、公开 AppID、开关等「客户端可见」配置
 * - 上级 zhida/.env：MySQL、大模型 Key、WX_SECRET、JWT 等「仅服务端」密钥
 *
 * 切勿把 Secret / API Key 写进本文件。
 */
module.exports = {
  appName: '学习者',
  slogan: '拆模块，日日推进',

  // 开发者工具可访问本机；真机调试请改成电脑局域网 IP，如 http://192.168.1.8:8000
  apiBase: 'http://127.0.0.1:8002',

  // 与微信公众平台一致（公开信息）。密钥 WX_SECRET 只在 zhida/.env
  wxAppId: 'wx335532634164aa43',

  // 登录：优先 wx.login → /api/auth/wx-login
  // 已配置 WX_SECRET 后建议 false，避免静默掉进开发账号
  preferWxLogin: true,
  allowDevLoginFallback: false,

  // 本地存储前缀
  storagePrefix: 'zhida_',

  // 请求超时（ms）；确认模块会二次调用 LLM 展开任务，略放宽
  requestTimeout: 120000
};
