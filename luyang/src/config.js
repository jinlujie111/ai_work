/* 路养 · 环境配置（云开发 env 在微信开发者工具开通后填这里） */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  LY.Config = {
    /* 微信云开发环境 ID：在「云开发控制台」创建后粘贴到这里 */
    cloudEnvId: '',
    /* 云数据库集合名 */
    collectionUser: 'user_progress',
    /* 本地缓存键 */
    storageKey: 'luyang_assemble_v1',
    /* 设计分辨率 */
    BASE_W: 750,
    BASE_H: 1334
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Config;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
