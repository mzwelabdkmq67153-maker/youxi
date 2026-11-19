/* ============================================================
   第七竞技场 · 特效层 fx.js   v2
   依据 art/特效/ 六帧参考与定案参数：
     墨斩 0.12+0.15+0.40 = 0.67s · 青白 #7FD8FF · ≤18 面片
     击发 0.08+0.10+0.30 = 0.48s · 青白 · ≤12
     法爆 0.15+0.30+0.50 = 0.95s · 淡紫 #C9A2FF · ≤24
     敌受击 0.20+0.35     = 0.55s · 朱红 #FF5A5F · ≤12
     玩家受击 0.25+0.40   = 0.65s · 朱红 · 只走四条屏幕边（DOM 通道）
     落地 0.30+0.50       = 0.80s · 灰白墨 · ≤20
   铁律：笔触而非粒子；不遮准心（世界特效全在准心外 0.35 半径）；
         四色分组（青白=玩家、朱红=敌方受击、淡紫=法术、灰白=位移）；
         同屏活跃组 ≤4，边缘晕独立通道不计入。
   ============================================================ */
(function () {
  'use strict';

  const COLD = 0x7fd8ff;
  const VIOLET = 0xc9a2ff;
  const WARM = 0xff5a5f;
  const INK = 0xd6e4ee;
  const MAX_GROUPS = 4;

  let scene = null;
  const live = [];
  let total = 0;

  function dispose(rec) {
    rec.group.traverse(function (o) {
      if (!o.isMesh) return;
      o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    if (rec.group.parent) rec.group.parent.remove(rec.group);
  }

  function makeFx(life) {
    const group = new THREE.Group();
    const rec = { group: group, parts: [], t: 0, life: life };
    group.userData.fxRec = rec;
    if (scene) scene.add(group);
    live.push(rec);
    total++;
    while (live.length > MAX_GROUPS) dispose(live.shift());
    return rec;
  }

  function part(group, mesh, delay, dur, peak, grow) {
    const rec = group.userData.fxRec;
    mesh.material.opacity = 0;
    mesh.visible = false;
    group.add(mesh);
    rec.parts.push({ mesh: mesh, delay: delay, dur: dur, peak: peak, grow: grow || 1.45 });
  }

  function mat(color, additive) {
    return new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: additive === false ? THREE.NormalBlending : THREE.AdditiveBlending
    });
  }

  /* 一支有收锋的笔触：起笔钝、中段带弯、收笔成尖 */
  function strokeGeo(len, wid, bend) {
    const s = new THREE.Shape();
    s.moveTo(0, -wid * 0.5);
    s.quadraticCurveTo(len * 0.52, -wid * 0.5 + bend, len, 0);
    s.quadraticCurveTo(len * 0.52, wid * 0.5 + bend, 0, wid * 0.5);
    s.lineTo(0, -wid * 0.5);
    return new THREE.ShapeGeometry(s, 10);
  }

  /* rot: [rx, ry, rz] */
  function stroke(group, color, o) {
    const mesh = new THREE.Mesh(strokeGeo(o.len, o.wid, o.bend || 0), mat(color, o.normal ? false : true));
    mesh.position.set(o.x, o.y, o.z || 0);
    mesh.rotation.set(o.rot ? o.rot[0] : 0, o.rot ? o.rot[1] : 0, o.rot ? o.rot[2] : 0);
    part(group, mesh, o.delay, o.dur, o.peak, o.grow);
    return mesh;
  }

  function ring(parent, color, r, tube, y, peak, delay, dur) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.001, r - tube), r, 24), mat(color, false));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, y, 0);
    part(parent, mesh, delay, dur, peak, 1.9);
    return mesh;
  }

  const D = Math.PI / 180;

  /* 弧：沿以 (cx,cy) 为圆心的圆，按切向铺笔触 */
  function arcBrush(group, color, opts) {
    const n = opts.n || 4;
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0 : i / (n - 1);
      const a = (opts.from + (opts.to - opts.from) * k) * D;
      stroke(group, color, {
        len: opts.len * (0.55 + 0.45 * Math.sin(Math.PI * (0.25 + 0.75 * k))),
        wid: opts.wid * (0.7 + 0.6 * (1 - k)),
        bend: opts.bend * (k > 0.5 ? -1 : 1),
        x: opts.cx + Math.cos(a) * opts.r,
        y: opts.cy + Math.sin(a) * opts.r,
        z: 0,
        rot: [0, 0, a + Math.PI / 2],
        delay: opts.delay,
        dur: opts.dur,
        peak: opts.peak * (0.55 + 0.45 * (1 - k)),
        grow: opts.grow || 1.35
      });
    }
  }

  /* ---------------- 墨斩：弧扫 + 飞白 ---------------- */
  function slash(pos, yaw) {
    const rec = makeFx(0.67);
    rec.group.position.copy(pos || new THREE.Vector3());
    rec.group.rotation.y = yaw || 0;

    // 前摇 0.12s：一暗一细，只交代挥向
    stroke(rec.group, 0x2f6b86, {
      len: 0.46, wid: 0.085, bend: 0.06, x: 0.24, y: -0.20, z: -0.10,
      rot: [0, 0, 128 * D], delay: 0.00, dur: 0.12, peak: 0.34
    });
    // 命中 0.15s：三笔从右下往左上扫，起笔钝、收笔尖
    stroke(rec.group, COLD, {
      len: 0.58, wid: 0.115, bend: 0.06, x: 0.26, y: -0.24, z: -0.12,
      rot: [0, 0, 120 * D], delay: 0.12, dur: 0.15, peak: 0.88, grow: 1.2, normal: true
    });
    stroke(rec.group, COLD, {
      len: 0.46, wid: 0.095, bend: 0.05, x: 0.22, y: -0.16, z: -0.14,
      rot: [0, 0, 136 * D], delay: 0.12, dur: 0.15, peak: 0.72, grow: 1.2, normal: true
    });
    stroke(rec.group, 0xffffff, {
      len: 0.42, wid: 0.048, bend: 0.045, x: 0.30, y: -0.26, z: -0.09,
      rot: [0, 0, 118 * D], delay: 0.12, dur: 0.15, peak: 0.65, grow: 1.2
    });
    // 余韵 0.40s：两笔飞白散到弧外侧
    stroke(rec.group, COLD, {
      len: 0.40, wid: 0.05, bend: 0.07, x: -0.26, y: 0.34, z: -0.18,
      rot: [0, 0, 96 * D], delay: 0.27, dur: 0.40, peak: 0.34
    });
    stroke(rec.group, COLD, {
      len: 0.32, wid: 0.045, bend: -0.05, x: -0.40, y: -0.06, z: -0.18,
      rot: [0, 0, 152 * D], delay: 0.27, dur: 0.40, peak: 0.28
    });
    return rec;
  }

  /* ---------------- 击发：枪口墨花 + 弹道 ---------------- */
  function muzzle(pos, yaw) {
    const rec = makeFx(0.48);
    rec.group.position.copy(pos || new THREE.Vector3());
    rec.group.rotation.y = yaw || 0;

    // 0.08s 枪口一点：短而亮
    stroke(rec.group, 0xffffff, { len: 0.48, wid: 0.19, bend: 0.02, x: 0, y: 0.04, z: 0, rot: [0, 0, 8 * D], delay: 0.00, dur: 0.08, peak: 0.95, grow: 1.3 });
    stroke(rec.group, COLD, { len: 0.34, wid: 0.14, bend: 0.02, x: -0.06, y: 0.02, z: 0, rot: [0, 0, 168 * D], delay: 0.00, dur: 0.08, peak: 0.85 });
    // 0.10s 墨花三瓣，向上散
    for (let i = 0; i < 3; i++) {
      const a = (48 + i * 40) * D;
      stroke(rec.group, COLD, {
        len: 0.38, wid: 0.11, bend: 0.03,
        x: Math.cos(a) * 0.07, y: Math.sin(a) * 0.07, z: 0,
        rot: [0, 0, a], delay: 0.08, dur: 0.10, peak: 0.85, grow: 1.6
      });
    }
    // 弹道：沿视线的长笔，略偏出枪管方向才看得见
    stroke(rec.group, COLD, {
      len: 2.40, wid: 0.16, bend: 0.02, x: 0.16, y: 0.04, z: 0,
      rot: [-Math.PI / 2, 0, 0], delay: 0.08, dur: 0.10, peak: 0.55
    });
    stroke(rec.group, 0xffffff, {
      len: 1.90, wid: 0.08, bend: 0.01, x: 0.16, y: 0.04, z: 0,
      rot: [-Math.PI / 2, 0, 0], delay: 0.08, dur: 0.10, peak: 0.40
    });
    return rec;
  }

  /* ---------------- 法爆：双层墨环 + 六瓣外扩 ---------------- */
  function orbBurst(pos, yaw) {
    const rec = makeFx(0.95);
    rec.group.position.copy(pos || new THREE.Vector3());
    rec.group.rotation.y = yaw || 0;

    // 地面双层墨环 + 一圈白芯
    ring(rec.group, VIOLET, 0.72, 0.045, 0.02, 0.55, 0.00, 0.15);
    ring(rec.group, VIOLET, 1.38, 0.11, 0.03, 0.90, 0.15, 0.30);
    ring(rec.group, 0xffffff, 1.08, 0.030, 0.04, 0.50, 0.15, 0.30);

    // 立面泼墨：五瓣向上外扩，避开正中
    for (let i = 0; i < 5; i++) {
      const a = (22 + i * 34) * D;
      stroke(rec.group, VIOLET, {
        len: 0.86 + (i % 2) * 0.16, wid: 0.20, bend: 0.05,
        x: Math.cos(a) * 0.30, y: 0.34 + Math.sin(a) * 0.26, z: -0.04,
        rot: [0, 0, a], delay: 0.15, dur: 0.30, peak: 0.62, grow: 1.8
      });
    }
    // 余韵：两笔外飘
    stroke(rec.group, VIOLET, { len: 0.78, wid: 0.10, bend: 0.12, x: -0.82, y: 0.62, z: -0.10, rot: [0, 0, 160 * D], delay: 0.45, dur: 0.50, peak: 0.32 });
    stroke(rec.group, VIOLET, { len: 0.66, wid: 0.09, bend: -0.10, x: 0.78, y: 0.58, z: -0.10, rot: [0, 0, 24 * D], delay: 0.45, dur: 0.50, peak: 0.28 });
    return rec;
  }

  /* ---------------- 敌受击：朱红短笔 + 墨点 ---------------- */
  function hit(pos, yaw) {
    const rec = makeFx(0.55);
    rec.group.position.copy(pos || new THREE.Vector3());
    rec.group.rotation.y = yaw || 0;

    stroke(rec.group, 0xffffff, { len: 0.20, wid: 0.16, bend: 0.02, x: -0.10, y: 0, z: 0, rot: [0, 0, 8 * D], delay: 0.00, dur: 0.20, peak: 0.85 });
    for (let i = 0; i < 4; i++) {
      const a = (30 + i * 42) * D;
      stroke(rec.group, WARM, {
        len: 0.42 + (i % 2) * 0.12, wid: 0.11, bend: 0.04,
        x: Math.cos(a) * 0.10, y: Math.sin(a) * 0.10, z: -0.04,
        rot: [0, 0, a], delay: 0.00, dur: 0.20, peak: 0.85 - i * 0.10, grow: 1.7
      });
    }
    stroke(rec.group, 0x8c2b33, {
      len: 0.55, wid: 0.13, bend: 0.05, x: -0.30, y: 0.18, z: -0.06,
      rot: [0, 0, 88 * D], delay: 0.20, dur: 0.35, peak: 0.30
    });
    return rec;
  }

  /* ---------------- 落地 / 疾跑：贴地环 + 四笔平铺 ---------------- */
  function land(pos) {
    const rec = makeFx(0.80);
    rec.group.position.copy(pos || new THREE.Vector3());

    ring(rec.group, 0xf2f7fb, 0.98, 0.058, 0.02, 0.85, 0.00, 0.30);
    for (let i = 0; i < 3; i++) {
      const a = (30 + i * 120) * D;
      stroke(rec.group, 0xdce9f2, {
        len: 0.95 + (i % 2) * 0.18, wid: 0.20, bend: 0.03,
        x: Math.cos(a) * 0.28, y: 0.02, z: Math.sin(a) * 0.28,
        rot: [-Math.PI / 2, -a, 0], delay: 0.00, dur: 0.30, peak: 0.85, grow: 2.0
      });
    }
    stroke(rec.group, INK, { len: 1.10, wid: 0.09, bend: 0.05, x: 0.10, y: 1.05, z: 0.62, rot: [-Math.PI / 2, 0, 0], delay: 0.30, dur: 0.50, peak: 0.24, grow: 2.4 });
    return rec;
  }

  /* ---------------- 玩家受击：只走四条屏幕边 ---------------- */
  function vignette() {
    const el = document.getElementById('flash');
    if (!el) return;
    el.classList.add('show');
    window.clearTimeout(vignette.t);
    vignette.t = window.setTimeout(function () { el.classList.remove('show'); }, 650);
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const rec = live[i];
      rec.t += dt;
      for (let j = 0; j < rec.parts.length; j++) {
        const p = rec.parts[j];
        const k = (rec.t - p.delay) / p.dur;
        if (k <= 0) { p.mesh.visible = false; continue; }
        p.mesh.visible = true;
        const kk = Math.min(1, k);
        const vis = kk < 0.2 ? kk / 0.2 : Math.max(0, 1 - (kk - 0.2) / 0.8);
        p.mesh.material.opacity = p.peak * vis;
        p.mesh.scale.setScalar(1 + (p.grow - 1) * kk);
      }
      if (rec.t >= rec.life + 0.02) {
        dispose(rec);
        live.splice(i, 1);
      }
    }
  }

  function init(sc) { scene = sc; }

  function stats() {
    return {
      active: live.length,
      max: MAX_GROUPS,
      layers: live.reduce(function (n, r) { return n + r.parts.length; }, 0),
      total: total
    };
  }

  window.ArenaFX = {
    init: init, update: update,
    slash: slash, muzzle: muzzle, orbBurst: orbBurst, hit: hit, land: land, vignette: vignette,
    stats: stats,
    COLORS: { COLD: COLD, VIOLET: VIOLET, WARM: WARM, INK: INK }
  };
})();
