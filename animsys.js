/* ---------------- 动作系统 A 档：程序化手感层 ----------------
   方案见 策划/动作系统调整方案_v1.md 第 3 节 S1–S10。
   这里只放"曲线与表"，不碰游戏逻辑：game.js 每帧把状态喂进来，
   取回第一人称武器/相机的偏移量再叠加到原来的基座上。
   调参入口：?animdbg=1 会把当前档位、相位写进 document.title。 */
(function () {
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const ease = (t) => t * t * (3 - 2 * t);
  const q = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams('');
  const DBG = q.get('animdbg') === '1';

  /* S9 分武器第一人称手感表
     dur   一次攻击的总时长
     ay/az/rx/ry/rz  冲击帧的武器位移与旋转幅度
     seg   前摇/冲击/收势占总时长的比例
     bob   待机呼吸幅度 */
  const SPEC = {
    blade:      { id: 'sword', dur: 0.32, ay: 0.058, az: 0.115, rx: -0.92, ry: 0.24, rz: 1.02, bob: 0.009, seg: [0.10, 0.12, 0.10] },
    greatsword: { id: 'great', dur: 0.52, ay: 0.080, az: 0.150, rx: -1.08, ry: 0.18, rz: 1.16, bob: 0.011, seg: [0.20, 0.14, 0.18] },
    boxer:      { id: 'fist',  dur: 0.24, ay: 0.038, az: 0.165, rx: -0.52, ry: 0.10, rz: 0.52, bob: 0.013, seg: [0.07, 0.10, 0.07] },
    monk:       { id: 'staff', dur: 0.36, ay: 0.062, az: 0.125, rx: -0.80, ry: 0.30, rz: 0.95, bob: 0.009, seg: [0.11, 0.13, 0.12] },
    assassin:   { id: 'dagger', dur: 0.22, ay: 0.044, az: 0.105, rx: -0.72, ry: 0.36, rz: 0.82, bob: 0.007, seg: [0.06, 0.09, 0.07] },
    gunner:     { id: 'gun',   dur: 0.26, ay: 0.048, az: 0.090, rx: -0.34, ry: 0.08, rz: 0.34, bob: 0.006, seg: [0.08, 0.09, 0.09] },
    sniper:     { id: 'rifle', dur: 0.44, ay: 0.044, az: 0.100, rx: -0.30, ry: 0.06, rz: 0.28, bob: 0.005, seg: [0.16, 0.12, 0.16] },
    mage:       { id: 'staff', dur: 0.40, ay: 0.050, az: 0.120, rx: -0.62, ry: 0.28, rz: 0.72, bob: 0.008, seg: [0.14, 0.12, 0.14] },
    frost:      { id: 'wand',  dur: 0.36, ay: 0.050, az: 0.118, rx: -0.60, ry: 0.26, rz: 0.70, bob: 0.008, seg: [0.12, 0.12, 0.12] },
    priest:     { id: 'mace',  dur: 0.34, ay: 0.055, az: 0.112, rx: -0.72, ry: 0.20, rz: 0.86, bob: 0.008, seg: [0.11, 0.12, 0.11] }
  };
  const DEFAULT_SPEC = SPEC.blade;

  /* 攻击档位：轻 0.32 / 重 0.52 / 技能 0.70，按比例缩放各武器的分段时间 */
  const TIER = { light: { base: 0.32, wind: 0.10, strike: 0.12, rec: 0.10 },
                 heavy: { base: 0.52, wind: 0.20, strike: 0.14, rec: 0.18 },
                 skill: { base: 0.70, wind: 0.28, strike: 0.16, rec: 0.26 } };

  const S = {
    spec: DEFAULT_SPEC,
    cls: 'blade',
    attackT: 0, attackDur: 0, attackSeg: TIER.light, tier: 'light',
    bobT: 0,
    startT: 0, stopT: 0, wasMoving: false,
    jumpT: 0, airT: 0, landT: 0,
    hurtT: 0, hurtDur: 0, hurtAmp: 0, hurtPush: 0,
    roll: 0, lastYaw: null,
    comboN: 0, comboT: -9, comboMul: 1
  };

  function specOf(cls) { return SPEC[cls] || DEFAULT_SPEC; }

  /* ---------- S7 攻击三档：由 game.js 在起手时调用 ---------- */
  function attack(tier) {
    const sp = S.spec;
    const t = TIER[tier] || TIER.light;
    // 武器自身节奏与档位取较大者：重剑的重击本来就慢，不再被档位拉长
    const dur = Math.max(sp.dur, t.base);
    S.tier = tier || 'light';
    S.attackDur = dur;
    S.attackT = 0;
    S.attackSeg = {
      wind: Math.max(t.wind, sp.seg[0]),
      strike: Math.max(t.strike, sp.seg[1]),
      rec: Math.max(t.rec, sp.seg[2]) * 0.85
    };
  }

  /* ---------- S5 受击三档 ---------- */
  function hurt(ratio) {
    const r = clamp(ratio || 0, 0, 1);
    let amp = 0.10, dur = 0.12, push = 0;
    if (r >= 0.15) { amp = 0.38; dur = 0.26; push = 0.18; }
    else if (r >= 0.05) { amp = 0.22; dur = 0.20; push = 0.08; }
    // 同帧连击取更重的一档，不叠加成抖动
    if (dur < S.hurtDur && S.hurtT > 0) return;
    S.hurtAmp = amp; S.hurtDur = dur; S.hurtPush = push; S.hurtT = dur;
  }

  function jump() { S.jumpT = 0.10; S.airT = 0; }
  function land() { S.landT = 0.10; S.airT = 0; }

  /* ---------- S8 连段：0.5 秒内接续 → 1.15 倍；断连 → 0.85 倍 ---------- */
  function combo(dtNow) {
    if (dtNow - S.comboT < 0.5) {
      S.comboN += 1;
      S.comboMul = 1.15;
    } else {
      S.comboN = 1;
      S.comboMul = 0.85;
    }
    S.comboT = dtNow;
    return { n: S.comboN, mul: S.comboMul };
  }

  /* ---------- 主推进：每帧算武器与相机增量 ---------- */
  function step(dt, st) {
    st = st || {};
    const sp = specOf(st.cls || S.cls);
    if (sp !== S.spec) { S.spec = sp; S.cls = st.cls || S.cls; }

    const speed = st.speed || 0;
    const moving = !!st.moving;

    // S2 起跑急停
    if (moving && !S.wasMoving) S.startT = 0.12;
    if (!moving && S.wasMoving && speed < 0.2) S.stopT = 0.18;
    S.wasMoving = moving;
    S.startT = Math.max(0, S.startT - dt);
    S.stopT = Math.max(0, S.stopT - dt);

    // S1 步频随速
    const freq = clamp(speed / 1.72, 1.2, 5.4);
    S.bobT += dt * freq * 2 * Math.PI;

    // 调试巡检：?animdbg=1 时自动轮播 轻→重→技能 三档，方便逐档看曲线
    if (DBG && S.attackDur <= 0) {
      S.dbgT = (S.dbgT || 0) + dt;
      if (S.dbgT > 1.0) {
        S.dbgT = 0;
        const cyc = ['light', 'heavy', 'skill'];
        S.dbgI = ((S.dbgI || 0) + 1) % 3;
        attack(cyc[S.dbgI]);
      }
    }

    // 攻击计时
    if (S.attackDur > 0) {
      S.attackT += dt;
      if (S.attackT >= S.attackDur) { S.attackT = 0; S.attackDur = 0; }
    }
    S.hurtT = Math.max(0, S.hurtT - dt);
    S.landT = Math.max(0, S.landT - dt);
    S.jumpT = Math.max(0, S.jumpT - dt);
    if (st.airborne) S.airT += dt; else S.airT = 0;

    // 跳跃三段：起跳下压 0.10s → 滞空随 vy → 落地缓冲 0.10s
    let jumpY = 0;
    if (S.jumpT > 0) {
      const k = S.jumpT / 0.10;
      jumpY = -0.055 * Math.sin(k * Math.PI * 0.5);
    } else if (st.airborne) {
      jumpY = -0.02;
    }
    if (S.landT > 0) {
      const k = S.landT / 0.10;
      jumpY = -0.10 * Math.sin(k * Math.PI);
    }

    // 起跑过冲 / 急停后撤
    let startZ = 0, startY = 0, stopZ = 0;
    if (S.startT > 0) {
      const k = S.startT / 0.12;
      startZ = 0.19 * Math.sin((1 - k) * Math.PI) * 0.6;
      startY = -0.012 * Math.sin((1 - k) * Math.PI);
    }
    if (S.stopT > 0) {
      const k = S.stopT / 0.18;
      stopZ = -0.05 * Math.sin((1 - k) * Math.PI);
    }

    // 攻击曲线
    let aW = 0, aH = 0, aR = 0;
    if (S.attackDur > 0) {
      const u = S.attackT;
      const seg = S.attackSeg;
      if (u < seg.wind) aW = ease(u / seg.wind);
      else if (u < seg.wind + seg.strike) {
        const k = (u - seg.wind) / seg.strike;
        aW = 1 - ease(k);
        aH = Math.sin(k * Math.PI);
        aR = Math.sin(k * Math.PI);
      }
    }

    const off = {
      x: Math.sin(S.bobT) * sp.bob * (moving ? 1.6 : 1.0),
      y: Math.sin(S.bobT * 2) * sp.bob * 0.62 + jumpY + startY,
      z: -aW * 0.055 + aH * sp.az + startZ + stopZ,
      rx: -aW * 0.22 + aH * sp.rx,
      ry: aH * sp.ry,
      rz: aH * sp.rz,
      phase: S.attackDur > 0 ? S.attackT / S.attackDur : 0,
      tier: S.tier,
      freq: freq,
      air: st.airborne ? 1 : 0
    };

    // S5 受击镜头：amp 与后推
    const hurtK = S.hurtDur > 0 ? S.hurtT / S.hurtDur : 0;
    const hurtS = Math.sin(hurtK * Math.PI);
    off.camRx = hurtS * S.hurtAmp;
    off.camPush = hurtS * S.hurtPush;

    // S3 转身侧倾：yaw 角速度 → 相机 roll，最多 5°
    const yaw = typeof st.yaw === 'number' ? st.yaw : 0;
    if (S.lastYaw == null) S.lastYaw = yaw;
    let dy = yaw - S.lastYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    S.lastYaw = yaw;
    const yawVel = dt > 0 ? dy / dt : 0;
    const target = clamp(yawVel * 0.028, -0.087, 0.087);
    S.roll += (target - S.roll) * Math.min(1, dt * 10);
    off.roll = S.roll;

    if (DBG) {
      document.title = 'anim t=' + Math.round(S.attackT * 100) / 100 + '/' + S.attackDur.toFixed(2) +
        ' ' + S.tier + ' ph=' + off.phase.toFixed(2) + ' f=' + freq.toFixed(2) +
        ' combo=' + S.comboN + 'x' + S.comboMul + ' hurt=' + S.hurtT.toFixed(2) +
        ' roll=' + S.roll.toFixed(3) + ' air=' + off.air + ' sp=' + sp.id +
        ' cf=' + (window.Comfort && Comfort.isOn() ? 1 : 0);
    }
    return off;
  }

  window.AnimSys = {
    spec: specOf, attack, hurt, jump, land, combo, step,
    state: S,
    version: 'anim-A-v1'
  };
})();
