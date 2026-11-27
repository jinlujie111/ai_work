/* 路养 · 2.5D 投影（公路伪透视） */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  /**
   * 世界：x 以路中为 0，向右为正；z 为车前方距离（越大越远）
   * 屏幕：远小近大，消失点在画面上方中线
   */
  function project(worldX, worldZ) {
    var P = LY.Params;
    var z = Math.max(0, worldZ);
    var scale = P.camDepth / (P.camDepth + z);
    var scale0 = P.camDepth / (P.camDepth + P.carZ);
    /* 近大（靠画面下方）→ 远小（靠地平线） */
    var y = P.horizonY + (P.roadBottomY - P.horizonY) * Math.pow(scale / scale0, 1.15);
    y = LY.Util.clamp(y, P.horizonY, P.BASE_H);
    var x = P.BASE_W / 2 + worldX * scale;
    var roadHalf = (P.roadWidthNear / 2) * scale;
    return {
      x: x,
      y: y,
      scale: scale,
      scale0: scale0,
      roadHalf: roadHalf,
      w: scale
    };
  }

  function laneWorldX(lane, laneSmooth) {
    var P = LY.Params;
    var L = (laneSmooth !== undefined && laneSmooth !== null) ? laneSmooth : lane;
    var mid = (P.laneCount - 1) / 2;
    return (L - mid) * P.laneWorld;
  }

  function roadEdgeX(side, worldZ) {
    /* side: -1 左 / 1 右，世界 x 在路面边缘 */
    var P = LY.Params;
    var scale = P.camDepth / (P.camDepth + Math.max(0, worldZ));
    var half = (P.roadWidthNear / 2) * scale;
    var p = project(0, worldZ);
    return p.x + side * half;
  }

  LY.Project = {
    project: project,
    laneWorldX: laneWorldX,
    roadEdgeX: roadEdgeX
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Project;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
