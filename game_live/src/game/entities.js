/* 森林求生｜实体：玩家、熊、蛇、兔、资源、火堆
   行为按 spec 3.2「行为原型」实现，数值取自 src/spec/params.js。 */
(function (global) {
  'use strict';
  var DF = global.DF = global.DF || {};
  var U = DF.Util;
  var P = DF.Params;

  /* ══════════════ 玩家 ══════════════ */
  function Player(x, y) {
    var p = P.player;
    this.type = 'player';
    this.x = x; this.y = y;
    this.r = p.radius;
    this.vx = 0; this.vy = 0;
    this.facing = -Math.PI / 2;
    this.temp = p.tempMax;
    this.poison = 0;          // 中毒剩余时间
    this.wood = 0;            // 待送达火堆的木头
    this.decoy = null;        // 抓在手里的兔子（诱饵）
    this.collectTarget = null;
    this.collectT = 0;
    this.moving = false;
    this.dead = false;
    this.hitAt = -99;
    this.anim = 0;
  }

  /* 5.2 输入：屏幕任意位置按下，角色朝手指位置移动，最大偏移 120 像素 */
  Player.prototype.update = function (dt, ctx) {
    if (this.dead) return;
    var p = P.player;
    var target = ctx.dragActive ? ctx.dragPoint : null;
    var desiredVx = 0, desiredVy = 0;

    if (target) {
      var dx = target.x - this.x, dy = target.y - this.y;
      var d = Math.hypot(dx, dy);
      if (d > P.input.maxDragOffset) {
        desiredVx = dx / d * p.speed;
        desiredVy = dy / d * p.speed;
      }
    }
    // 转向加速度 / 停止减速度
    var dvx = desiredVx - this.vx, dvy = desiredVy - this.vy;
    var dmag = Math.hypot(dvx, dvy);
    var rate = (desiredVx || desiredVy) ? p.accel : p.decel;
    var maxDelta = rate * dt;
    if (dmag > maxDelta) { dvx = dvx / dmag * maxDelta; dvy = dvy / dmag * maxDelta; }
    this.vx += dvx; this.vy += dvy;

    var sp = Math.hypot(this.vx, this.vy);
    if (sp > p.speed) { this.vx = this.vx / sp * p.speed; this.vy = this.vy / sp * p.speed; sp = p.speed; }
    this.moving = sp > 6;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (sp > 1) this.facing = Math.atan2(this.vy, this.vx);
    this.anim += dt * (this.moving ? 9 : 2.2);

    // 碰撞
    ctx.world.resolveCircle(this);
    if (ctx.world.clampToBounds(this)) { /* 已处理 */ }
  };

  /* 中毒：咬击瞬间扣 30，三秒后自动解除，药草可提前解除 */
  Player.prototype.poisoned = function () { return this.poison > 0; };
  Player.prototype.applyPoison = function (ctx) {
    this.temp = Math.max(0, this.temp + P.animals.snake.poisonTemp);
    this.poison = P.animals.snake.poisonTime;
    ctx.bus.emit('hit', { x: this.x, y: this.y, kind: 'poison' });
  };

  Player.prototype.addTemp = function (v) { this.temp = U.clamp(this.temp + v, 0, P.player.tempMax); };

  /* ══════════════ 熊：巡逻追击原型 ══════════════ */
  function Bear(x, y, path, opts) {
    opts = opts || {};
    var b = P.animals.bear;
    this.type = 'bear';
    this.x = x; this.y = y;
    this.r = b.radius;
    this.state = 'PATROL';
    this.stateT = 0;
    this.facing = Math.random() * U.TAU;
    this.path = path || [{ x: x, y: y }];
    this.pathIndex = 0;
    this.lastKnown = { x: x, y: y };
    this.chargeT = 0;         // 警觉停顿
    this.seen = false;        // 本局是否发现过玩家
    this.chaseTarget = null;  // 诱饵目标（兔子）
    this.decoyT = 0;
    this.aggressive = opts.aggressive === undefined ? true : opts.aggressive;
    this.anim = Math.random() * 6.28;
    this.alertMark = 0;        // 感叹号动画
    this.stepAcc = 0;
  }

  Bear.prototype.speed = function (night) {
    var b = P.animals.bear;
    if (this.state === 'CHASE' || this.state === 'SEARCH') return night ? b.nightSpeed : b.chaseSpeed;
    return night ? b.nightSpeed : b.patrolSpeed;
  };

  Bear.prototype.senses = function (player, night) {
    var b = P.animals.bear;
    var dx = player.x - this.x, dy = player.y - this.y;
    var d = Math.hypot(dx, dy);
    if (d > b.senseDist) return false;
    if (d < 30) return true;                    // 太近直接察觉
    if (night) return true;                     // 夜里视野差，靠听觉
    var ang = Math.atan2(dy, dx);
    var half = b.coneDeg * Math.PI / 360;
    return Math.abs(U.angleDiff(this.facing, ang)) <= half;
  };

  Bear.prototype.update = function (dt, ctx) {
    var b = P.animals.bear;
    var player = ctx.player;
    this.anim += dt * (this.state === 'CHASE' ? 11 : 5);
    this.stateT += dt;
    this.alertMark = Math.max(0, this.alertMark - dt * 2);

    var target = null;
    var chasing = false;

    // 诱饵优先：追击时兔在 220 内则改追兔，持续 4 秒
    if (this.decoyT > 0) {
      this.decoyT -= dt;
      if (this.decoyTarget && !this.decoyTarget.dead) { target = this.decoyTarget; chasing = true; }
      else this.decoyTarget = null;
    }

    if (!target) {
      // 常规感知
      var canSense = this.aggressive === true || (this.aggressive === 'night' && ctx.night);
      var sensed = canSense && this.senses(player, ctx.night);
      if (sensed) {
        this.lastKnown = { x: player.x, y: player.y };
        if (this.state === 'PATROL' || this.state === 'SEARCH') {
          this.state = 'SUSPICIOUS';
          this.stateT = 0;
          this.chargeT = b.alertPause;
          this.alertMark = 1.2;
          ctx.bus.emit('bearAlert', { x: this.x, y: this.y });
        }
        if (this.state === 'SUSPICIOUS' || this.state === 'CHASE') {
          this.state = 'CHASE';
          this.stateT = 0;
          this.seen = true;
          chasing = true;
          target = player;
        }
      }
    }

    if (!chasing) {
      if (this.state === 'SUSPICIOUS') {
        this.chargeT -= dt;
        if (this.chargeT <= 0) { this.state = 'CHASE'; this.stateT = 0; chasing = true; target = player; }
      } else if (this.state === 'CHASE') {
        // 2 秒未重新感知到目标则转 SEARCH
        if (this.stateT > b.loseTargetTime) { this.state = 'SEARCH'; this.stateT = 0; }
      } else if (this.state === 'SEARCH') {
        if (this.stateT > b.searchTime) { this.state = 'PATROL'; this.stateT = 0; }
      }
    }

    var sp = this.speed(ctx.night);
    var vx = 0, vy = 0;

    if (chasing && target) {
      var dx = target.x - this.x, dy = target.y - this.y;
      var d = Math.hypot(dx, dy) || 1;
      vx = dx / d * sp; vy = dy / d * sp;
      this.facing = Math.atan2(dy, dx);
      this.stepAcc += dt * sp;
      if (this.stepAcc > 60) { this.stepAcc = 0; ctx.bus.emit('bearStep', { x: this.x, y: this.y, d: d }); }
      // 接触判定
      var rr = target.r + P.animals.bear.contact;
      if (U.dist2(this.x, this.y, target.x, target.y) < rr * rr && target.type === 'player') {
        ctx.onCaught(this);
      }
    } else if (this.state === 'SEARCH') {
      // 在最后已知位置附近徘徊
      var lx = this.lastKnown.x - this.x, ly = this.lastKnown.y - this.y;
      var ld = Math.hypot(lx, ly) || 1;
      vx = lx / ld * sp * 0.7 + Math.sin(this.anim * 0.7) * 22;
      vy = ly / ld * sp * 0.7 + Math.cos(this.anim * 0.5) * 22;
      this.facing = Math.atan2(vy, vx);
    } else {
      // 巡逻：沿固定路线
      var wp = this.path[this.pathIndex % this.path.length];
      var pdx = wp.x - this.x, pdy = wp.y - this.y;
      var pd = Math.hypot(pdx, pdy);
      if (pd < 40) { this.pathIndex++; wp = this.path[this.pathIndex % this.path.length]; pdx = wp.x - this.x; pdy = wp.y - this.y; pd = Math.hypot(pdx, pdy) || 1; }
      vx = pdx / pd * sp; vy = pdy / pd * sp;
      this.facing = Math.atan2(vy, vx);
      this.stepAcc += dt * sp;
      if (this.stepAcc > 80) { this.stepAcc = 0; ctx.bus.emit('bearStep', { x: this.x, y: this.y, d: 999 }); }
    }

    this.x += vx * dt;
    this.y += vy * dt;
    ctx.world.resolveCircle(this);
    ctx.world.clampToBounds(this);
  };

  /* 被诱饵吸引 */
  Bear.prototype.lure = function (rabbit, time) {
    this.decoyTarget = rabbit;
    this.decoyT = time;
    this.state = 'CHASE';
    this.stateT = 0;
  };

  /* ══════════════ 蛇：潜伏伏击原型 ══════════════ */
  function Snake(x, y) {
    var s = P.animals.snake;
    this.type = 'snake';
    this.x = x; this.y = y;
    this.r = s.radius;
    this.cool = 0;
    this.biteT = 0;
    this.strike = 0;      // 弹起动画
    this.anim = Math.random() * 6.28;
  }

  Snake.prototype.update = function (dt, ctx) {
    var s = P.animals.snake;
    this.anim += dt * 3;
    if (this.cool > 0) { this.cool -= dt; }
    if (this.biteT > 0) {
      this.biteT -= dt;
      this.strike = 1;
      if (this.biteT <= 0) {
        this.strike = 0;
        this.cool = 2.2;
        ctx.player.applyPoison(ctx);
      }
    } else if (this.cool <= 0) {
      var d = U.dist(this.x, this.y, ctx.player.x, ctx.player.y);
      if (d < s.trigger) {
        this.biteT = s.biteDelay;
        ctx.bus.emit('snakeHiss', { x: this.x, y: this.y });
      }
    }
    if (this.strike > 0) this.strike = Math.max(0, this.strike - dt * 2.5);
  };

  /* ══════════════ 兔：资源生物原型 ══════════════ */
  function Rabbit(x, y) {
    var r = P.animals.rabbit;
    this.type = 'rabbit';
    this.x = x; this.y = y;
    this.r = r.radius;
    this.vx = 0; this.vy = 0;
    this.fleeing = false;
    this.facing = Math.random() * U.TAU;
    this.wanderT = 0;
    this.anim = Math.random() * 6.28;
    this.dead = false;
    this.caught = false;
    this.bias = (Math.random() - 0.5) * 0.8;   // 逃跑方向的少量随机偏移
  }

  Rabbit.prototype.update = function (dt, ctx) {
    var r = P.animals.rabbit;
    this.anim += dt * (this.fleeing ? 16 : 3);
    var player = ctx.player;
    var d = U.dist(this.x, this.y, player.x, player.y);

    if (d < r.senseDist) {
      this.fleeing = true;
      var dx = this.x - player.x, dy = this.y - player.y;
      var ang = Math.atan2(dy, dx) + this.bias;
      var sp = r.speed;
      this.vx = Math.cos(ang) * sp;
      this.vy = Math.sin(ang) * sp;
      this.facing = ang;
    } else {
      this.fleeing = false;
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 1.2 + Math.random() * 1.8;
        this.facing = Math.random() * U.TAU;
      }
      this.vx = Math.cos(this.facing) * r.wanderSpeed;
      this.vy = Math.sin(this.facing) * r.wanderSpeed;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    ctx.world.resolveCircle(this);
    ctx.world.clampToBounds(this);
  };

  /* ══════════════ 资源 ══════════════ */
  var RES_STYLE = {
    berry: { r: 9, color: '#d4455a', glow: '#ff8a9c' },
    gold:  { r: 11, color: '#f0b45c', glow: '#ffe3a8' },
    wood:  { r: 11, color: '#8a6440', glow: '#c49a6a' },
    herb:  { r: 10, color: '#5f9e58', glow: '#a8e0a0' }
  };

  function Resource(type, x, y) {
    this.type = 'resource';
    this.res = type;
    this.x = x; this.y = y;
    this.r = RES_STYLE[type].r;
    this.alive = true;
    this.cool = 0;          // 采集冷却
    this.collecting = 0;    // 0 到 1 的采集进度
    this.anim = Math.random() * 6.28;
    this.bob = Math.random() * 6.28;
  }

  Resource.prototype.update = function (dt, ctx) {
    this.anim += dt * 2.4;
    this.bob += dt * 2.8;
    if (this.cool > 0) {
      this.cool -= dt;
      if (this.cool <= 0) { this.alive = true; this.collecting = 0; }
    }
  };

  /* ══════════════ 火堆 ══════════════ */
  function Fire(x, y) {
    this.type = 'fire';
    this.x = x; this.y = y;
    this.r = P.fire.radius;
    this.wood = P.fire.woodStock;
    this.lit = this.wood > 0;
    this.burnT = 0;
    this.anim = Math.random() * 6.28;
    this.everLit = this.lit;
    this.flicker = 0;
  }

  Fire.prototype.update = function (dt, ctx) {
    this.anim += dt * 6;
    if (this.lit) {
      this.burnT += dt;
      while (this.burnT >= P.fire.burnTime) {
        this.burnT -= P.fire.burnTime;
        if (this.wood > 0) { this.wood--; }
        else { this.lit = false; break; }
      }
      this.flicker = 0.8 + 0.2 * Math.sin(this.anim * 1.7) + 0.1 * Math.sin(this.anim * 3.1);
    } else {
      this.flicker = 0;
    }
    // 玩家送木头
    if (this.lit && ctx.player.wood > 0 && U.dist(ctx.player.x, ctx.player.y, this.x, this.y) < this.r * 0.75) {
      ctx.player.wood--;
      this.wood = Math.min(99, this.wood + 1);
      this.lit = true;
      ctx.bus.emit('fireStoke', { x: this.x, y: this.y });
    }
  };

  DF.Entities = {
    Player: Player, Bear: Bear, Snake: Snake, Rabbit: Rabbit,
    Resource: Resource, Fire: Fire, RES_STYLE: RES_STYLE
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = DF.Entities; }
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));