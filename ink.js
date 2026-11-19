/* ============================================================
   ink.js — 特效的粒子层
   ------------------------------------------------------------
   fx.js 里的刀光/枪口/法爆是“面片”做法（描边、弧片、环）。
   这一层不替换它们，而是在同一批调用点上再吐一层真粒子：
   THREE.Points + 一枚墨点精灵，逐粒子算速度、重力、阻力、衰减。
   接法：包一层 ArenaFX，游戏侧仍然只调 ArenaFX.slash(...)，
   不用改 game.js 的任何一行。
   ============================================================ */
(function () {
  if (!window.THREE || !window.ArenaFX) return;

  var COL = { cold: 0x7fd8ff, violet: 0xc9a2ff, warm: 0xff5a5f, ink: 0xd6e4ee };
  var scene = null;
  var live = [];           // 活跃粒子批次
  var MAX_BURSTS = 6;      // 同屏批次上限（每批一次 drawcall）

  /* ---------- 墨点精灵：中心实、边缘晕 ---------- */
  var SPRITE = (function () {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var rg = g.createRadialGradient(32, 32, 0, 32, 32, 31);
    rg.addColorStop(0.00, 'rgba(255,255,255,1)');
    rg.addColorStop(0.35, 'rgba(255,255,255,0.82)');
    rg.addColorStop(0.70, 'rgba(255,255,255,0.22)');
    rg.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.beginPath(); g.arc(32, 32, 31, 0, Math.PI * 2); g.fill();
    var t = new THREE.CanvasTexture(c);
    t.userData = { shared: true };
    return t;
  })();

  var _v = new THREE.Vector3();

  /* ---------- 一次爆发 ---------- */
  function burst(pos, yaw, o) {
    if (!scene) return null;
    if (live.length >= MAX_BURSTS) {                  // 挤掉最老的一批，算力优先
      var old = live.shift();
      scene.remove(old.points);
      old.points.geometry.dispose();
      old.points.material.dispose();
    }

    var n = o.count;
    var geo = new THREE.BufferGeometry();
    var P = new Float32Array(n * 3);
    var C = new Float32Array(n * 3);
    var vel = new Float32Array(n * 3);
    var life = new Float32Array(n);
    var seed = new Float32Array(n);
    var base = new THREE.Color(o.color);
    var mix = o.mix === undefined ? 0 : o.mix;
    var mixCol = new THREE.Color(o.mixColor === undefined ? COL.ink : o.mixColor);

    for (var i = 0; i < n; i++) {
      // 出生位置：贴着一个锥 / 半球 / 环撒开
      var a, r, h;
      if (o.shape === 'ring') {
        a = Math.random() * Math.PI * 2;
        r = o.radius * (0.9 + Math.random() * 0.35);
        h = 0.03 + Math.random() * 0.10;
      } else if (o.shape === 'arc') {
        a = (yaw || 0) + o.from + (o.to - o.from) * Math.random();
        r = 0.5 + Math.random() * 0.9;
        h = (Math.random() - 0.25) * 0.35;
      } else {
        a = (yaw || 0) + (Math.random() - 0.5) * o.spread;
        r = Math.random() * o.radius;
        h = (Math.random() - 0.5) * o.radius;
      }
      P[i * 3] = pos.x + Math.sin(a) * r;
      P[i * 3 + 1] = pos.y + h;
      P[i * 3 + 2] = pos.z + Math.cos(a) * r;

      var sp = o.speed * (0.55 + Math.random() * 0.9);
      vel[i * 3] = Math.sin(a) * sp;
      vel[i * 3 + 1] = o.up ? o.speed * (0.2 + Math.random() * 0.7) : (Math.random() - 0.2) * sp * 0.6;
      vel[i * 3 + 2] = Math.cos(a) * sp;

      var c = Math.random() < mix ? mixCol : base;
      C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b;

      life[i] = o.life * (0.7 + Math.random() * 0.6);
      seed[i] = Math.random();
    }

    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));

    var mat = new THREE.PointsMaterial({
      size: o.size,
      map: SPRITE,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });

    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.position.set(0, 0, 0);
    scene.add(pts);

    var rec = {
      points: pts, geo: geo, mat: mat, n: n,
      P: P, C: C, vel: vel, life: life, seed: seed, age: 0,
      max: o.life * 1.3,
      base: base, mixCol: mixCol, o: o
    };
    live.push(rec);
    return rec;
  }

  /* ---------- 每帧推进 ---------- */
  function step(dt) {
    for (var k = live.length - 1; k >= 0; k--) {
      var r = live[k];
      r.age += dt;
      var P = r.P, V = r.vel, C = r.C;
      var drag = Math.pow(r.o.drag === undefined ? 0.86 : r.o.drag, dt * 60);
      var grav = r.o.gravity === undefined ? 2.6 : r.o.gravity;

      for (var i = 0; i < r.n; i++) {
        var i3 = i * 3;
        V[i3] *= drag; V[i3 + 2] *= drag;
        V[i3 + 1] = V[i3 + 1] * drag - grav * dt;
        P[i3] += V[i3] * dt;
        P[i3 + 1] += V[i3 + 1] * dt;
        P[i3 + 2] += V[i3 + 2] * dt;
        if (P[i3 + 1] < 0.02) { P[i3 + 1] = 0.02; V[i3 + 1] *= -0.18; V[i3] *= 0.7; V[i3 + 2] *= 0.7; }

        // 寿命衰减：加法混合下，颜色掉到 0 就是消失
        var f = 1 - r.age / (r.life[i]);
        if (f < 0) f = 0;
        var src = (i % 5 === 0) ? r.mixCol : r.base;
        C[i3] = src.r * f; C[i3 + 1] = src.g * f; C[i3 + 2] = src.b * f;
      }
      r.geo.attributes.position.needsUpdate = true;
      r.geo.attributes.color.needsUpdate = true;

      if (r.age >= r.max) {
        scene.remove(r.points);
        r.geo.dispose();
        r.mat.dispose();
        live.splice(k, 1);
      }
    }
  }

  /* ---------- 接到 fx.js 的调用点上 ---------- */
  var FX = window.ArenaFX;
  var orig = {
    init: FX.init, update: FX.update,
    slash: FX.slash, muzzle: FX.muzzle, orbBurst: FX.orbBurst, hit: FX.hit, land: FX.land
  };

  FX.init = function (sc) {
    scene = sc || null;
    if (orig.init) orig.init(sc);
  };

  FX.update = function (dt) {
    if (orig.update) orig.update(dt);
    step(dt || 0.016);
  };

  function at(pos) {
    return pos || new THREE.Vector3();
  }

  FX.slash = function (pos, yaw) {
    if (orig.slash) orig.slash(pos, yaw);
    burst(at(pos), yaw, {
      count: 44, color: COL.cold, mix: 0.22, mixColor: COL.ink,
      shape: 'arc', from: -0.85, to: 0.55, radius: 1.0, speed: 3.4,
      life: 0.46, size: 0.135, gravity: 2.2, drag: 0.88
    });
  };

  FX.muzzle = function (pos, yaw) {
    if (orig.muzzle) orig.muzzle(pos, yaw);
    burst(at(pos), yaw, {
      count: 22, color: COL.cold, mix: 0.35, mixColor: COL.ink,
      shape: 'cone', spread: 0.42, radius: 0.16, speed: 6.8,
      life: 0.30, size: 0.105, gravity: 1.2, drag: 0.80
    });
  };

  FX.orbBurst = function (pos, yaw) {
    if (orig.orbBurst) orig.orbBurst(pos, yaw);
    burst(at(pos), yaw, {
      count: 46, color: COL.violet, mix: 0.25, mixColor: COL.ink,
      shape: 'ball', spread: Math.PI * 2, radius: 0.34, speed: 2.6,
      life: 0.82, size: 0.150, gravity: 1.8, drag: 0.90, up: true
    });
  };

  FX.hit = function (pos, yaw) {
    if (orig.hit) orig.hit(pos, yaw);
    burst(at(pos), yaw, {
      count: 26, color: COL.warm, mix: 0.30, mixColor: COL.ink,
      shape: 'ball', spread: Math.PI * 2, radius: 0.16, speed: 3.6,
      life: 0.46, size: 0.125, gravity: 2.8, drag: 0.86
    });
  };

  FX.land = function (pos) {
    if (orig.land) orig.land(pos);
    burst(at(pos), 0, {
      count: 34, color: COL.ink, mix: 0.35, mixColor: COL.cold,
      shape: 'ring', radius: 0.42, speed: 3.0,
      life: 0.56, size: 0.125, gravity: 1.4, drag: 0.82
    });
  };

  window.ArenaInk = {
    burst: burst,
    stats: function () { return { bursts: live.length, max: MAX_BURSTS }; }
  };
})();
