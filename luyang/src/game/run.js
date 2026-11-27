/* 拼车狂飙 · 单局：撞装 / 窄路 / 掉落 / 技能 / 星级 */
(function (global) {
  'use strict';
  var LY = global.LY = global.LY || {};

  function createState(progress, levelCfg) {
    var P = LY.Params;
    var lv = levelCfg || LY.Levels.get(1);
    var tier = (progress && progress.vehicleTier) || 1;
    var vehicle = LY.Vehicles.get(tier);
    var skill = vehicle.skill;
    return {
      level: lv,
      levelId: lv.id,
      goalDistance: lv.goalDistance || P.goalDistance,
      vehicle: vehicle,
      vehicleTier: tier,
      distance: 0,
      lane: 1,
      laneSmooth: 1,
      scroll: 0,
      tempParts: [],
      entities: [],
      pickedLevels: [],
      status: 'running',
      endReason: '',
      result: null,
      checkpointDone: false,
      checkpointAt: lv.checkpointAt != null ? lv.checkpointAt : 0.55,
      checkpointChoice: null,
      hits: 0,
      hardRushFails: 0,
      runTime: 0,
      skillCd: 0,
      skillCharges: skill.chargesPerRun > 0 ? skill.chargesPerRun : 99,
      skillChargesFinite: skill.chargesPerRun > 0,
      buff: {
        iframe: 0,
        speedburst: 0,
        speedMul: 1,
        slim: 0,
        widthMul: 1,
        stable: 0,
        offroad: 0,
        nextShield: 0,
        dumpBoost: 0
      },
      timers: {
        absorb: lv.teachAbsorb ? 99 : 4,
        hazard: lv.teachAbsorb ? 99 : 3.5,
        drop: lv.teachAbsorb ? 12 : 6
      },
      absorbInterval: lv.absorbInterval || P.absorbInterval,
      hazardInterval: lv.hazardInterval || P.obstacleInterval,
      log: [],
      teach: lv.teachAbsorb ? {
        active: true,
        phase: 'absorb', /* absorb | skill | widen | checkpoint | done */
        tip: '←→ 对准发光废铁，撞上去变强！',
        absorbDone: false,
        skillDone: false,
        widenHint: false,
        checkpointHint: false
      } : null,
      fx: { absorbFlash: 0, discardFlash: 0 }
    };
  }

  function ensureTeachScrap(state) {
    if (!state.teach || state.teach.absorbDone) return;
    var has = false;
    for (var i = 0; i < state.entities.length; i++) {
      if (state.entities[i].teachTarget) { has = true; break; }
    }
    if (has) return;
    state.entities.push({
      kind: 'absorb',
      partId: 'wide_tire',
      lane: 1,
      z: 900,
      teachTarget: true
    });
  }

  function derived(state) {
    var d = LY.Parts.derive(state.tempParts, state.vehicle);
    if (state.buff.slim > 0) d.width *= state.buff.widthMul || 0.7;
    if (state.buff.stable > 0) d.width = Math.min(d.width, state.vehicle.baseWidth * 1.05);
    if (state.buff.dumpBoost > 0) d.speedMul *= 1.25;
    if (state.buff.speedburst > 0) d.speedMul *= state.buff.speedMul || 1.35;
    return d;
  }

  function currentSpeed(state) {
    var P = LY.Params;
    var d = derived(state);
    var mul = LY.Util.clamp(d.speedMul, 0.55, P.maxSpeedMul);
    return P.baseSpeed * mul;
  }

  function progressRatio(state) {
    return LY.Util.clamp(state.distance / state.goalDistance, 0, 1);
  }

  function countPart(state, id) {
    var n = 0;
    for (var i = 0; i < state.tempParts.length; i++) if (state.tempParts[i] === id) n++;
    return n;
  }

  function tryAbsorb(state, partId, fromTeach) {
    var part = LY.Parts.get(partId);
    if (!part) return false;
    if (state.tempParts.length >= LY.Params.bagSlotsTemp) {
      state.tempParts.shift();
    }
    if (countPart(state, partId) >= (part.maxStacks || 2)) {
      state.log.push(part.name + '已叠满');
      return false;
    }
    state.tempParts.push(partId);
    state.log.push('拼上 ' + part.name);
    state.fx.absorbFlash = 0.55;
    if (state.teach && !state.teach.absorbDone) {
      state.teach.absorbDone = true;
      state.teach.phase = 'skill';
      state.teach.tip = '变宽了！按 空格/技能键「铃响闪身」躲一次障碍';
      state.timers.hazard = 2.2;
      state.timers.absorb = 5;
      state.timers.drop = 8;
    } else if (
      state.teach &&
      state.teach.absorbDone &&
      state.teach.phase !== 'done' &&
      state.teach.phase !== 'checkpoint' &&
      !state.teach.widenHint &&
      state.tempParts.length >= 2
    ) {
      state.teach.widenHint = true;
      state.teach.phase = 'widen';
      state.teach.tip = '车越拼越宽。前方有窄路，太大就过不去';
    }
    return true;
  }

  function discardOne(state, partId) {
    var ok = false;
    if (partId) {
      var i = state.tempParts.indexOf(partId);
      if (i >= 0) {
        state.tempParts.splice(i, 1);
        ok = true;
      }
    } else if (state.tempParts.length) {
      state.tempParts.pop();
      ok = true;
    }
    if (ok) state.fx.discardFlash = 0.45;
    return ok;
  }

  function spawn(state, rng, kind) {
    var P = LY.Params;
    var lane = rng.int(0, P.laneCount - 1);
    var z = P.spawnZ + rng.range(0, 100);
    if (state.teach && !state.teach.absorbDone && kind !== 'absorb') return;
    if (kind === 'absorb') {
      state.entities.push({ kind: 'absorb', partId: LY.Parts.randomId(rng), lane: lane, z: z });
    } else if (kind === 'drop') {
      state.entities.push({ kind: 'drop', itemLevel: state.level.dropLevel || LY.Params.dropLevel(state.levelId), lane: lane, z: z });
    } else if (kind === 'hazard') {
      /* 教学前半段：障碍非致命，方便练技能 */
      var fatal = rng.chance(0.35);
      if (state.teach && state.teach.phase === 'skill') fatal = false;
      state.entities.push({ kind: 'hazard', fatal: fatal, lane: lane, z: z, dmg: 1 });
    } else if (kind === 'wall') {
      state.entities.push({ kind: 'wall', lane: -1, z: z, maxWidth: state.level.checkpointMaxWidth || 1.2 });
    }
  }

  function hitHazard(state, ent) {
    if (state.buff.iframe > 0) return;
    if (!ent.fatal && state.buff.nextShield > 0) {
      state.buff.nextShield = 0;
      state.log.push('安全带生效');
      return;
    }
    var d = derived(state);
    if (!ent.fatal && d.shield > 0) {
      /* 消耗一个 bumper */
      var bi = state.tempParts.indexOf('bumper');
      if (bi >= 0) state.tempParts.splice(bi, 1);
      state.log.push('防撞杠挡下');
      state.hits += 1;
      return;
    }
    if (ent.fatal) {
      endRun(state, 'crash');
      return;
    }
    state.hits += 1;
    if (state.tempParts.length) discardOne(state, null);
    if (state.hits >= 3) endRun(state, 'crash');
  }

  function openCheckpoint(state) {
    state.status = 'checkpoint';
    state.checkpointDone = true;
    if (state.teach) {
      state.teach.phase = 'checkpoint';
      state.teach.checkpointHint = true;
      state.teach.tip = '窄路来了：丢掉一件零件变瘦，或硬闯（太宽会卡）';
    }
  }

  function chooseCheckpoint(state, action, partId) {
    if (state.status !== 'checkpoint') return { ok: false };
    var d = derived(state);
    var maxW = state.level.checkpointMaxWidth || 1.2;
    if (action === 'discard') {
      if (!discardOne(state, partId)) return { ok: false, reason: '没有可丢的零件' };
      state.log.push('丢掉零件过窄路');
      state.status = 'running';
      if (state.teach) {
        state.teach.phase = 'done';
        state.teach.tip = '懂了：要不要撞？撞了变强，太大就丢掉';
      }
      return { ok: true };
    }
    if (action === 'rush') {
      if (d.width > maxW) {
        state.hardRushFails += 1;
        state.hits += 1;
        state.log.push('太宽，卡住了');
        if (state.tempParts.length) discardOne(state, null);
        if (state.hits >= 3) {
          endRun(state, 'stuck');
          return { ok: true };
        }
      }
      state.status = 'running';
      return { ok: true };
    }
    return { ok: false };
  }

  function useSkill(state) {
    if (state.status !== 'running') return { ok: false, reason: '现在不能放技能' };
    if (state.skillCd > 0) return { ok: false, reason: '冷却中' };
    if (state.skillChargesFinite && state.skillCharges <= 0) return { ok: false, reason: '次数用尽' };
    var skill = state.vehicle.skill;
    var p = skill.effectParams || {};
    switch (skill.effectType) {
      case 'iframe':
        state.buff.iframe = p.duration || 0.8;
        break;
      case 'speedburst':
        state.buff.speedburst = p.duration || 3;
        state.buff.speedMul = p.mul || 1.35;
        break;
      case 'lane_slim':
        state.buff.slim = p.duration || 1.2;
        state.buff.widthMul = p.widthMul || 0.7;
        state.lane = LY.Util.clamp(state.lane + (state.lane < 2 ? 1 : -1), 0, LY.Params.laneCount - 1);
        break;
      case 'stable':
        state.buff.stable = p.duration || 2.5;
        break;
      case 'clear_small':
        clearAhead(state, p.range || 420);
        break;
      case 'next_shield':
        state.buff.nextShield = 1;
        break;
      case 'offroad':
        state.buff.offroad = p.duration || 5;
        break;
      case 'dump_crate':
        if (!discardOne(state, 'crate')) discardOne(state, null);
        state.buff.dumpBoost = p.duration || 1.2;
        break;
      default:
        state.buff.iframe = 0.6;
    }
    state.skillCd = skill.cooldown || 12;
    if (state.skillChargesFinite) state.skillCharges -= 1;
    state.log.push('技能：' + skill.name);
    if (state.teach && state.teach.phase === 'skill') {
      state.teach.skillDone = true;
      state.teach.phase = 'widen';
      state.teach.tip = '技能可用！继续撞废铁变强，但注意宽度';
    }
    return { ok: true };
  }

  function clearAhead(state, rangeZ) {
    for (var i = state.entities.length - 1; i >= 0; i--) {
      var e = state.entities[i];
      if (e.kind === 'hazard' && !e.fatal && e.z > 0 && e.z < rangeZ) {
        state.entities.splice(i, 1);
      }
    }
  }

  function calcStars(state) {
    if (state.endReason !== 'goal') return 0;
    var t3 = state.level.starTime3 || LY.Params.starTime3;
    var t2 = state.level.starTime2 || LY.Params.starTime2;
    var integ = derived(state).integrity;
    var minI = LY.Params.starMinIntegrity3;
    if (state.runTime <= t3 && state.hits <= 1 && integ >= minI && state.hardRushFails === 0) return 3;
    if (state.runTime <= t2 && state.hits <= 2) return 2;
    return 1;
  }

  function buildDrops(state, stars, rng) {
    var base = state.level.dropCount || LY.Params.dropBaseCount;
    var n = base;
    if (stars >= 3) n += 1;
    if (stars <= 1 && stars > 0) n = Math.max(1, n - 1);
    if (stars <= 0) n = state.pickedLevels.length ? 0 : 0;
    /* 已拾取的 + 结算补足到 n */
    var out = state.pickedLevels.slice();
    var lv = state.level.dropLevel || LY.Params.dropLevel(state.levelId);
    while (out.length < n) out.push(lv);
    if (stars <= 0) return state.pickedLevels.slice(0, 1);
    return out.slice(0, Math.max(n, out.length));
  }

  function settle(state, rng) {
    var stars = calcStars(state);
    var gold = LY.Params.stageGold(state.levelId, stars);
    var drops = buildDrops(state, stars, rng);
    var d = derived(state);
    gold = Math.floor(gold * (0.85 + 0.15 * d.scoreMul));
    return {
      distance: Math.floor(state.distance),
      goal: state.goalDistance,
      gold: gold,
      stars: stars,
      events: 0,
      reason: state.endReason,
      survived: state.endReason === 'goal',
      levelId: state.levelId,
      levelName: state.level.name,
      nextLevelId: LY.Levels.nextId(state.levelId),
      drops: drops,
      vehicleName: state.vehicle.name,
      parts: state.tempParts.slice(),
      runTime: Math.floor(state.runTime)
    };
  }

  function endRun(state, reason) {
    if (state.status === 'ended') return;
    state.status = 'ended';
    state.endReason = reason;
    state.result = settle(state, LY.Util.rng(1));
  }

  function tickBuffs(state, dt) {
    var b = state.buff;
    if (b.iframe > 0) b.iframe -= dt;
    if (b.speedburst > 0) b.speedburst -= dt;
    if (b.slim > 0) b.slim -= dt;
    if (b.stable > 0) b.stable -= dt;
    if (b.offroad > 0) b.offroad -= dt;
    if (b.dumpBoost > 0) b.dumpBoost -= dt;
    if (state.skillCd > 0) state.skillCd -= dt;
  }

  function update(state, dt, rng) {
    if (state.status === 'ended' || state.status === 'paused' || state.status === 'checkpoint') return;

    state.runTime += dt;
    tickBuffs(state, dt);
    if (state.fx.absorbFlash > 0) state.fx.absorbFlash -= dt;
    if (state.fx.discardFlash > 0) state.fx.discardFlash -= dt;

    ensureTeachScrap(state);

    var P = LY.Params;
    var spd = currentSpeed(state);
    state.distance += spd * dt;
    state.scroll += spd * dt;

    var lerp = 1 - Math.exp(-P.laneLerp * dt);
    state.laneSmooth += (state.lane - state.laneSmooth) * lerp;

    /* 教学：未撞第一件前不刷普通障碍/掉落 */
    if (!state.teach || state.teach.absorbDone) {
      state.timers.absorb -= dt;
      state.timers.hazard -= dt;
      state.timers.drop -= dt;
      if (state.timers.absorb <= 0) {
        spawn(state, rng, 'absorb');
        state.timers.absorb = rng.range(state.absorbInterval[0], state.absorbInterval[1]);
      }
      if (state.timers.hazard <= 0) {
        spawn(state, rng, 'hazard');
        state.timers.hazard = rng.range(state.hazardInterval[0], state.hazardInterval[1]);
      }
      if (state.timers.drop <= 0) {
        spawn(state, rng, 'drop');
        state.timers.drop = rng.range(P.dropInterval[0], P.dropInterval[1]);
      }
    }

    if (!state.checkpointDone && progressRatio(state) >= state.checkpointAt) {
      if (state.teach && !state.teach.absorbDone) {
        /* 没撞过废铁则推迟窄路，避免跳过教学 */
        state.checkpointAt = Math.min(0.88, progressRatio(state) + 0.18);
      } else {
        openCheckpoint(state);
        return;
      }
    }

    var carLane = state.lane;
    for (var i = state.entities.length - 1; i >= 0; i--) {
      var e = state.entities[i];
      e.z -= spd * dt;
      /* 教学目标：始终对齐玩家车道，降低「找不到」 */
      if (e.teachTarget && state.teach && !state.teach.absorbDone) {
        e.lane = state.lane;
      }
      var near = e.z <= P.hitZ && e.z >= -P.hitZ * 0.4;
      var same = e.lane < 0 || Math.abs(e.lane - carLane) < 0.5 || (state.buff.offroad > 0);
      if (near && same) {
        if (e.kind === 'absorb') tryAbsorb(state, e.partId, !!e.teachTarget);
        else if (e.kind === 'drop') {
          state.pickedLevels.push(e.itemLevel);
          state.log.push('拾取 Lv' + e.itemLevel + ' 材料');
        } else if (e.kind === 'hazard') hitHazard(state, e);
        state.entities.splice(i, 1);
        if (state.status === 'ended') return;
        continue;
      }
      if (e.z < P.despawnZ) {
        if (e.teachTarget && state.teach && !state.teach.absorbDone) {
          /* 漏撞则在前方再刷一块 */
          state.entities.splice(i, 1);
          ensureTeachScrap(state);
          state.entities[state.entities.length - 1].z = 1100;
          continue;
        }
        state.entities.splice(i, 1);
      }
    }

    if (state.distance >= state.goalDistance) endRun(state, 'goal');
  }

  function changeLane(state, dir) {
    if (state.status !== 'running') return;
    var d = derived(state);
    /* 越宽变道略钝：有概率？直接允许但 UI 可提示 */
    state.lane = LY.Util.clamp(state.lane + dir, 0, LY.Params.laneCount - 1);
  }

  function togglePause(state) {
    if (!state || state.status === 'ended' || state.status === 'checkpoint') return state && state.status;
    if (state.status === 'paused') state.status = 'running';
    else if (state.status === 'running') state.status = 'paused';
    return state.status;
  }

  LY.Run = {
    create: createState,
    update: update,
    derived: derived,
    currentSpeed: currentSpeed,
    progressRatio: progressRatio,
    changeLane: changeLane,
    togglePause: togglePause,
    useSkill: useSkill,
    chooseCheckpoint: chooseCheckpoint,
    tryAbsorb: tryAbsorb,
    discardOne: discardOne
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = LY.Run;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof window !== 'undefined' ? window : globalThis));
