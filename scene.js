/* 第七竞技场 · 场景模块（scene.js）
   依据「美观设计」会话的五张场景图 + 两张俯视平面：
   竞技场  24m 圆台 / 三圈看台每圈抬 1.2m / 四根 9m 断柱(45°, r10.2) / 六处掩体 / 双层符阵穹顶
   首领厅  Ø30 厅 / Ø6 祭石台(高 1.5) / 五根断柱 / 八处 1.1m 矮掩体 / 兽面浮雕 / 朱红帐幔 / 熔岩缝
   玩法占地仍是 ±22 的方场，所以场景按“圆场 + 外圈看台”放大到能装下刷怪范围。
   所有重复件（柱/护栏/瓦/碑）都按材质合批，整场 drawcall 控制在 30 以内。 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var group = null;
  var kind = null;
  var animated = [];   // 每帧更新的物件（穹顶符阵、熔岩脉动）

  /* ---------- 合批 ---------- */
  var _m4 = new THREE.Matrix4();
  var _q = new THREE.Quaternion();
  var _e = new THREE.Euler();
  var _v = new THREE.Vector3();
  var _s = new THREE.Vector3();

  function merge(list) {
    var P = [], N = [], U = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var src = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      _e.set(p.rot ? p.rot[0] : 0, p.rot ? p.rot[1] : 0, p.rot ? p.rot[2] : 0);
      _q.setFromEuler(_e);
      _v.set(p.pos[0], p.pos[1], p.pos[2]);
      _s.set(p.scale ? p.scale[0] : 1, p.scale ? p.scale[1] : 1, p.scale ? p.scale[2] : 1);
      _m4.compose(_v, _q, _s);
      src.applyMatrix4(_m4);
      var a = src.attributes;
      for (var k = 0; k < a.position.count; k++) {
        P.push(a.position.getX(k), a.position.getY(k), a.position.getZ(k));
        N.push(a.normal.getX(k), a.normal.getY(k), a.normal.getZ(k));
        U.push(a.uv ? a.uv.getX(k) : 0, a.uv ? a.uv.getY(k) : 0);
      }
      src.dispose();
      p.geo.dispose();
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    return out;
  }

  function add(list, mat, tag) {
    if (!list.length) return null;
    var mesh = new THREE.Mesh(merge(list), mat);
    mesh.userData.tag = tag;
    group.add(mesh);
    return mesh;
  }

  function box(list, w, h, d, x, y, z, rx, ry, rz) {
    list.push({ geo: new THREE.BoxGeometry(w, h, d), pos: [x, y, z], rot: [rx || 0, ry || 0, rz || 0] });
  }
  function cyl(list, rt, rb, h, x, y, z, seg, rx, rz) {
    list.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg || 12), pos: [x, y, z], rot: [rx || 0, 0, rz || 0] });
  }

  /* ---------- 程序贴图 ---------- */
  function stoneTex(base, slab, gap, cells, cracks) {
    var c = document.createElement('canvas');
    c.width = c.height = 512;
    var g = c.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 512);
    var step = 512 / cells;
    for (var y = 0; y < cells; y++) {
      for (var x = 0; x < cells; x++) {
        var off = (y % 2) * step * 0.5;
        g.fillStyle = slab;
        g.globalAlpha = 0.10 + Math.random() * 0.16;
        g.fillRect(x * step + off + 2, y * step + 2, step - 4, step - 4);
        g.globalAlpha = 1;
        g.strokeStyle = gap;
        g.lineWidth = 2;
        g.strokeRect(x * step + off + 1, y * step + 1, step - 2, step - 2);
      }
    }
    if (cracks) {
      g.strokeStyle = 'rgba(20,24,26,0.45)';
      for (var i = 0; i < cracks; i++) {
        var sx = Math.random() * 512, sy = Math.random() * 512;
        g.lineWidth = 1 + Math.random() * 1.6;
        g.beginPath();
        g.moveTo(sx, sy);
        var px = sx, py = sy;
        for (var s = 0; s < 5; s++) {
          px += (Math.random() - 0.5) * 70;
          py += (Math.random() - 0.5) * 70;
          g.lineTo(px, py);
        }
        g.stroke();
      }
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  /* 符纹环：同心圆 + 楔刻 + 符文块，走加法混合当穹顶/地刻用 */
  function runeTex(color, rings) {
    var c = document.createElement('canvas');
    c.width = c.height = 1024;
    var g = c.getContext('2d');
    g.clearRect(0, 0, 1024, 1024);
    var cx = 512, cy = 512;
    g.strokeStyle = color;
    for (var r = 0; r < rings; r++) {
      g.globalAlpha = 0.75 - r * 0.07;
      g.lineWidth = r === 0 ? 7 : 4;
      g.beginPath();
      g.arc(cx, cy, 470 - r * 46, 0, TAU);
      g.stroke();
    }
    // 楔刻
    g.globalAlpha = 0.55;
    g.lineWidth = 3;
    for (var i = 0; i < 48; i++) {
      var a = (i / 48) * TAU;
      var r1 = 300, r2 = 356;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      g.stroke();
    }
    // 符文块
    g.globalAlpha = 0.85;
    for (var j = 0; j < 24; j++) {
      var ang = (j / 24) * TAU + 0.06;
      var rr = 400 + (j % 3) * 16;
      var x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.lineWidth = 4;
      g.beginPath();
      g.rect(-9, -16, 18, 32);
      g.moveTo(-9, -6); g.lineTo(9, -6);
      g.moveTo(-9, 8); g.lineTo(6, 8);
      g.stroke();
      g.restore();
    }
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  /* 兽面浮雕：只做读得出的眼、眉、獠牙，不做细节 */
  function beastTex() {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    var g = c.getContext('2d');
    g.clearRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(190,205,210,0.55)';
    g.fillStyle = 'rgba(150,168,175,0.30)';
    g.lineWidth = 6;
    // 眉
    g.beginPath(); g.moveTo(60, 150); g.quadraticCurveTo(170, 60, 256, 150); g.stroke();
    g.beginPath(); g.moveTo(452, 150); g.quadraticCurveTo(342, 60, 256, 150); g.stroke();
    // 眼
    g.beginPath(); g.ellipse(160, 190, 62, 34, 0.2, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(352, 190, 62, 34, -0.2, 0, TAU); g.fill();
    // 鼻梁与口
    g.beginPath(); g.moveTo(256, 160); g.lineTo(232, 320); g.lineTo(280, 320); g.lineTo(256, 160); g.fill();
    g.beginPath(); g.moveTo(120, 340); g.quadraticCurveTo(256, 430, 392, 340); g.stroke();
    // 獠牙
    g.fillStyle = 'rgba(226,232,236,0.75)';
    g.beginPath(); g.moveTo(150, 350); g.lineTo(176, 430); g.lineTo(196, 350); g.fill();
    g.beginPath(); g.moveTo(362, 350); g.lineTo(336, 430); g.lineTo(316, 350); g.fill();
    // 角
    g.strokeStyle = 'rgba(150,168,175,0.45)';
    g.beginPath(); g.moveTo(90, 110); g.quadraticCurveTo(40, 20, 130, 40); g.stroke();
    g.beginPath(); g.moveTo(422, 110); g.quadraticCurveTo(472, 20, 382, 40); g.stroke();
    var t = new THREE.CanvasTexture(c);
    return t;
  }

  /* ---------- 材质 ---------- */
  var MATS = {};
  function mat(key, make) {
    if (!MATS[key]) MATS[key] = make();
    return MATS[key];
  }

  /* ---------- 竞技场 ---------- */
  function buildArena(scene, obstacles) {
    var R = 22.6;                                   // 台面半径（覆盖 ±22 的玩法占地）
    var stoneTexA = stoneTex('#6d7378', '#c9cfd2', 'rgba(40,46,50,0.55)', 6, 26);
    stoneTexA.repeat.set(7, 7);

    var floorMat = mat('aFloor', function () {
      return new THREE.MeshStandardMaterial({ map: stoneTexA, color: 0x7b858a, roughness: 0.92, metalness: 0.06 });
    });
    var floor = new THREE.Mesh(new THREE.CircleGeometry(R, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    /* 中央地刻：内圈暗盘 + 环符 */
    var rune = runeTex('rgba(150,235,255,0.95)', 3);
    var disc = new THREE.Mesh(new THREE.CircleGeometry(9.2, 48), mat('aDisc', function () {
      return new THREE.MeshStandardMaterial({ color: 0x4d5459, roughness: 0.9, metalness: 0.08 });
    }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.012;
    group.add(disc);

    var runeRing = new THREE.Mesh(new THREE.RingGeometry(5.6, 9.0, 64),
      mat('aRune', function () {
        return new THREE.MeshBasicMaterial({
          map: rune, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide
        });
      }));
    runeRing.rotation.x = -Math.PI / 2;
    runeRing.position.y = 0.03;
    group.add(runeRing);

    /* 台沿两级台阶 */
    var edgeMat = mat('aEdge', function () {
      return new THREE.MeshStandardMaterial({ color: 0x687077, roughness: 0.9, metalness: 0.08 });
    });
    [0, 1].forEach(function (i) {
      var step = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.5 + i * 1.1, R + 0.9 + i * 1.1, 0.55, 64, 1, true), edgeMat);
      step.position.y = -0.28 - i * 0.55;
      group.add(step);
    });

    /* 三圈看台：座面 + 立面 + 朱红柱列 + 青灰瓦 */
    var seatMat = mat('aSeat', function () {
      return new THREE.MeshStandardMaterial({ color: 0x5a6368, roughness: 0.95, metalness: 0.05, side: THREE.DoubleSide });
    });
    var colMat = mat('aCol', function () {
      return new THREE.MeshStandardMaterial({ color: 0x8a4038, roughness: 0.66, metalness: 0.14, emissive: 0x1a0705 });
    });
    var roofMat = mat('aRoof', function () {
      return new THREE.MeshStandardMaterial({
        color: 0x556a6d, roughness: 0.8, metalness: 0.12,
        emissive: 0x18211f, side: THREE.DoubleSide
      });
    });

    var cols = [];
    var roofs = [];
    for (var t = 0; t < 3; t++) {
      var r0 = R + 1.6 + t * 3.4;
      var y = 1.2 * (t + 1);
      // 立面
      var face = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, 1.2, 64, 1, true), seatMat);
      face.position.y = y - 0.6;
      group.add(face);
      // 座面
      var seat = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 3.4, 64), seatMat);
      seat.rotation.x = -Math.PI / 2;
      seat.position.y = y + 0.001;
      group.add(seat);
      // 柱列（合批）
      var n = 28;
      for (var i = 0; i < n; i++) {
        var a = (i / n) * TAU + t * 0.11;
        var x = Math.cos(a) * (r0 + 2.0);
        var z = Math.sin(a) * (r0 + 2.0);
        cyl(cols, 0.24, 0.30, 5.0, x, y + 2.5, z, 8);
        box(cols, 0.62, 0.22, 0.62, x, y + 5.12, z);
      }
      // 瓦顶：斜面壳体，从场内看是一条压檐，不是一根线
      roofs.push({ geo: new THREE.CylinderGeometry(r0 + 0.5, r0 + 3.8, 1.7, 64, 1, true), pos: [0, y + 4.75, 0] });
      // 檐口压条
      roofs.push({ geo: new THREE.CylinderGeometry(r0 - 0.15, r0 - 0.15, 0.34, 64, 1, true), pos: [0, y + 3.86, 0] });
    }
    add(cols, colMat, 'colonnade');
    add(roofs, roofMat, 'eaves');

    /* 看台外圈：一圈高墙 + 顶檐，把地平线封住 */
    var outerR = R + 1.6 + 2 * 3.4 + 4.6;
    var outerMat = mat('aOuter', function () {
      return new THREE.MeshStandardMaterial({ color: 0x767f85, roughness: 0.95, metalness: 0.05, side: THREE.BackSide });
    });
    var outerWall = new THREE.Mesh(new THREE.CylinderGeometry(outerR, outerR, 14.4, 64, 1, true), outerMat);
    outerWall.position.y = 7.2;
    group.add(outerWall);

    var outerEave = new THREE.Mesh(new THREE.CylinderGeometry(outerR - 2.0, outerR + 0.6, 2.2, 64, 1, true), roofMat);
    outerEave.position.y = 15.2;
    group.add(outerEave);

    var wallBand = new THREE.Mesh(new THREE.CylinderGeometry(outerR - 0.05, outerR - 0.05, 0.5, 64, 1, true), colMat);
    wallBand.position.y = 13.6;
    group.add(wallBand);

    /* 四根断柱：45° 方向、半径 10.2、总高 ≈9m，顶上断口 */
    var pillarMat = mat('aPillar', function () {
      return new THREE.MeshStandardMaterial({ color: 0x77808a, roughness: 0.88, metalness: 0.1 });
    });
    var pilList = [];
    var flagCloth = [];
    var flagMat = mat('aFlag', function () {
      return new THREE.MeshStandardMaterial({ color: 0x7fb6c8, roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide, emissive: 0x183038 });
    });
    [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(function (s, idx) {
      var x = s[0] * 7.21, z = s[1] * 7.21;         // 45°: 10.2/√2
      cyl(pilList, 0.52, 0.66, 8.4, x, 4.2, z, 10);
      box(pilList, 1.5, 0.34, 1.5, x, 0.17, z);
      box(pilList, 1.1, 0.24, 1.1, x, 8.5, z);
      // 断口：三块倾斜碎石
      box(pilList, 0.72, 0.42, 0.60, x + 0.12, 9.0, z, 0.22, 0.3, 0.16);
      box(pilList, 0.44, 0.30, 0.40, x - 0.26, 9.2, z + 0.10, -0.3, 0.5, 0.1);
      box(pilList, 0.30, 0.46, 0.26, x + 0.30, 9.34, z - 0.16, 0.4, -0.2, 0.3);
      obstacles.push({ x: x, z: z, r: 0.86 });
      // 挂旗
      var ang = Math.atan2(z, x);
      box(flagCloth, 0.44, 1.90, 0.03, x + Math.cos(ang) * 0.56, 6.55, z + Math.sin(ang) * 0.56, 0, -ang, 0.06);
    });
    add(pilList, pillarMat, 'brokenPillar');
    add(flagCloth, flagMat, 'banner');

    /* 六处掩体：石墩 + 碎块，1.1m 高 */
    var coverMat = mat('aCover', function () {
      return new THREE.MeshStandardMaterial({ color: 0x6b747a, roughness: 0.94, metalness: 0.06 });
    });
    var covList = [];
    for (var c = 0; c < 6; c++) {
      var ca = (c / 6) * TAU + 0.32;
      var cx = Math.cos(ca) * 14.2, cz = Math.sin(ca) * 14.2;
      box(covList, 2.4, 1.1, 1.1, cx, 0.55, cz, 0, -ca, 0);
      box(covList, 0.9, 0.5, 0.7, cx + Math.cos(ca + 1.2) * 1.5, 0.25, cz + Math.sin(ca + 1.2) * 1.5, 0.2, -ca, 0.3);
      obstacles.push({ x: cx, z: cz, r: 1.35 });
    }
    add(covList, coverMat, 'covers');

    /* 穹顶符阵：不建模，走两张加法面片 */
    var domeTex = runeTex('rgba(120,215,255,0.9)', 4);
    var domeA = new THREE.Mesh(new THREE.RingGeometry(9, 20, 64), mat('aDome', function () {
      return new THREE.MeshBasicMaterial({
        map: domeTex, transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide
      });
    }));
    domeA.rotation.x = -Math.PI / 2;
    domeA.position.y = 13.6;
    group.add(domeA);
    animated.push(function (t) { domeA.rotation.z = t * 0.05; });

    var domeB = new THREE.Mesh(new THREE.RingGeometry(15, 30, 64), mat('aDome2', function () {
      return new THREE.MeshBasicMaterial({
        map: domeTex, transparent: true, opacity: 0.20, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide
      });
    }));
    domeB.rotation.x = -Math.PI / 2;
    domeB.position.y = 16.8;
    group.add(domeB);
    animated.push(function (t) { domeB.rotation.z = -t * 0.032; });

    /* 远山：只做剪影，颜色贴近雾色，靠雾吃掉边界 */
    var hillMat = mat('aHill', function () {
      return new THREE.MeshStandardMaterial({ color: 0x7d8f9c, roughness: 1.0, metalness: 0.0 });
    });
    var hills = [];
    for (var hh = 0; hh < 14; hh++) {
      var ha = (hh / 14) * TAU + 0.2;
      var hr = 58 + (hh % 3) * 10;
      cyl(hills, 2.2, 10 + (hh % 4) * 3.0, 10 + (hh % 5) * 3.4, Math.cos(ha) * hr, 2, Math.sin(ha) * hr, 6);
    }
    add(hills, hillMat, 'hills');
  }

  /* ---------- 首领厅 ---------- */
  function buildDungeon(scene, obstacles) {
    var R = 22.6;
    var dTex = stoneTex('#3a4249', '#8e989e', 'rgba(12,16,18,0.7)', 5, 34);
    dTex.repeat.set(8, 8);

    var floorMat = mat('dFloor', function () {
      return new THREE.MeshStandardMaterial({ map: dTex, color: 0x606a71, roughness: 0.95, metalness: 0.05 });
    });
    var floor = new THREE.Mesh(new THREE.CircleGeometry(R, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    /* 厅壁：内壁朝里 */
    var wallMat = mat('dWall', function () {
      return new THREE.MeshStandardMaterial({ color: 0x333d45, roughness: 0.95, metalness: 0.05, side: THREE.BackSide });
    });
    var wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 9.2, 64, 1, true), wallMat);
    wall.position.y = 4.6;
    group.add(wall);

    /* 天花：一圈暗环 + 中心暗盘 */
    var ceil = new THREE.Mesh(new THREE.CircleGeometry(R, 64), mat('dCeil', function () {
      return new THREE.MeshStandardMaterial({ color: 0x1c2429, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide });
    }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 9.2;
    group.add(ceil);

    /* 地面环刻 */
    var dRune = runeTex('rgba(120,240,235,0.9)', 3);
    var ring = new THREE.Mesh(new THREE.RingGeometry(10.4, 15.2, 64), mat('dRune', function () {
      return new THREE.MeshBasicMaterial({
        map: dRune, transparent: true, opacity: 0.30, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide
      });
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    /* 祭石台：Ø6（半径 3），台高 1.5，断成四块，缝隙出青蓝光 */
    var altarMat = mat('dAltar', function () {
      return new THREE.MeshStandardMaterial({ color: 0x4a545c, roughness: 0.9, metalness: 0.1 });
    });
    var altar = [];
    cyl(altar, 2.9, 3.4, 1.5, 0, 0.65, 0, 32);
    // 台面四块断板，中间留缝，微微错位才像“裂开的”
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (p) {
      var ox = (p[0] ? 0.70 : -0.70), oz = (p[1] ? 0.70 : -0.70);
      box(altar, 1.30, 0.26, 1.30, ox, 1.48, oz, 0, 0, p[0] !== p[1] ? 0.035 : -0.035);
    });    // 台脚碎石
    for (var r0 = 0; r0 < 8; r0++) {
      var ra = (r0 / 8) * TAU + 0.3;
      box(altar, 0.42, 0.30, 0.36, Math.cos(ra) * 3.9, 0.15, Math.sin(ra) * 3.9, 0.2, -ra, 0.2);
    }
    add(altar, altarMat, 'altar');

    var seamMat = mat('dSeam', function () {
      return new THREE.MeshBasicMaterial({ color: 0x63e8f0 });
    });
    var seams = [];
    box(seams, 0.10, 1.40, 3.4, 0, 0.72, 0);
    box(seams, 3.4, 1.40, 0.10, 0, 0.72, 0);
    add(seams, seamMat, 'altarSeam');

    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.75, 6.4, 24, 1, true), mat('dShaft', function () {
      return new THREE.MeshBasicMaterial({
        color: 0x7fe6f2, transparent: true, opacity: 0.035, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide
      });
    }));
    shaft.position.y = 3.7;
    group.add(shaft);
    animated.push(function (t) { shaft.material.opacity = 0.032 + Math.sin(t * 1.6) * 0.012; });

    /* 台面符环：祭石上的一圈发光纹，只看亮度不看细节 */
    var altarRune = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.85, 40), mat('dAltarRune', function () {
      return new THREE.MeshBasicMaterial({
        map: runeTex('rgba(150,245,255,0.9)', 2), transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      });
    }));
    altarRune.rotation.x = -Math.PI / 2;
    altarRune.position.y = 1.63;
    group.add(altarRune);

    /* 五根断柱：半径 12，高 7m */
    var pilMat = mat('dPillar', function () {
      return new THREE.MeshStandardMaterial({ color: 0x5b656c, roughness: 0.93, metalness: 0.08 });
    });
    var pils = [];
    for (var i = 0; i < 5; i++) {
      var a = (i / 5) * TAU + 0.9;        // 偏 51.6°，避开出生点 (0,14) 的正面视线
      var x = Math.cos(a) * 12.6, z = Math.sin(a) * 12.6;
      cyl(pils, 0.50, 0.62, 6.6, x, 3.3, z, 10);
      box(pils, 1.3, 0.3, 1.3, x, 0.15, z);
      box(pils, 0.62, 0.44, 0.56, x + 0.10, 7.0, z, 0.2, 0.3, 0.14);
      box(pils, 0.36, 0.30, 0.34, x - 0.24, 7.2, z + 0.12, -0.28, 0.4, 0.2);
      obstacles.push({ x: x, z: z, r: 0.8 });
    }
    add(pils, pilMat, 'dPillars');

    /* 八处矮掩体：1.1m，分布在 r≈15.6 */
    var covMat = mat('dCover', function () {
      return new THREE.MeshStandardMaterial({ color: 0x596269, roughness: 0.96, metalness: 0.06 });
    });
    var covs = [];
    for (var c = 0; c < 8; c++) {
      var ca = (c / 8) * TAU + 0.18;
      var cx = Math.cos(ca) * 15.6, cz = Math.sin(ca) * 15.6;
      box(covs, 2.6, 1.1, 0.9, cx, 0.55, cz, 0, -ca, 0);
      box(covs, 1.1, 1.1, 0.9, cx + Math.cos(ca + 0.5) * 1.9, 0.55, cz + Math.sin(ca + 0.5) * 1.9, 0, -ca + 0.3, 0);
      obstacles.push({ x: cx, z: cz, r: 1.4 });
    }
    add(covs, covMat, 'dCovers');

    /* 兽面浮雕：四向，贴在壁上 */
    var beast = beastTex();
    var beastMat = mat('dBeast', function () {
      return new THREE.MeshStandardMaterial({
        map: beast, color: 0xa8b6bd, roughness: 0.95, metalness: 0.05,
        transparent: true, side: THREE.DoubleSide
      });
    });
    for (var b = 0; b < 4; b++) {
      var ba = (b / 4) * TAU + Math.PI / 4;
      var bm = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 7.4), beastMat);
      bm.position.set(Math.cos(ba) * 21.7, 5.4, Math.sin(ba) * 21.7);
      bm.lookAt(0, 5.4, 0);
      group.add(bm);
    }

    /* 朱红帐幔：从顶部垂下，只留敌方的暗红 */
    var drapeMat = mat('dDrape', function () {
      return new THREE.MeshStandardMaterial({ color: 0x6d2a28, roughness: 0.96, metalness: 0.0, side: THREE.DoubleSide });
    });
    var drapes = [];
    for (var d = 0; d < 6; d++) {
      var da = (d / 6) * TAU + 0.4;
      var dx = Math.cos(da) * 20.4, dz = Math.sin(da) * 20.4;
      box(drapes, 2.2, 5.2, 0.05, dx, 6.4, dz, 0.02, -da, 0.05);
    }
    add(drapes, drapeMat, 'drapes');

    /* 熔岩缝：只铺在台外，暖色只做点缀 */
    var lavaMat = mat('dLava', function () {
      return new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.9 });
    });
    var lavas = [];
    for (var l = 0; l < 10; l++) {
      var la = (l / 10) * TAU + 0.1;
      var lx = Math.cos(la) * 18.6, lz = Math.sin(la) * 18.6;
      box(lavas, 3.4, 0.05, 0.30, lx, 0.03, lz, 0, -la, 0);
    }
    var lavaMesh = add(lavas, lavaMat, 'lava');
    animated.push(function (t) { if (lavaMesh) lavaMesh.material.opacity = 0.72 + Math.sin(t * 2.1) * 0.16; });

    /* 四座火盆（带灯） */
    var bowlMat = mat('dBowl', function () {
      return new THREE.MeshStandardMaterial({ color: 0x4b4136, roughness: 0.8, metalness: 0.4 });
    });
    var bowls = [];
    for (var f = 0; f < 4; f++) {
      var fa = (f / 4) * TAU + 0.6;
      var fx = Math.cos(fa) * 17.4, fz = Math.sin(fa) * 17.4;
      cyl(bowls, 0.62, 0.34, 0.9, fx, 0.45, fz, 10);
      cyl(bowls, 0.24, 0.30, 1.1, fx, -0.1, fz, 8);
      obstacles.push({ x: fx, z: fz, r: 0.7 });
    }
    add(bowls, bowlMat, 'bowls');

    var fireMat = mat('dFire', function () {
      return new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    });
    var fires = [];
    for (var f2 = 0; f2 < 4; f2++) {
      var fa2 = (f2 / 4) * TAU + 0.6;
      var gx = Math.cos(fa2) * 17.4, gz = Math.sin(fa2) * 17.4;
      box(fires, 0.44, 0.42, 0.44, gx, 1.04, gz);
    }
    add(fires, fireMat, 'fires');

    /* 厅壁立柱：8 根通高暗柱，把圆厅撑起来 */
    var wallCol = mat('dWallCol', function () {
      return new THREE.MeshStandardMaterial({ color: 0x404a51, roughness: 0.9, metalness: 0.12 });
    });
    var wc = [];
    for (var w = 0; w < 8; w++) {
      var wa = (w / 8) * TAU + 0.39;
      var wx = Math.cos(wa) * 21.2, wz = Math.sin(wa) * 21.2;
      cyl(wc, 0.42, 0.52, 8.8, wx, 4.4, wz, 8);
      box(wc, 1.1, 0.36, 1.1, wx, 0.18, wz);
      box(wc, 1.0, 0.30, 1.0, wx, 8.65, wz);
    }
    add(wc, wallCol, 'wallCols');

    /* 藻井：天花三圈暗环 */
    var coffer = mat('dCoffer', function () {
      return new THREE.MeshStandardMaterial({ color: 0x232b31, roughness: 0.95, metalness: 0.1, side: THREE.DoubleSide });
    });
    var cf = [];
    [9.4, 15.2, 19.8].forEach(function (cr) {
      cf.push({ geo: new THREE.TorusGeometry(cr, 0.22, 6, 48), pos: [0, 9.0, 0], rot: [Math.PI / 2, 0, 0] });
    });
    add(cf, coffer, 'coffer');

    /* 石闸门：下沿 1.9m，半降，正对厅口 */
    var gateMat = mat('dGate', function () {
      return new THREE.MeshStandardMaterial({ color: 0x4e575e, roughness: 0.92, metalness: 0.08 });
    });
    var gates = [];
    box(gates, 1.1, 9.0, 1.1, -3.0, 4.5, -21.4);
    box(gates, 1.1, 9.0, 1.1, 3.0, 4.5, -21.4);
    box(gates, 7.2, 1.0, 1.2, 0, 8.4, -21.4);
    box(gates, 4.8, 4.2, 0.5, 0, 6.0, -21.4);      // 半降闸板，下沿 ≈1.9m
    add(gates, gateMat, 'gate');
  }

  /* ---------- 对外 ---------- */
  function clear() {
    if (!group) return;
    group.traverse(function (o) {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose();
      }
    });
    if (group.parent) group.parent.remove(group);
    group = null;
    animated.length = 0;
  }

  function build(k, scene, obstacles) {
    clear();
    kind = k;
    group = new THREE.Group();
    group.name = 'scene_' + k;
    scene.add(group);
    animated.length = 0;
    if (k === 'dungeon') buildDungeon(scene, obstacles || []);
    else buildArena(scene, obstacles || []);

    // 天光与雾按场景分开：竞技场是白日扬尘，首领厅是暗青地宫
    if (k === 'dungeon') {
      scene.fog = new THREE.Fog(0x0a1418, 26, 74);
      scene.background = new THREE.Color(0x081014);
    } else {
      scene.fog = new THREE.Fog(0x8ea3b4, 40, 120);
      scene.background = new THREE.Color(0x93a9ba);
    }

    var tris = 0, meshes = 0;
    group.traverse(function (o) {
      if (!o.isMesh) return;
      meshes++;
      tris += o.geometry.attributes.position.count / 3;
    });
    tuneLights(scene);
    return { kind: k, meshes: meshes, tris: Math.round(tris) };
  }

  var acc = 0;
  function update(dt) {
    acc += dt || 0;
    for (var i = 0; i < animated.length; i++) animated[i](acc);
  }

  /* 灯光按场景分气质：竞技场是暖白日场，首领厅是冷青地宫 */
  function tuneLights(scene) {
    var isD = kind === 'dungeon';
    var dirs = 0;
    scene.traverse(function (o) {
      if (o.isHemisphereLight) {
        o.color.setHex(isD ? 0x5b8aa6 : 0xd8e8f6);
        o.groundColor.setHex(isD ? 0x0c1418 : 0x6b6153);
        o.intensity = isD ? 0.66 : 0.85;
      }
      if (o.isDirectionalLight) {
        if (dirs === 0) {
          o.color.setHex(isD ? 0xa9cede : 0xfff2dc);
          o.intensity = isD ? 0.78 : 1.0;
        } else {
          o.color.setHex(isD ? 0x2a6cff : 0xcfd9e0);
          o.intensity = isD ? 0.35 : 0.45;
        }
        dirs++;
      }
    });
  }

  window.ArenaScene = {
    build: build,
    update: update,
    tuneLights: tuneLights,
    clear: clear,
    get kind() { return kind; },
    stats: function () {
      var tris = 0, meshes = 0;
      if (group) group.traverse(function (o) {
        if (!o.isMesh) return;
        meshes++;
        tris += o.geometry.attributes.position.count / 3;
      });
      return { kind: kind, meshes: meshes, tris: Math.round(tris) };
    }
  };
})();
