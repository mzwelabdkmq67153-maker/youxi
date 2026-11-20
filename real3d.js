/* ============================================================
   real3d.js — 写实档人形（许澄定型稿 v2）
   ------------------------------------------------------------
   与 hero3d.js 的区别，只讲三件：
   1) 比例走写实档：身高 1.79m、头高 0.243m、7.35 头身
      头宽 0.155m、头深 0.20m —— 按真人头骨尺寸，不是等比缩球
   2) 结构实做：躯干连续放样，肩峰/锁骨/髂前上棘有截面撑出；
      面部眼窝、眉弓、鼻梁、唇、下颌由顶点位移做出实体转折
   3) 接口不动：build / update / swing / cast 与 Hero3D 同签名
   面数：整角色三角面约 3.0–4.2 万；材质槽 6（主材质 3：布/皮/肤）
   ============================================================ */
(function () {
  if (!window.THREE) return;

  var T = THREE;
  var PI = Math.PI;

  /* ============================================================
     一、程序化贴图（写实向：低频走色差，高频只做凹凸）
     ============================================================ */
  function cv(n) {
    var c = document.createElement('canvas');
    c.width = c.height = n || 512;
    return c;
  }
  function rnd(i) {
    var x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }
  function mkTex(canvas, srgb, rep) {
    var t = new T.CanvasTexture(canvas);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    if (rep) t.repeat.set(rep[0], rep[1]);
    if (srgb && T.sRGBEncoding !== undefined) t.encoding = T.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  function hex(c) { return '#' + ('000000' + c.toString(16)).slice(-6); }

  function skinTex(base) {
    var N = 512, c = cv(N), g = c.getContext('2d');
    g.fillStyle = hex(base); g.fillRect(0, 0, N, N);
    var grd = g.createRadialGradient(N * 0.5, N * 0.60, N * 0.06, N * 0.5, N * 0.5, N * 0.72);
    grd.addColorStop(0, 'rgba(186,86,72,0.10)');
    grd.addColorStop(0.55, 'rgba(150,84,66,0.04)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, N, N);
    for (var i = 0; i < 4200; i++) {
      var x = rnd(i) * N, y = rnd(i + 991) * N, r = 0.5 + rnd(i + 17) * 1.2;
      g.fillStyle = rnd(i + 71) > 0.6 ? 'rgba(84,50,38,0.055)' : 'rgba(255,228,210,0.055)';
      g.beginPath(); g.arc(x, y, r, 0, PI * 2); g.fill();
    }
    return c;
  }
  function clothTex(base) {
    var N = 512, c = cv(N), g = c.getContext('2d');
    g.fillStyle = hex(base); g.fillRect(0, 0, N, N);
    g.save(); g.translate(N / 2, N / 2); g.rotate(0.36); g.translate(-N / 2, -N / 2);
    for (var y = 0; y < N * 1.4; y += 5) {
      g.fillStyle = 'rgba(255,255,255,' + (0.025 + rnd(y) * 0.03) + ')';
      g.fillRect(0, y, N, 2);
      g.fillStyle = 'rgba(0,0,0,' + (0.03 + rnd(y + 5) * 0.04) + ')';
      g.fillRect(0, y + 2.5, N, 1.5);
    }
    g.restore();
    return c;
  }
  function leatherTex(base) {
    var N = 512, c = cv(N), g = c.getContext('2d');
    g.fillStyle = hex(base); g.fillRect(0, 0, N, N);
    for (var i = 0; i < 2600; i++) {
      var x = rnd(i) * N, y = rnd(i + 123) * N, r = 2 + rnd(i + 21) * 4.5;
      g.fillStyle = rnd(i + 9) > 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,240,220,0.05)';
      g.beginPath(); g.arc(x, y, r, 0, PI * 2); g.fill();
    }
    return c;
  }
  function metalTex(base) {
    var N = 512, c = cv(N), g = c.getContext('2d');
    g.fillStyle = hex(base); g.fillRect(0, 0, N, N);
    for (var y = 0; y < N; y += 2) {
      g.fillStyle = 'rgba(255,255,255,' + (0.015 + rnd(y) * 0.04) + ')';
      g.fillRect(0, y, N, 1);
    }
    return c;
  }
  function hairTex(base) {
    var N = 512, c = cv(N), g = c.getContext('2d');
    g.fillStyle = hex(base); g.fillRect(0, 0, N, N);
    for (var i = 0; i < 440; i++) {
      var x = rnd(i) * N;
      g.strokeStyle = rnd(i + 7) > 0.62 ? 'rgba(230,225,220,0.055)' : 'rgba(0,0,0,0.20)';
      g.lineWidth = 0.7 + rnd(i + 3) * 1.3;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + rnd(i + 1) * 10 - 5, N * 0.35, x + rnd(i + 2) * 14 - 7, N * 0.7, x + rnd(i + 4) * 9 - 4, N);
      g.stroke();
    }
    return c;
  }
  /* ------------------------------------------------------------
     脸：球面 UV 上的一块贴图。
     眼窝、鼻梁、下颌由几何做；眼、眉、唇、鼻孔的形与色由这张图画 ——
     这是这个面数级别最稳的分工，也是手游写实的通行做法。
     ------------------------------------------------------------ */
  var FACE_N = 2048;
  function faceUV(x, y) {
    // 头局部坐标（米，x 左右、y 相对头心）→ 球面 UV → 画布像素
    var R = HEAD.R, sxx = HEAD.sx, syy = HEAD.sy, szz = HEAD.sz;
    var nx = x / (R * sxx), ny = y / (R * syy);
    var nz = Math.sqrt(Math.max(0.0001, 1 - nx * nx - ny * ny));
    var phi = Math.atan2(R * szz * nz, -x);
    if (phi < 0) phi += Math.PI * 2;
    var u = phi / (Math.PI * 2);
    var theta = Math.acos(Math.max(-1, Math.min(1, ny)));
    var v = 1 - theta / Math.PI;
    return { x: u * FACE_N, y: (1 - v) * FACE_N };
  }

  function faceTex(base) {
    var c = cv(FACE_N), g = c.getContext('2d');
    var bg = skinTex(base);
    var pat = g.createPattern(bg, 'repeat');
    g.fillStyle = pat; g.fillRect(0, 0, FACE_N, FACE_N);

    function ell(x, y, wM, hM, fill) {
      var a = faceUV(x - wM * 0.5, y), b = faceUV(x + wM * 0.5, y);
      var ctop = faceUV(0, y + hM * 0.5), cbot = faceUV(0, y - hM * 0.5);
      var px = (a.x + b.x) * 0.5, py = (ctop.y + cbot.y) * 0.5;
      var rx = Math.max(1, Math.abs(b.x - a.x) * 0.5), ry = Math.max(1, Math.abs(cbot.y - ctop.y) * 0.5);
      if (fill) {
        g.beginPath(); g.ellipse(px, py, rx, ry, 0, 0, PI * 2);
        g.fillStyle = fill; g.fill();
      }
      return { px: px, py: py, rx: rx, ry: ry };
    }

    // ---- 眼 ----
    [-1, 1].forEach(function (s) {
      var ex = 0.032 * s, ey = 0.014;
      var box = ell(ex, ey, 0.032, 0.0165, null);
      // 眼白：窄杏仁
      g.beginPath();
      g.ellipse(box.px, box.py, box.rx * 1.04, box.ry * 0.66, 0, 0, PI * 2);
      g.fillStyle = '#ded5ca'; g.fill();
      // 虹膜 + 瞳孔 + 高光：虹膜要够大，眼睛才不显空
      var ir = faceUV(ex, ey);
      var irx = Math.max(3, box.ry * 0.82);
      g.beginPath(); g.ellipse(ir.x, ir.y + box.ry * 0.06, irx, irx, 0, 0, PI * 2);
      g.fillStyle = '#46311f'; g.fill();
      g.beginPath(); g.ellipse(ir.x, ir.y + box.ry * 0.06, irx * 0.42, irx * 0.42, 0, 0, PI * 2);
      g.fillStyle = '#0a0705'; g.fill();
      g.beginPath(); g.ellipse(ir.x - irx * 0.30, ir.y - box.ry * 0.10, irx * 0.20, irx * 0.20, 0, 0, PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.52)'; g.fill();
      // 上眼睑线：眼型全靠这一条
      g.beginPath();
      g.ellipse(box.px, box.py, box.rx * 1.04, box.ry * 0.70, 0, PI * 1.03, PI * 1.97);
      g.strokeStyle = 'rgba(34,23,17,0.88)';
      g.lineWidth = Math.max(2, box.ry * 0.34);
      g.stroke();
      // 下眼睑
      g.beginPath();
      g.ellipse(box.px, box.py, box.rx * 0.96, box.ry * 0.60, 0, PI * 0.12, PI * 0.88);
      g.strokeStyle = 'rgba(96,62,48,0.32)';
      g.lineWidth = Math.max(1, box.ry * 0.12);
      g.stroke();
      // 眼窝上半圈阴影：给眉下压一点，避免贴图脸发平
      var sh = g.createLinearGradient(0, box.py - box.ry * 2.4, 0, box.py - box.ry * 0.2);
      sh.addColorStop(0, 'rgba(92,62,48,0.20)');
      sh.addColorStop(1, 'rgba(92,62,48,0)');
      g.beginPath();
      g.ellipse(box.px, box.py - box.ry * 1.0, box.rx * 1.3, box.ry * 1.7, 0, 0, PI * 2);
      g.fillStyle = sh; g.fill();
    });

    // ---- 眉 ----
    [-1, 1].forEach(function (s) {
      var a = faceUV(0.012 * s, 0.040), b = faceUV(0.056 * s, 0.0435);
      g.save();
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(30,22,18,0.84)';
      g.lineWidth = Math.max(3, Math.abs(a.x - b.x) * 0.10);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.quadraticCurveTo((a.x + b.x) * 0.55, Math.min(a.y, b.y) - Math.abs(a.x - b.x) * 0.05, b.x, b.y);
      g.stroke();
      for (var i = 0; i < 8; i++) {
        var t = i / 7;
        var px = a.x + (b.x - a.x) * t;
        var py = a.y + (b.y - a.y) * t;
        g.lineWidth = 1.5;
        g.strokeStyle = 'rgba(30,22,18,' + (0.50 - t * 0.28) + ')';
        g.beginPath();
        g.moveTo(px, py + 2);
        g.lineTo(px + (b.x - a.x) * 0.03, py - 5 - (1 - t) * 2);
        g.stroke();
      }
      g.restore();
    });

    // ---- 鼻 ----
    [-1, 1].forEach(function (s) {
      ell(0.0105 * s, -0.0205, 0.0100, 0.0070, 'rgba(56,32,24,0.52)');
    });
    var noseSh = ell(0, -0.011, 0.028, 0.022, null);
    var nsh = g.createLinearGradient(0, noseSh.py - noseSh.ry, 0, noseSh.py + noseSh.ry);
    nsh.addColorStop(0, 'rgba(120,74,56,0.12)');
    nsh.addColorStop(1, 'rgba(120,74,56,0)');
    g.beginPath(); g.ellipse(noseSh.px, noseSh.py, noseSh.rx, noseSh.ry, 0, 0, PI * 2);
    g.fillStyle = nsh; g.fill();

    // ---- 唇 ----
    var upLip = ell(0, -0.0355, 0.042, 0.0125, null);
    var loLip = ell(0, -0.0485, 0.037, 0.0135, null);
    g.beginPath(); g.ellipse(upLip.px, upLip.py, upLip.rx, upLip.ry, 0, 0, PI * 2);
    g.fillStyle = 'rgba(148,82,70,0.40)'; g.fill();
    g.beginPath(); g.ellipse(loLip.px, loLip.py, loLip.rx, loLip.ry, 0, 0, PI * 2);
    g.fillStyle = 'rgba(158,88,76,0.46)'; g.fill();
    var mid = (upLip.py + loLip.py) * 0.5;
    g.beginPath();
    g.moveTo(upLip.px - upLip.rx * 0.94, mid);
    g.quadraticCurveTo(upLip.px, mid - upLip.ry * 0.40, upLip.px + upLip.rx * 0.94, mid);
    g.strokeStyle = 'rgba(66,36,30,0.60)';
    g.lineWidth = Math.max(3, upLip.ry * 0.32);
    g.stroke();

    // 人中 / 下巴 / 颧部血色
    ell(0, -0.0245, 0.006, 0.010, 'rgba(130,86,66,0.12)');
    ell(0, -0.0620, 0.020, 0.014, 'rgba(120,80,60,0.10)');
    [-1, 1].forEach(function (s) {
      ell(0.050 * s, -0.014, 0.030, 0.026, 'rgba(176,96,78,0.10)');
    });

    return c;
  }

  /* ============================================================
     二、材质槽位
     ============================================================ */
  var PAL = {
    swordsman: { skin: 0xc08f74, hair: 0x18161a, cloth: 0x3a4148, leather: 0x4b3527, metal: 0xa8b0b6, accent: 0x7fbfd0 },
    gunner:    { skin: 0xb4835f, hair: 0x221a16, cloth: 0x333f39, leather: 0x4c3a2a, metal: 0x93999e, accent: 0xd99a4e },
    warlock:   { skin: 0xc9a086, hair: 0x2a2431, cloth: 0x2e2b44, leather: 0x3d3346, metal: 0x9d98ad, accent: 0x9a78e6 },
    grunt:     { skin: 0xa07d64, hair: 0x241a17, cloth: 0x40402f, leather: 0x4a3c2c, metal: 0x8a8f8c, accent: 0x94c56f },
    shooter:   { skin: 0x9d7a62, hair: 0x1d1815, cloth: 0x353a36, leather: 0x453528, metal: 0x8b9095, accent: 0xd0ad55 },
    elite:     { skin: 0x91725b, hair: 0x211a16, cloth: 0x2f333a, leather: 0x3f3226, metal: 0x9ba1a6, accent: 0xcf5a68 },
    boss:      { skin: 0x8a6a56, hair: 0x161314, cloth: 0x24272d, leather: 0x352a22, metal: 0xa8a294, accent: 0xb8453c }
  };

  var _texCache = {};
  function tex(key, maker, srgb, rep) {
    if (!_texCache[key]) _texCache[key] = mkTex(maker(), srgb, rep);
    return _texCache[key];
  }

  function matSet(kind) {
    var p = PAL[kind] || PAL.swordsman;
    var M = {};
    M.skin = new T.MeshStandardMaterial({
      map: tex('skin' + p.skin, function () { return skinTex(p.skin); }, true, [2, 2]),
      bumpMap: tex('skinb' + p.skin, function () { return skinTex(p.skin); }, false, [2, 2]),
      bumpScale: 0.010, roughness: 0.63, metalness: 0.0
    });
    M.hair = new T.MeshStandardMaterial({
      map: tex('hair' + p.hair, function () { return hairTex(p.hair); }, true, [1, 1]),
      roughness: 0.62, metalness: 0.0, side: T.DoubleSide
    });
    M.cloth = new T.MeshStandardMaterial({
      map: tex('cloth' + p.cloth, function () { return clothTex(p.cloth); }, true, [3, 3]),
      bumpMap: tex('clothb' + p.cloth, function () { return clothTex(p.cloth); }, false, [3, 3]),
      bumpScale: 0.015, roughness: 0.90, metalness: 0.0
    });
    M.leather = new T.MeshStandardMaterial({
      map: tex('lea' + p.leather, function () { return leatherTex(p.leather); }, true, [2, 2]),
      bumpMap: tex('leab' + p.leather, function () { return leatherTex(p.leather); }, false, [2, 2]),
      bumpScale: 0.012, roughness: 0.66, metalness: 0.03
    });
    M.metal = new T.MeshStandardMaterial({
      map: tex('met' + p.metal, function () { return metalTex(p.metal); }, true, [1, 1]),
      roughness: 0.30, metalness: 0.85
    });
    M.accent = new T.MeshStandardMaterial({
      color: p.accent, emissive: new T.Color(p.accent), emissiveIntensity: 0.2, roughness: 0.45, metalness: 0.25
    });
    M.face = new T.MeshStandardMaterial({
      map: tex('face' + p.skin, function () { return faceTex(p.skin); }, true, [1, 1]),
      roughness: 0.58, metalness: 0.0
    });
    M.pal = p;
    return M;
  }

  /* ============================================================
     三、几何工具
     ============================================================ */
  function loft(prof, seg, a0, a1) {
    seg = seg || 20;
    var rings = prof.length;
    var start = (a0 === undefined ? 0 : a0);
    var end = (a1 === undefined ? PI * 2 : a1);
    var span = end - start;
    var pos = [], uv = [], idx = [];
    for (var i = 0; i < rings; i++) {
      var r = prof[i];
      for (var s = 0; s <= seg; s++) {
        var a = start + (s / seg) * span;
        pos.push(Math.cos(a) * Math.max(r.rx, 0.0008) + (r.x || 0),
                 r.y,
                 Math.sin(a) * Math.max(r.rz, 0.0008) + (r.z || 0));
        uv.push(s / seg, i / (rings - 1));
      }
    }
    for (var i2 = 0; i2 < rings - 1; i2++) {
      for (var s2 = 0; s2 < seg; s2++) {
        var a1i = i2 * (seg + 1) + s2, b1 = a1i + 1, c1 = a1i + seg + 1, d1 = c1 + 1;
        idx.push(a1i, c1, b1, b1, c1, d1);
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new T.BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function ellipsoid(rx, ry, rz, w, h) {
    var g = new T.SphereGeometry(1, w || 16, h || 12);
    g.scale(rx, ry, rz);
    return g;
  }

  function put(parent, geo, mat, x, y, z, rx, ry, rz) {
    var m = new T.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function bone(parent, name, x, y, z) {
    var g = new T.Group();
    g.name = name;
    g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g);
    return g;
  }

  /* ============================================================
     四、头部
     真头骨：宽 0.155 / 深 0.20 / 高 0.243。先把球压成这个比例，
     再按解剖位置做位移，才立得住五官。
     ============================================================ */
  var HEAD = { R: 0.112, sx: 0.70, sy: 1.10, sz: 0.90, cy: 0.118 };

  function gauss(x, c, s) {
    var t = (x - c) / s;
    return Math.exp(-t * t);
  }

  function headGeo() {
    var g = new T.SphereGeometry(HEAD.R, 64, 48);
    var pa = g.attributes.position;
    var dirs = new Float32Array(pa.count * 3);

    for (var i = 0; i < pa.count; i++) {
      var x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      x *= HEAD.sx; y *= HEAD.sy; z *= HEAD.sz;
      var len = Math.sqrt(x * x + y * y + z * z) || 1;
      dirs[i * 3] = x / len; dirs[i * 3 + 1] = y / len; dirs[i * 3 + 2] = z / len;
    }

    for (var j = 0; j < pa.count; j++) {
      var dx = dirs[j * 3], dy = dirs[j * 3 + 1], dz = dirs[j * 3 + 2];
      var bx = dx * HEAD.R * HEAD.sx, by = dy * HEAD.R * HEAD.sy, bz = dz * HEAD.R * HEAD.sz;

      // 前脸权重：只有朝前的一条带子参与五官塑形
      var fw = gauss(dz, 1, 0.55) + 0.35 * gauss(dz, 0.3, 0.5);
      fw = Math.min(1, fw);

      var d = 0;

      // 眼窝：两个浅碗，深 6mm。眼型由贴图做，几何只负责转折
      d -= 0.0060 * (gauss(dx, 0.34, 0.150) + gauss(dx, -0.34, 0.150)) * gauss(dy, 0.10, 0.110) * fw * fw;
      // 眉弓
      d += 0.0065 * gauss(dy, 0.310, 0.070) * gauss(dx, 0.30, 0.26) * fw;
      // 鼻：鼻根一凹，鼻梁到鼻尖立起来，只在眉下到鼻尖这一段
      var nt = Math.max(0, Math.min(1, (0.10 - dy) / 0.28));
      d -= 0.0030 * gauss(dy, 0.190, 0.045) * gauss(dx, 0, 0.13) * fw;
      d += (0.004 + 0.013 * nt) * gauss(dx, 0, 0.095 + 0.05 * nt) * gauss(dy, -0.02, 0.16) * fw * fw;
      d += 0.0080 * gauss(dy, -0.155, 0.055) * gauss(dx, 0, 0.11) * fw;
      d += 0.0055 * (gauss(dx, 0.105, 0.045) + gauss(dx, -0.105, 0.045)) * gauss(dy, -0.160, 0.045) * fw;
      // 人中
      d -= 0.0022 * gauss(dx, 0, 0.035) * gauss(dy, -0.245, 0.050) * fw;
      // 唇：只做厚度，颜色交给贴图
      d += 0.0035 * gauss(dy, -0.310, 0.045) * gauss(dx, 0, 0.17) * fw;
      d += 0.0040 * gauss(dy, -0.392, 0.050) * gauss(dx, 0, 0.15) * fw;
      // 颧骨 / 太阳穴
      d += 0.0050 * (gauss(dx, 0.50, 0.12) + gauss(dx, -0.50, 0.12)) * gauss(dy, 0.02, 0.13) * (0.35 + 0.65 * Math.abs(dz));
      d -= 0.0035 * (gauss(dx, 0.74, 0.09) + gauss(dx, -0.74, 0.09)) * gauss(dy, 0.28, 0.10);

      // 下颌：下半张脸收窄，下颌角留棱，下巴略前送
      if (dy < -0.26) {
        var t = Math.min(1, (-0.26 - dy) / 0.58);
        bx *= (1 - 0.30 * t);
        bz *= (1 - 0.26 * t);
        // 下颌角：在 dy -0.45 附近给一道硬折，不让脸变圆
        d -= 0.0040 * gauss(dy, -0.44, 0.10) * gauss(Math.abs(dx), 0.55, 0.20) * fw;
      }
      // 下巴略前送，做出下颌前缘
      d += 0.0045 * gauss(dy, -0.62, 0.13) * gauss(dx, 0, 0.22) * fw;

      pa.setXYZ(j, bx + dx * d, by + dy * d, bz + dz * d);
    }
    pa.needsUpdate = true;
    g.computeVertexNormals();

    /* 表情 morph：一笑 / 一怒 / 一痛 */
    function addMorph(fn) {
      var arr = new Float32Array(pa.count * 3);
      for (var i = 0; i < pa.count; i++) {
        var dx = dirs[i * 3], dy = dirs[i * 3 + 1], dz = dirs[i * 3 + 2];
        var fw = Math.min(1, gauss(dz, 1, 0.55) + 0.35 * gauss(dz, 0.3, 0.5));
        var o = [0, 0, 0];
        fn(dx, dy, dz, fw, o);
        arr[i * 3] = o[0]; arr[i * 3 + 1] = o[1]; arr[i * 3 + 2] = o[2];
      }
      return new T.BufferAttribute(arr, 3);
    }
    var smile = addMorph(function (dx, dy, dz, fw, o) {
      o[0] += dx * 0.012 * gauss(dy, -0.34, 0.09) * gauss(Math.abs(dx), 0.30, 0.10);
      o[1] += 0.009 * gauss(dy, -0.32, 0.09) * gauss(dx, 0, 0.4);
      o[2] += 0.004 * fw * gauss(dy, -0.44, 0.10);
    });
    var anger = addMorph(function (dx, dy, dz, fw, o) {
      o[1] -= 0.008 * gauss(dy, 0.30, 0.07) * gauss(dx, 0, 0.35);
      o[0] -= dx * 0.007 * gauss(dy, 0.22, 0.09) * gauss(Math.abs(dx), 0.10, 0.09);
      o[2] += 0.004 * fw * gauss(dy, -0.5, 0.2);
    });
    var pain = addMorph(function (dx, dy, dz, fw, o) {
      o[1] -= 0.007 * gauss(dy, 0.08, 0.11) * gauss(dx, 0, 0.45);
      o[2] -= 0.006 * fw * gauss(dy, -0.34, 0.08);
      o[1] -= 0.004 * gauss(dy, -0.34, 0.06);
    });

    g.morphAttributes.position = [smile, anger, pain];
    g.morphTargetsRelative = true;
    return g;
  }

  function buildHead(J, M) {
    var headG = put(J.head, headGeo(), M.face, 0, HEAD.cy, 0);
    headG.name = 'head_surface';

    // 耳：前移、收窄，靠近下颌角
    [-1, 1].forEach(function (s) {
      var ear = put(J.head, ellipsoid(0.0055, 0.019, 0.0115), M.skin, 0.0755 * s, 0.108, 0.004);
      ear.rotation.z = -0.16 * s;
      ear.rotation.y = 0.34 * s;
    });

    // 发：短发。壳盖头顶到耳中线，后脑再往下压到颈，正面切出发际线
    var crownGeo = new T.SphereGeometry(0.1195, 44, 34, 0, PI * 2, 0, PI * 0.60);
    crownGeo.scale(0.772, 1.072, 0.990);
    var cpa = crownGeo.attributes.position;

    // 发际线：正中略高、两侧下压；后脑（cz 负）保留低边，把露出来的头皮盖住
    for (var ci = 0; ci < cpa.count; ci++) {
      var cx = cpa.getX(ci), cy = cpa.getY(ci), cz = cpa.getZ(ci);
      if (cz < -0.02) continue;
      var w8 = Math.min(1, Math.abs(cx) / 0.062);
      var hl = 0.054 - 0.034 * Math.pow(w8, 1.5) - 0.05 * Math.max(0, -cz) * 0;
      if (cz > 0.004 && cy < hl) {
        cpa.setY(ci, hl);
      }
    }
    cpa.needsUpdate = true;
    crownGeo.computeVertexNormals();
    put(J.head, crownGeo, M.hair, 0, HEAD.cy - 0.002, -0.008);

    var hairG = new T.Group();
    J.head.add(hairG);
    J.hairCards = hairG;
    // 短发不分片：壳体本身带发际线与发束贴图，再叠卡片只会变成贴片
    var cards = [];
    cards.forEach(function (c) {
      var m = put(hairG, hairCard(c.w, c.len, 6), M.hair, c.x, c.y, c.z);
      m.rotation.set(c.rx, c.ry, 0);
      m.castShadow = false;
    });
    return headG;
  }

  function hairCard(w, h, seg) {
    var pos = [], uv = [], idx = [];
    var cols = 4, rows = seg;
    for (var r = 0; r <= rows; r++) {
      var v = r / rows;
      var y = -v * h;
      var wid = w * (1 - 0.30 * v);
      var bulge = Math.sin(v * PI) * 0.012;
      for (var c = 0; c <= cols; c++) {
        var u = c / cols;
        var x = (u - 0.5) * wid;
        pos.push(x, y, bulge + Math.sin(u * PI) * 0.006 * (1 - v));
        uv.push(u, v);
      }
    }
    for (var r2 = 0; r2 < rows; r2++) {
      for (var c2 = 0; c2 < cols; c2++) {
        var a1 = r2 * (cols + 1) + c2, b1 = a1 + 1, c3 = a1 + cols + 1, d1 = c3 + 1;
        idx.push(a1, c3, b1, b1, c3, d1);
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new T.BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ============================================================
     五、手：五指分开，每指 3 节（LOD0 才开）
     ============================================================ */
  function buildHand(wristNode, s, M) {
    var hand = new T.Group();
    wristNode.add(hand);
    put(hand, loft([
      { y: 0.010, rx: 0.033, rz: 0.017 },
      { y: -0.020, rx: 0.038, rz: 0.019 },
      { y: -0.062, rx: 0.040, rz: 0.017 },
      { y: -0.084, rx: 0.036, rz: 0.014 }
    ], 16), M.skin, 0, 0, 0);

    var fingers = [];
    var defs = [
      { x: -0.028, len: [0.032, 0.023, 0.019], r: 0.0076 },
      { x: -0.009, len: [0.036, 0.027, 0.021], r: 0.0082 },
      { x: 0.010, len: [0.038, 0.029, 0.022], r: 0.0086 },
      { x: 0.028, len: [0.034, 0.025, 0.020], r: 0.0080 }
    ];
    defs.forEach(function (f, i) {
      var g1 = bone(hand, 'f' + i + '_0', f.x * s, -0.084, 0);
      put(g1, loft([
        { y: 0.004, rx: f.r, rz: f.r },
        { y: -f.len[0] * 0.5, rx: f.r * 0.95, rz: f.r * 0.95 },
        { y: -f.len[0], rx: f.r * 0.82, rz: f.r * 0.82 }
      ], 10), M.skin, 0, 0, 0);
      var g2 = bone(g1, 'f' + i + '_1', 0, -f.len[0], 0);
      put(g2, loft([
        { y: 0.002, rx: f.r * 0.84, rz: f.r * 0.84 },
        { y: -f.len[1], rx: f.r * 0.72, rz: f.r * 0.72 }
      ], 9), M.skin, 0, 0, 0);
      var g3 = bone(g2, 'f' + i + '_2', 0, -f.len[1], 0);
      put(g3, loft([
        { y: 0.002, rx: f.r * 0.74, rz: f.r * 0.74 },
        { y: -f.len[2] * 0.6, rx: f.r * 0.60, rz: f.r * 0.60 },
        { y: -f.len[2], rx: 0.0015, rz: 0.0015 }
      ], 8), M.skin, 0, 0, 0);
      fingers.push([g1, g2, g3]);
    });

    var thumb = bone(hand, 'thumb_0', -0.034 * s, -0.026, 0.006);
    thumb.rotation.set(0.30, 0, 0.78 * s);
    put(thumb, loft([
      { y: 0.004, rx: 0.0100, rz: 0.0100 },
      { y: -0.030, rx: 0.0090, rz: 0.0090 }
    ], 9), M.skin, 0, 0, 0);
    var t2 = bone(thumb, 'thumb_1', 0, -0.030, 0);
    put(t2, loft([
      { y: 0.002, rx: 0.0086, rz: 0.0086 },
      { y: -0.026, rx: 0.0015, rz: 0.0015 }
    ], 8), M.skin, 0, 0, 0);

    return { group: hand, fingers: fingers, thumb: thumb };
  }

  /* ============================================================
     六、装配
     ============================================================ */
  function build(kind, opts) {
    opts = opts || {};
    var M = opts.mats || matSet(kind);
    var root = new T.Group();
    var J = {};
    var tall = kind === 'boss' ? 1.14 : (kind === 'elite' ? 1.05 : 1);

    J.pelvis = bone(root, 'pelvis', 0, 0.930, 0);
    J.spine = bone(J.pelvis, 'spine', 0, 0.100, 0);
    J.chest = bone(J.spine, 'chest', 0, 0.235, 0);
    J.neck = bone(J.chest, 'neck', 0, 0.185, 0);
    J.head = bone(J.neck, 'head', 0, 0.105, 0);

    /* --- 骨盆：髂前上棘靠这一圈截面撑出来 --- */
    put(J.pelvis, loft([
      { y: 0.070, rx: 0.148, rz: 0.106 },
      { y: 0.030, rx: 0.156, rz: 0.112 },
      { y: -0.020, rx: 0.158, rz: 0.114 },
      { y: -0.080, rx: 0.150, rz: 0.110 },
      { y: -0.140, rx: 0.138, rz: 0.104 },
      { y: -0.200, rx: 0.118, rz: 0.098 }
    ], 22), M.cloth, 0, 0, 0);

    /* --- 腰：最细 0.132，收在肋骨下缘 --- */
    put(J.spine, loft([
      { y: -0.078, rx: 0.150, rz: 0.106 },
      { y: -0.010, rx: 0.136, rz: 0.096 },
      { y: 0.055, rx: 0.129, rz: 0.092 },
      { y: 0.135, rx: 0.140, rz: 0.100 },
      { y: 0.235, rx: 0.152, rz: 0.108 }
    ], 20), M.cloth, 0, 0, 0);

    /* --- 胸廓：锁骨在 +0.150，肩峰在 ±0.186 --- */
    put(J.chest, loft([
      { y: -0.095, rx: 0.150, rz: 0.107 },
      { y: -0.020, rx: 0.160, rz: 0.112 },
      { y: 0.050, rx: 0.172, rz: 0.117 },
      { y: 0.115, rx: 0.175, rz: 0.116 },
      { y: 0.175, rx: 0.156, rz: 0.103 },
      { y: 0.235, rx: 0.108, rz: 0.086 }
    ], 24), M.cloth, 0, 0, 0);

    // 胸大肌与斜方肌压进衣服里，只在轮廓上出一点厚度，不做凸点
    [-1, 1].forEach(function (s) {
      put(J.chest, ellipsoid(0.058, 0.042, 0.024), M.cloth, 0.058 * s, 0.100, 0.078);
      put(J.chest, ellipsoid(0.050, 0.036, 0.034), M.cloth, 0.064 * s, 0.170, -0.012);
    });

    /* --- 颈与头：颈要接进头骨底部，不然头会浮在领口上 --- */
    put(J.neck, loft([
      { y: 0.112, rx: 0.045, rz: 0.043 },
      { y: 0.060, rx: 0.049, rz: 0.046 },
      { y: 0.000, rx: 0.051, rz: 0.048 },
      { y: -0.090, rx: 0.060, rz: 0.056 },
      { y: -0.130, rx: 0.070, rz: 0.064 }
    ], 16), M.skin, 0, 0, 0);
    buildHead(J, M);

    /* --- 手臂：A-pose 建进骨架 --- */
    J.hands = {};
    [-1, 1].forEach(function (s) {
      var side = s < 0 ? 'L' : 'R';
      J['shoulder' + side] = bone(J.chest, 'shoulder' + side, 0.198 * s, 0.150, 0);
      J['shoulder' + side].rotation.z = s * 0.50;
      // 三角肌：肩头那一块，收在衣服里
      put(J['shoulder' + side], ellipsoid(0.056, 0.066, 0.052), M.cloth, 0.004 * s, -0.036, 0);
      // 上臂（衣袖）
      put(J['shoulder' + side], loft([
        { y: 0.014, rx: 0.054, rz: 0.053 },
        { y: -0.070, rx: 0.051, rz: 0.050 },
        { y: -0.170, rx: 0.045, rz: 0.044 },
        { y: -0.300, rx: 0.038, rz: 0.037 }
      ], 16), M.cloth, 0, 0, 0);

      J['elbow' + side] = bone(J['shoulder' + side], 'elbow' + side, 0.012 * s, -0.300, 0);
      J['elbow' + side].rotation.x = -0.05;
      // 前臂：皮肤，袖口到肘
      put(J['elbow' + side], loft([
        { y: 0.022, rx: 0.043, rz: 0.041 },
        { y: -0.065, rx: 0.044, rz: 0.042 },
        { y: -0.165, rx: 0.036, rz: 0.034 },
        { y: -0.275, rx: 0.027, rz: 0.025 }
      ], 16), M.skin, 0, 0, 0);

      J['wrist' + side] = bone(J['elbow' + side], 'wrist' + side, 0, -0.275, 0);
      // 肘口压一道皮护肘，把袖口与皮肤的接缝盖住
      put(J['elbow' + side], loft([
        { y: 0.034, rx: 0.046, rz: 0.044 },
        { y: 0.000, rx: 0.047, rz: 0.045 },
        { y: -0.026, rx: 0.044, rz: 0.042 }
      ], 16), M.leather, 0, 0, 0);
      // 护腕
      put(J['wrist' + side], loft([
        { y: 0.056, rx: 0.029, rz: 0.028 },
        { y: -0.008, rx: 0.031, rz: 0.029 }
      ], 14), M.leather, 0, 0, 0);
      J.hands[side] = buildHand(J['wrist' + side], s, M);
    });

    /* --- 腿：裤 + 靴，膝盖有骨点 --- */
    [-1, 1].forEach(function (s) {
      var side = s < 0 ? 'L' : 'R';
      J['hip' + side] = bone(J.pelvis, 'hip' + side, 0.086 * s, -0.030, 0);
      put(J['hip' + side], loft([
        { y: 0.030, rx: 0.092, rz: 0.088 },
        { y: -0.090, rx: 0.088, rz: 0.086 },
        { y: -0.250, rx: 0.072, rz: 0.072 },
        { y: -0.420, rx: 0.056, rz: 0.057 }
      ], 18), M.cloth, 0, 0, 0);

      J['knee' + side] = bone(J['hip' + side], 'knee' + side, 0, -0.420, 0);
      put(J['knee' + side], loft([
        { y: 0.030, rx: 0.057, rz: 0.058 },
        { y: -0.075, rx: 0.058, rz: 0.060 },
        { y: -0.235, rx: 0.041, rz: 0.041 },
        { y: -0.395, rx: 0.031, rz: 0.032 }
      ], 18), M.cloth, 0, 0, 0);

      J['ankle' + side] = bone(J['knee' + side], 'ankle' + side, 0, -0.395, 0);
      // 靴：靴筒 + 脚掌 + 靴底，三层都要落地
      put(J['ankle' + side], loft([
        { y: 0.105, rx: 0.044, rz: 0.046 },
        { y: 0.020, rx: 0.046, rz: 0.049 },
        { y: -0.040, rx: 0.048, rz: 0.056 }
      ], 16), M.leather, 0, 0, 0);
      put(J['ankle' + side], ellipsoid(0.043, 0.038, 0.104, 18, 12), M.leather, 0, -0.060, 0.046);
      // 靴头压一块硬皮，脚背不至于圆成一团
      put(J['ankle' + side], new T.BoxGeometry(0.080, 0.022, 0.058), M.leather, 0, -0.068, 0.112);
      // 靴底：整块落地，脚才不会像楔子
      put(J['ankle' + side], new T.BoxGeometry(0.086, 0.014, 0.232), M.leather, 0, -0.079, 0.042);
      put(J['ankle' + side], new T.BoxGeometry(0.088, 0.008, 0.236), M.metal, 0, -0.0865, 0.042);
    });

    gear(J, M, kind);
    if (opts.weapon !== false) weapon(J, M, kind);

    var blob = blobShadow(kind === 'boss' ? 0.70 : 0.38);
    root.add(blob);

    root.scale.setScalar(opts.scale || tall);
    root.userData.rig = {
      kind: kind, J: J, M: M, t: 0, phase: 0, run: 0,
      w: { walk: 0, run: 0, attack: 0, cast: 0, hit: 0, dead: 0 },
      attackClip: null, attackT: 0,
      baseAim: kind === 'gunner' || kind === 'shooter' ? 0.35 : 0,
      aim: 0, air: 0
    };
    root.userData.hero3d = true;
    root.userData.real3d = true;
    root.userData.heroKit = kind;
    root.castShadow = true;
    return root;
  }

  /* ============================================================
     七、装束：贴身层 / 中间层 / 活动件
     ============================================================ */
  function gear(J, M, kind) {
    var cloth = M.cloth, lea = M.leather, met = M.metal;

    // 腰带（挂在骨盆上，跑动不跟着腰扭）
    put(J.pelvis, loft([
      { y: 0.052, rx: 0.160, rz: 0.117 },
      { y: 0.014, rx: 0.164, rz: 0.120 },
      { y: -0.018, rx: 0.158, rz: 0.115 }
    ], 22), lea, 0, 0, 0);
    put(J.pelvis, new T.BoxGeometry(0.050, 0.042, 0.014), met, 0, 0.018, 0.118);

    // 下摆：短摆，只到胯下 9cm。长摆蹲不下去，蹲下必穿腿
    put(J.pelvis, loft([
      { y: -0.006, rx: 0.160, rz: 0.118 },
      { y: -0.060, rx: 0.168, rz: 0.124 },
      { y: -0.095, rx: 0.172, rz: 0.127 }
    ], 22, PI * 0.40, PI * 1.60), cloth, 0, 0, 0);

    if (kind === 'swordsman' || kind === 'elite' || kind === 'boss') {
      [-1, 1].forEach(function (s) {
        var side = s < 0 ? 'L' : 'R';
        // 肩甲挂胸廓：举臂时肩甲留在肩上，不跟着上臂飞出去
        var pad = put(J.chest, new T.SphereGeometry(0.070, 24, 16, 0, PI * 2, 0, PI * 0.56), lea, 0.198 * s, 0.086, 0);
        pad.rotation.z = -0.72 * s;
        pad.scale.set(1.0, 1.02, 0.92);
        put(J.chest, new T.BoxGeometry(0.010, 0.026, 0.046), met, 0.240 * s, 0.084, 0.042);
      });
      put(J.chest, loft([
        { y: 0.130, rx: 0.150, rz: 0.106 },
        { y: 0.040, rx: 0.156, rz: 0.110 },
        { y: -0.045, rx: 0.146, rz: 0.102 }
      ], 16, PI * 0.22, PI * 0.78), lea, 0, 0, 0);
      put(J.chest, new T.BoxGeometry(0.028, 0.028, 0.012), met, 0, 0.048, 0.110);
    }

    if (kind === 'gunner' || kind === 'shooter') {
      put(J.chest, loft([
        { y: 0.140, rx: 0.156, rz: 0.110 },
        { y: 0.000, rx: 0.152, rz: 0.108 },
        { y: -0.090, rx: 0.144, rz: 0.102 }
      ], 20), cloth, 0, 0, 0);
      [-1, 1].forEach(function (s) {
        put(J.chest, new T.BoxGeometry(0.040, 0.050, 0.020), lea, 0.070 * s, -0.015, 0.096);
      });
      put(J.chest, new T.BoxGeometry(0.013, 0.140, 0.010), lea, 0, 0.030, 0.114, 0, 0, 0.26);
    }

    if (kind === 'warlock') {
      put(J.spine, loft([
        { y: 0.250, rx: 0.160, rz: 0.116 },
        { y: 0.000, rx: 0.150, rz: 0.108 },
        { y: -0.120, rx: 0.166, rz: 0.120 }
      ], 24), cloth, 0, 0, 0);
      put(J.pelvis, loft([
        { y: -0.010, rx: 0.172, rz: 0.126 },
        { y: -0.180, rx: 0.206, rz: 0.156 },
        { y: -0.360, rx: 0.232, rz: 0.182 },
        { y: -0.500, rx: 0.244, rz: 0.194 }
      ], 26), cloth, 0, 0, 0);
    }

    if (kind === 'grunt' || kind === 'boss') {
      put(J.head, loft([
        { y: 0.255, rx: 0.098, rz: 0.104 },
        { y: 0.160, rx: 0.112, rz: 0.118 },
        { y: 0.050, rx: 0.116, rz: 0.122 },
        { y: -0.060, rx: 0.104, rz: 0.112 }
      ], 20, PI * 0.58, PI * 2.42), cloth, 0, 0, 0);
    }
  }

  function weapon(J, M, kind) {
    var wrist = J.wristR;
    if (!wrist) return;
    var G = new T.Group();
    wrist.add(G);
    G.position.set(0, -0.052, 0.004);
    J.weapon = G;

    if (kind === 'gunner' || kind === 'shooter') {
      G.rotation.set(PI * 0.46, 0, 0.10);
      put(G, loft([
        { y: 0.020, rx: 0.020, rz: 0.020 },
        { y: -0.100, rx: 0.017, rz: 0.016 },
        { y: -0.320, rx: 0.012, rz: 0.011 },
        { y: -0.560, rx: 0.008, rz: 0.008 }
      ], 12), M.metal, 0, 0, 0);
      put(G, new T.BoxGeometry(0.042, 0.120, 0.048), M.leather, 0, -0.130, -0.030);
      put(G, new T.BoxGeometry(0.036, 0.070, 0.036), M.leather, 0, -0.062, 0.028);
      put(G, new T.BoxGeometry(0.010, 0.026, 0.010), M.accent, 0, -0.300, 0.020);
    } else if (kind === 'warlock') {
      G.rotation.set(PI * 0.16, 0, 0.05);
      put(G, loft([
        { y: 0.030, rx: 0.010, rz: 0.010 },
        { y: -0.680, rx: 0.007, rz: 0.007 }
      ], 10), M.leather, 0, 0, 0);
      put(G, ellipsoid(0.030, 0.030, 0.030, 14, 10), M.accent, 0, 0.052, 0);
    } else {
      G.rotation.set(PI * 0.26, 0, 0.06);
      put(G, new T.BoxGeometry(0.028, 0.100, 0.026), M.leather, 0, -0.020, 0);
      put(G, new T.BoxGeometry(0.120, 0.014, 0.026), M.metal, 0, -0.072, 0);
      put(G, loft([
        { y: -0.078, rx: 0.021, rz: 0.005 },
        { y: -0.400, rx: 0.019, rz: 0.0045 },
        { y: -0.660, rx: 0.014, rz: 0.0035 },
        { y: -0.720, rx: 0.002, rz: 0.0012 }
      ], 10), M.metal, 0, 0, 0);
    }
  }

  var _blob = null;
  function blobShadow(r) {
    if (!_blob) {
      var c = cv(128), g = c.getContext('2d');
      var grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
      grad.addColorStop(0, 'rgba(0,0,0,0.55)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      _blob = new T.CanvasTexture(c);
    }
    var mm = new T.Mesh(new T.PlaneGeometry(r * 2, r * 2),
      new T.MeshBasicMaterial({ map: _blob, transparent: true, depthWrite: false, opacity: 0.7 }));
    mm.rotation.x = -PI / 2;
    mm.position.y = 0.004;
    return mm;
  }

  /* ============================================================
     八、姿势 / 动作
     ============================================================ */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t * t * (3 - 2 * t); }

  function pose(mesh, name) {
    var rig = mesh.userData && mesh.userData.rig;
    if (!rig) return;
    var J = rig.J;
    ['L', 'R'].forEach(function (sd) {
      var s = sd === 'L' ? -1 : 1;
      J['shoulder' + sd].rotation.set(0, 0, s * 0.50);
      J['elbow' + sd].rotation.set(-0.05, 0, 0);
      J['hip' + sd].rotation.set(0, 0, 0);
      J['knee' + sd].rotation.set(0, 0, 0);
      J['ankle' + sd].rotation.set(0, 0, 0);
    });
    J.spine.rotation.set(0, 0, 0);
    J.chest.rotation.set(0, 0, 0);
    J.neck.rotation.set(0, 0, 0);
    J.head.rotation.set(0, 0, 0);
    mesh.position.y = 0;

    if (name === 'T') {
      ['L', 'R'].forEach(function (sd) {
        J['shoulder' + sd].rotation.z = (sd === 'L' ? -1 : 1) * 1.52;
      });
    } else if (name === 'armsUp') {
      ['L', 'R'].forEach(function (sd) {
        J['shoulder' + sd].rotation.z = (sd === 'L' ? -1 : 1) * 2.60;
        J['elbow' + sd].rotation.x = -0.30;
      });
    } else if (name === 'squat') {
      ['L', 'R'].forEach(function (sd) {
        J['hip' + sd].rotation.x = -1.20;
        J['knee' + sd].rotation.x = 1.90;
        J['ankle' + sd].rotation.x = -0.70;
      });
      J.spine.rotation.x = 0.28;
      mesh.position.y = -0.40;
    } else if (name === 'lunge') {
      J.hipL.rotation.x = -0.85; J.kneeL.rotation.x = 1.05; J.ankleL.rotation.x = -0.30;
      J.hipR.rotation.x = 0.50; J.kneeR.rotation.x = 0.28; J.ankleR.rotation.x = -0.60;
      J.spine.rotation.x = 0.18;
      mesh.position.y = -0.16;
    } else if (name === 'twist') {
      J.spine.rotation.y = 0.55;
      J.chest.rotation.y = 0.50;
      J.head.rotation.y = -0.55;
      J.shoulderR.rotation.z = 0.95;
      J.elbowR.rotation.x = -1.40;
    }
  }

  function swing(mesh, name, dur) {
    var rig = mesh.userData && mesh.userData.rig;
    if (!rig) return;
    rig.attackClip = { name: name || 'slash', dur: dur || 0.42, t: 0 };
  }
  function cast(mesh, dur) { swing(mesh, 'cast', dur || 0.7); }

  function update(mesh, dt, st) {
    var rig = mesh.userData && mesh.userData.rig;
    if (!rig) return;
    var J = rig.J, w = rig.w;
    st = st || {};
    rig.t += dt;

    var speed = st.speed || 0;
    var moving = speed > 0.25;
    var runT = clamp((speed - 3.0) / 3.4, 0, 1);

    w.walk = lerp(w.walk, moving ? 1 : 0, Math.min(1, dt * 9));
    w.run = lerp(w.run, moving ? runT : 0, Math.min(1, dt * 7));
    rig.phase += dt * (speed > 0.25 ? (2.1 + speed * 1.05) : 0.35);

    var ph = rig.phase;
    var swingA = (0.42 + runT * 0.45) * w.walk;
    var liftA = (0.55 + runT * 0.55) * w.walk;

    ['L', 'R'].forEach(function (sd, i) {
      var s = sd === 'L' ? -1 : 1;
      var p = ph + (i ? PI : 0);
      var sw = Math.sin(p);
      J['hip' + sd].rotation.x = sw * swingA * 0.85;
      var kneeBend = Math.max(0, Math.cos(p)) * liftA;
      J['knee' + sd].rotation.x = 0.08 + kneeBend + Math.max(0, -sw) * 0.10 * w.walk;
      J['ankle' + sd].rotation.x = -0.04 - sw * 0.18 * w.walk + kneeBend * 0.28;
      J['shoulder' + sd].rotation.set(-sw * 0.26 * swingA * 1.2, 0, s * 0.50);
      J['elbow' + sd].rotation.x = -0.05 - Math.abs(sw) * 0.28 * w.walk;
    });

    J.spine.rotation.x = 0.02 + w.run * 0.15 + Math.abs(Math.sin(ph)) * 0.008;
    J.spine.rotation.y = -Math.sin(ph) * 0.09 * w.walk;
    J.chest.rotation.y = Math.sin(ph) * 0.13 * w.walk;
    J.neck.rotation.x = -w.run * 0.10;
    J.head.rotation.y = -Math.sin(ph) * 0.15 * w.walk;
    J.head.rotation.x = -0.02 - w.run * 0.05;

    J.pelvis.position.y = 0.930 + Math.abs(Math.cos(ph)) * 0.011 * w.walk - w.run * 0.018;

    var air = st.onGround === false ? 1 : 0;
    rig.air = lerp(rig.air || 0, air, Math.min(1, dt * 8));
    if (rig.air > 0.01) {
      ['L', 'R'].forEach(function (sd) {
        J['hip' + sd].rotation.x = lerp(J['hip' + sd].rotation.x, -0.55, rig.air);
        J['knee' + sd].rotation.x = lerp(J['knee' + sd].rotation.x, 1.15, rig.air);
        J['shoulder' + sd].rotation.x = lerp(J['shoulder' + sd].rotation.x, -0.55, rig.air);
      });
    }

    rig.aim = lerp(rig.aim, st.aim ? 1 : 0, Math.min(1, dt * 8));
    if (rig.aim > 0.01) {
      J.shoulderR.rotation.x = lerp(J.shoulderR.rotation.x, -1.15, rig.aim);
      J.elbowR.rotation.x = lerp(J.elbowR.rotation.x, -1.30, rig.aim);
      J.shoulderL.rotation.x = lerp(J.shoulderL.rotation.x, -0.95, rig.aim);
      J.elbowL.rotation.x = lerp(J.elbowL.rotation.x, -1.45, rig.aim);
      J.chest.rotation.y = lerp(J.chest.rotation.y, 0.26, rig.aim);
    }

    if (rig.attackClip) {
      var c = rig.attackClip;
      c.t += dt;
      var q = clamp(c.t / c.dur, 0, 1);
      if (c.name === 'slash') {
        var wind = Math.sin(Math.min(1, q * 1.5) * PI * 0.5);
        var strike = q > 0.45 ? Math.sin((q - 0.45) / 0.55 * PI) : 0;
        J.shoulderR.rotation.x = lerp(J.shoulderR.rotation.x, -1.55, wind * 0.8);
        J.shoulderR.rotation.z = 0.58 + q * 0.6;
        J.elbowR.rotation.x = -0.35 - wind * 0.9 + strike * 0.3;
        J.chest.rotation.y = lerp(J.chest.rotation.y, -0.55, wind * 0.7);
        J.chest.rotation.y = lerp(J.chest.rotation.y, 0.62, strike * 0.9);
        J.spine.rotation.x = 0.05 + ease(q) * 0.12;
      } else if (c.name === 'shoot') {
        J.shoulderR.rotation.x = -1.20 + Math.sin(q * PI) * 0.20;
        J.elbowR.rotation.x = -1.35;
        J.shoulderL.rotation.x = -1.00;
        J.elbowL.rotation.x = -1.50;
        J.chest.rotation.y = 0.30 - Math.sin(q * PI) * 0.10;
      } else if (c.name === 'cast') {
        var up = Math.sin(q * PI);
        J.shoulderR.rotation.x = lerp(J.shoulderR.rotation.x, -2.10, up);
        J.elbowR.rotation.x = lerp(J.elbowR.rotation.x, -0.45, up);
        J.shoulderL.rotation.z = -0.50 - up * 0.35;
        J.chest.rotation.x = -up * 0.12;
        J.head.rotation.x = -up * 0.16;
      }
      if (q >= 1) rig.attackClip = null;
    }

    var hit = st.hitT || 0;
    if (hit > 0) {
      J.spine.rotation.x -= 0.18 * hit;
      J.neck.rotation.x -= 0.10 * hit;
      J.head.rotation.x -= 0.12 * hit;
    }
  }

  /* ============================================================
     九、量测
     ============================================================ */
  function stats(mesh) {
    var tris = 0, verts = 0, meshes = 0;
    mesh.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      var g = o.geometry;
      meshes++;
      var c = g.index ? g.index.count : g.attributes.position.count;
      tris += Math.floor(c / 3);
      verts += g.attributes.position.count;
    });
    var box = new T.Box3().setFromObject(mesh);
    var h = box.max.y - box.min.y;
    var sc = mesh.scale.x || 1;
    return {
      tris: tris, verts: verts, meshes: meshes,
      height: +h.toFixed(3),
      heads: +(h / (0.243 * sc)).toFixed(2),
      mats: 6,
      bones: countBones(mesh)
    };
  }
  function countBones(mesh) {
    var n = 0, seen = {};
    mesh.traverse(function (o) {
      if (o.name && !seen[o.uuid] && (o.isBone || o.type === 'Group' || o.type === 'Object3D')) {
        seen[o.uuid] = 1;
        n++;
      }
    });
    return n;
  }

  function setFace(mesh, idx, v) {
    var target = null;
    mesh.traverse(function (o) { if (o.name === 'head_surface') target = o; });
    if (!target || !target.geometry.morphAttributes.position) return;
    if (!target.morphTargetInfluences) target.morphTargetInfluences = [0, 0, 0];
    target.morphTargetInfluences[idx] = v;
  }

  window.Real3D = {
    build: build,
    update: update,
    swing: swing,
    cast: cast,
    pose: pose,
    stats: stats,
    setFace: setFace,
    matSet: matSet,
    PAL: PAL,
    HEAD: HEAD,
    version: 'real-write-v2'
  };
})();
