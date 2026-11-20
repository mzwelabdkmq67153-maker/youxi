/* ============================================================
   hero3d.js — 关节骨架 + 程序化细节纹理的 3D 人物
   ------------------------------------------------------------
   要解决的是"盒子拼出来的像素感"：
   1) 每根骨都是一个 Group，肩/肘/腕/髋/膝/踝都能独立转动，
      关节处用球体封口，转多少度都不露缝；
   2) 甲片、布料、皮肤、头发、脸各自有一张 canvas 生成的
      细节贴图（甲缝与高光、织纹与褶皱、毛孔、发丝、五官），
      配 bumpMap 让侧光下能读出凹凸；
   3) 动作不靠几帧硬切：走路/疾跑按步频算相位、攻击/施法/
      受击/倒地走关键帧曲线，两者按权重叠加，过渡是连续的。
   对外：window.Hero3D.build(kind, opts) / .update(rig, dt, st)
   kind: swordsman | gunner | warlock | grunt | shooter | elite | boss
   ============================================================ */
(function () {
  if (!window.THREE) return;

  var T = THREE;

  /* ============================================================
     一、贴图工厂：所有细节都是 canvas 画出来的，不依赖外部图片
     ============================================================ */
  function canvas(n) {
    var c = document.createElement('canvas');
    c.width = c.height = n;
    return c;
  }
  function hex(c) { return '#' + ('000000' + c.toString(16)).slice(-6); }
  function shade(c, k) {
    var col = new T.Color(c);
    col.multiplyScalar(k);
    return '#' + col.getHexString();
  }
  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* 板甲：横向分片 + 片间暗缝 + 片顶高光 + 划痕 + 金属拉丝 */
  function armorTex(base) {
    var N = 512, c = canvas(N), g = c.getContext('2d');
    var grd = g.createLinearGradient(0, 0, 0, N);
    grd.addColorStop(0, shade(base, 1.22));
    grd.addColorStop(0.45, shade(base, 1.02));
    grd.addColorStop(1, shade(base, 0.72));
    g.fillStyle = grd;
    g.fillRect(0, 0, N, N);

    // 金属拉丝
    for (var i = 0; i < 900; i++) {
      var x = rnd(i) * N, y = rnd(i + 91) * N, w = 8 + rnd(i + 17) * 46;
      g.globalAlpha = 0.05 + rnd(i + 3) * 0.10;
      g.fillStyle = rnd(i + 7) > 0.5 ? shade(base, 1.38) : shade(base, 0.62);
      g.fillRect(x, y, w, 1);
    }
    g.globalAlpha = 1;

    // 甲片：8 排，每排 6 片，错缝排列
    var rows = 8, cols = 6, rh = N / rows, cw = N / cols;
    for (var r = 0; r < rows; r++) {
      var off = (r % 2) * cw * 0.5;
      for (var k = -1; k <= cols; k++) {
        var px = k * cw + off, py = r * rh;
        g.save();
        // 片体：上亮下暗的圆角矩形
        var lg = g.createLinearGradient(px, py, px, py + rh);
        lg.addColorStop(0, shade(base, 1.30));
        lg.addColorStop(0.5, shade(base, 1.04));
        lg.addColorStop(1, shade(base, 0.70));
        g.fillStyle = lg;
        roundRect(g, px + 3, py + 3, cw - 6, rh - 7, 5);
        g.fill();
        // 片间暗缝
        g.strokeStyle = shade(base, 0.34);
        g.lineWidth = 3;
        roundRect(g, px + 3, py + 3, cw - 6, rh - 7, 5);
        g.stroke();
        // 片顶高光
        g.globalAlpha = 0.5;
        g.fillStyle = shade(base, 1.62);
        g.fillRect(px + 7, py + 5, cw - 14, 2.5);
        g.globalAlpha = 1;
        // 随机划痕
        if (rnd(r * 13 + k * 7) > 0.55) {
          g.strokeStyle = 'rgba(255,255,255,0.30)';
          g.lineWidth = 1;
          g.beginPath();
          var sx = px + 10 + rnd(r + k) * (cw - 30), sy = py + 12 + rnd(r + k + 5) * (rh - 20);
          g.moveTo(sx, sy);
          g.lineTo(sx + 14 + rnd(r + k + 2) * 20, sy + 6);
          g.stroke();
        }
        g.restore();
      }
    }
    // 整体压一层竖向暗角，模拟柱面光照
    var vg = g.createLinearGradient(0, 0, N, 0);
    vg.addColorStop(0, 'rgba(0,0,0,0.28)');
    vg.addColorStop(0.35, 'rgba(0,0,0,0)');
    vg.addColorStop(0.72, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.30)');
    g.fillStyle = vg;
    g.fillRect(0, 0, N, N);
    return c;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  /* 织物：斜纹底 + 折痕 + 高光边（袖子、袍摆的软感） */
  function clothTex(base) {
    var N = 512, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = shade(base, 0.92);
    g.fillRect(0, 0, N, N);
    // 斜纹
    g.globalAlpha = 0.18;
    for (var i = -N; i < N * 2; i += 5) {
      g.strokeStyle = i % 10 === 0 ? shade(base, 1.24) : shade(base, 0.66);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + N, N);
      g.stroke();
    }
    // 经纬细点
    g.globalAlpha = 0.10;
    for (var j = 0; j < 5000; j++) {
      g.fillStyle = rnd(j) > 0.5 ? '#ffffff' : '#000000';
      g.fillRect(rnd(j + 3) * N, rnd(j + 9) * N, 1.4, 1.4);
    }
    g.globalAlpha = 1;
    // 折痕：一束向下的褶皱，暗-亮成对
    for (var f = 0; f < 9; f++) {
      var x0 = (f + 0.5) * (N / 9) + (rnd(f) - 0.5) * 30;
      var bend = (rnd(f + 4) - 0.5) * 90;
      var lg2 = g.createLinearGradient(x0 - 22, 0, x0 + 22, 0);
      lg2.addColorStop(0, 'rgba(0,0,0,0)');
      lg2.addColorStop(0.42, 'rgba(0,0,0,0.30)');
      lg2.addColorStop(0.58, 'rgba(255,255,255,0.16)');
      lg2.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lg2;
      g.beginPath();
      g.moveTo(x0 - 26, 0);
      g.quadraticCurveTo(x0 + bend, N * 0.5, x0 - 12, N);
      g.lineTo(x0 + 26, N);
      g.quadraticCurveTo(x0 + bend + 34, N * 0.5, x0 + 26, 0);
      g.closePath();
      g.fill();
    }
    return c;
  }

  /* 皮肤：肤色渐变 + 微红 + 毛孔噪点 */
  function skinTex(base) {
    var N = 256, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = hex(base);
    g.fillRect(0, 0, N, N);
    var rg = g.createRadialGradient(N * 0.5, N * 0.42, N * 0.1, N * 0.5, N * 0.5, N * 0.75);
    rg.addColorStop(0, 'rgba(255,238,226,0.55)');
    rg.addColorStop(0.6, 'rgba(255,220,200,0.10)');
    rg.addColorStop(1, 'rgba(120,72,58,0.30)');
    g.fillStyle = rg;
    g.fillRect(0, 0, N, N);
    for (var i = 0; i < 2600; i++) {
      g.globalAlpha = 0.05 + rnd(i) * 0.10;
      g.fillStyle = rnd(i + 5) > 0.5 ? '#7a4a3a' : '#ffe6d8';
      g.fillRect(rnd(i + 2) * N, rnd(i + 7) * N, 1.6, 1.6);
    }
    g.globalAlpha = 1;
    return c;
  }

  /* 脸：前半球展开，画眉、眼、鼻、唇、下颌与鬓角 */
  function faceTex(base, mood) {
    var N = 512, c = canvas(N), g = c.getContext('2d');
    // 底：中间亮，四周暗，形成球面（整体压暗，避免在 ACES 下烧成白面具）
    var bg = g.createLinearGradient(0, 0, 0, N);
    bg.addColorStop(0, shade(base, 0.52));    // 发际
    bg.addColorStop(0.28, shade(base, 0.80));
    bg.addColorStop(0.60, shade(base, 0.76));
    bg.addColorStop(1, shade(base, 0.52));    // 下颌
    g.fillStyle = bg;
    g.fillRect(0, 0, N, N);

    var cx = N * 0.5;
    var dark = shade(base, 0.42), line = shade(base, 0.26);

    // 鬓角与发际线阴影
    g.fillStyle = 'rgba(30,18,12,0.55)';
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(N, 0); g.lineTo(N, N * 0.16);
    g.quadraticCurveTo(cx, N * 0.26, 0, N * 0.18);
    g.closePath(); g.fill();

    // 眉：剑眉，内低外高（五官收紧到中间，避免半球 UV 把脸拉宽）
    [[-1, 0], [1, 0]].forEach(function (s) {
      g.save();
      g.translate(cx + s[0] * N * 0.105, N * 0.300);
      g.rotate(s[0] * 0.22);
      g.fillStyle = 'rgba(26,16,12,0.94)';
      g.beginPath();
      g.moveTo(-N * 0.104, N * 0.014);
      g.quadraticCurveTo(-N * 0.020, -N * 0.032, N * 0.092, -N * 0.006);
      g.quadraticCurveTo(-N * 0.008, -N * 0.004, -N * 0.104, N * 0.030);
      g.closePath();
      g.fill();
      g.restore();
    });

    // 眼：杏仁形，上眼线重、眼白带一点灰、瞳仁深棕、点高光
    [-1, 1].forEach(function (s) {
      var ex = cx + s * N * 0.100, ey = N * 0.378;
      g.save();
      g.translate(ex, ey);
      // 眼窝阴影
      g.fillStyle = 'rgba(48,26,20,0.46)';
      g.beginPath(); g.ellipse(0, -N * 0.010, N * 0.082, N * 0.042, 0, 0, Math.PI * 2); g.fill();
      // 眼白（偏灰，不是纯白，否则远看是白面具上的两个洞）
      g.fillStyle = '#d8cfc8';
      g.beginPath(); g.ellipse(0, 0, N * 0.062, N * 0.028, s * 0.06, 0, Math.PI * 2); g.fill();
      // 虹膜
      var ir = g.createRadialGradient(0, 1, 1, 0, 0, N * 0.030);
      ir.addColorStop(0, '#5a3a24');
      ir.addColorStop(0.72, '#2c1a10');
      ir.addColorStop(1, '#160c08');
      g.fillStyle = ir;
      g.beginPath(); g.arc(0, 0, N * 0.030, 0, Math.PI * 2); g.fill();
      // 瞳孔
      g.fillStyle = '#080504';
      g.beginPath(); g.arc(0, 0, N * 0.016, 0, Math.PI * 2); g.fill();
      // 高光
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.beginPath(); g.arc(-s * N * 0.010, -N * 0.010, N * 0.009, 0, Math.PI * 2); g.fill();
      // 上眼睑压住虹膜上缘（有了眼睑，眼睛才不是贴上去的圆点）
      g.fillStyle = 'rgba(150,104,84,0.90)';
      g.beginPath();
      g.ellipse(0, -N * 0.024, N * 0.064, N * 0.018, 0, 0, Math.PI * 2);
      g.fill();
      // 上眼线（眼尾上扬）
      g.strokeStyle = line; g.lineWidth = N * 0.010; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-N * 0.066, -N * 0.008);
      g.quadraticCurveTo(0, -N * 0.042, N * 0.068, -N * 0.012);
      g.stroke();
      // 下眼影
      g.strokeStyle = 'rgba(70,40,30,0.55)'; g.lineWidth = N * 0.008;
      g.beginPath();
      g.moveTo(-N * 0.050, N * 0.016);
      g.quadraticCurveTo(0, N * 0.032, N * 0.050, N * 0.012);
      g.stroke();
      g.restore();
    });

    // 鼻：鼻梁亮线 + 鼻翼与鼻底暗
    var ng = g.createLinearGradient(cx, N * 0.42, cx, N * 0.60);
    ng.addColorStop(0, 'rgba(255,246,238,0.62)');
    ng.addColorStop(1, 'rgba(120,74,60,0.14)');
    g.fillStyle = ng;
    g.beginPath();
    g.moveTo(cx - N * 0.028, N * 0.43);
    g.lineTo(cx + N * 0.032, N * 0.43);
    g.lineTo(cx + N * 0.050, N * 0.585);
    g.lineTo(cx - N * 0.044, N * 0.585);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(92,52,40,0.50)';
    [-1, 1].forEach(function (s) {
      g.beginPath();
      g.ellipse(cx + s * N * 0.054, N * 0.590, N * 0.028, N * 0.016, s * 0.3, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = 'rgba(60,30,24,0.62)';
    g.beginPath();
    g.ellipse(cx, N * 0.612, N * 0.038, N * 0.012, 0, 0, Math.PI * 2);
    g.fill();

    // 唇：上唇偏暗、下唇受光、唇线清晰，嘴角略下压（原著那种不笑的脸）
    var ly = N * 0.706;
    g.fillStyle = shade(base, 0.50);
    g.beginPath();
    g.moveTo(cx - N * 0.068, ly);
    g.quadraticCurveTo(cx - N * 0.022, ly - N * 0.026, cx, ly - N * 0.010);
    g.quadraticCurveTo(cx + N * 0.022, ly - N * 0.026, cx + N * 0.068, ly);
    g.quadraticCurveTo(cx, ly + N * 0.020, cx - N * 0.068, ly);
    g.closePath(); g.fill();
    g.fillStyle = shade(base, 0.74);
    g.beginPath();
    g.moveTo(cx - N * 0.056, ly + N * 0.005);
    g.quadraticCurveTo(cx, ly + N * 0.046, cx + N * 0.056, ly + N * 0.005);
    g.quadraticCurveTo(cx, ly + N * 0.014, cx - N * 0.056, ly + N * 0.005);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(40,18,14,0.84)'; g.lineWidth = N * 0.008;
    g.beginPath();
    g.moveTo(cx - N * 0.062, ly);
    g.quadraticCurveTo(cx, ly + N * 0.012, cx + N * 0.062, ly);
    g.stroke();

    // 颧骨与下颌阴影：用径向渐变，别画成两块腮红
    [-1, 1].forEach(function (s) {
      var cg = g.createRadialGradient(cx + s * N * 0.150, N * 0.548, N * 0.010,
        cx + s * N * 0.150, N * 0.548, N * 0.105);
      cg.addColorStop(0, 'rgba(84,44,34,0.16)');
      cg.addColorStop(1, 'rgba(84,44,34,0)');
      g.fillStyle = cg;
      g.beginPath();
      g.arc(cx + s * N * 0.150, N * 0.548, N * 0.105, 0, Math.PI * 2);
      g.fill();
    });
    var jg = g.createRadialGradient(cx, N * 0.845, N * 0.020, cx, N * 0.845, N * 0.175);
    jg.addColorStop(0, 'rgba(70,38,30,0.20)');
    jg.addColorStop(1, 'rgba(70,38,30,0)');
    g.fillStyle = jg;
    g.beginPath();
    g.ellipse(cx, N * 0.845, N * 0.175, N * 0.100, 0, 0, Math.PI * 2);
    g.fill();

    // 左侧一道旧疤（原著气质的"打过很多场"）
    if (mood !== 'clean') {
      g.strokeStyle = 'rgba(150,96,80,0.55)';
      g.lineWidth = N * 0.010;
      g.beginPath();
      g.moveTo(cx - N * 0.115, N * 0.34);
      g.lineTo(cx - N * 0.165, N * 0.56);
      g.stroke();
    }
    return c;
  }

  /* 头皮 / 发丝：深底 + 一根根亮发 */
  function hairTex(base) {
    var N = 256, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = shade(base, 0.55);
    g.fillRect(0, 0, N, N);
    for (var i = 0; i < 420; i++) {
      var x = rnd(i) * N, bend = (rnd(i + 3) - 0.5) * 26;
      g.strokeStyle = i % 3 === 0 ? shade(base, 1.55) : shade(base, 1.10);
      g.globalAlpha = 0.30 + rnd(i + 8) * 0.55;
      g.lineWidth = 1 + rnd(i + 1) * 1.4;
      g.beginPath();
      g.moveTo(x, -10);
      g.quadraticCurveTo(x + bend, N * 0.5, x + bend * 0.4, N + 10);
      g.stroke();
    }
    g.globalAlpha = 1;
    return c;
  }

  /* 发丝面片用的 alpha 图：黑底白丝，贴到 plane 上做透光发束 */
  function strandTex(base) {
    var N = 128, c = canvas(N), g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, N, N);
    for (var i = 0; i < 26; i++) {
      var x = rnd(i) * N, bend = (rnd(i + 3) - 0.5) * 40;
      g.strokeStyle = i % 4 === 0 ? '#fff' : 'rgba(255,255,255,0.72)';
      g.lineWidth = 1 + rnd(i + 1) * 2.2;
      g.beginPath();
      g.moveTo(x, -4);
      g.quadraticCurveTo(x + bend, N * 0.55, x + bend * 0.5, N + 4);
      g.stroke();
    }
    return c;
  }

  /* ============================================================
     二、纹理缓存与材质
     ============================================================ */
  var texCache = {};
  function tex(key, maker, repeat) {
    if (!texCache[key]) {
      var t = new T.CanvasTexture(maker());
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = 4;
      if (repeat) { t.repeat.set(repeat, repeat); }
      t.needsUpdate = true;
      texCache[key] = t;
    }
    return texCache[key];
  }

  var PAL = {
    swordsman: { armor: 0xb9c8d6, cloth: 0x1d2a36, skin: 0xcf9f7f, accent: 0x6fe4ff, hair: 0x14100e },
    gunner: { armor: 0xa9b6c2, cloth: 0x3a2b22, skin: 0xc49472, accent: 0xffb04a, hair: 0x1a1210 },
    warlock: { armor: 0x6c5f7e, cloth: 0x241b30, skin: 0xbe8f72, accent: 0xc98cff, hair: 0x120c10 },
    grunt: { armor: 0x8e4a44, cloth: 0x2a2328, skin: 0x6a544a, accent: 0xff6a5a, hair: 0x120c0c },
    shooter: { armor: 0x7d4a44, cloth: 0x2b2429, skin: 0x68504a, accent: 0xff6a5a, hair: 0x120c0c },
    elite: { armor: 0x9c4a3c, cloth: 0x2b1f22, skin: 0x634740, accent: 0xff8a5a, hair: 0x100a0a },
    boss: { armor: 0x3d3a46, cloth: 0x18141c, skin: 0x5c423b, accent: 0xff3a2a, hair: 0x0a0808 }
  };

  function matSet(kind) {
    var p = PAL[kind] || PAL.swordsman;
    var key = kind;
    function M(slot, cfg) {
      var m = new T.MeshStandardMaterial(cfg);
      m.userData = { part: slot, shared: false };
      return m;
    }
    var set = {
      armor: M('armor', {
        map: tex(key + '|a', function () { return armorTex(p.armor); }, 2),
        bumpMap: tex(key + '|ab', function () { return armorTex(p.armor); }, 2),
        bumpScale: 0.035,
        roughness: 0.42, metalness: 0.62,
        color: 0xffffff
      }),
      cloth: M('cloth', {
        map: tex(key + '|c', function () { return clothTex(p.cloth); }, 2),
        bumpMap: tex(key + '|cb', function () { return clothTex(p.cloth); }, 2),
        bumpScale: 0.02,
        roughness: 0.94, metalness: 0.02
      }),
      skin: M('skin', {
        map: tex(key + '|s', function () { return skinTex(p.skin); }, 1),
        roughness: 0.72, metalness: 0.0
      }),
      face: M('face', {
        map: tex(key + '|f', function () { return faceTex(p.skin, kind === 'boss' ? 'clean' : ''); }, 1),
        roughness: 0.66, metalness: 0.0
      }),
      hair: M('hair', {
        map: tex(key + '|h', function () { return hairTex(p.hair); }, 2),
        bumpMap: tex(key + '|hb', function () { return hairTex(p.hair); }, 2),
        bumpScale: 0.05,
        roughness: 0.52, metalness: 0.08, color: 0xffffff
      }),
      accent: M('accent', {
        color: p.accent, emissive: new T.Color(p.accent).multiplyScalar(0.55),
        roughness: 0.5, metalness: 0.1
      }),
      steel: M('steel', { color: 0xc8d6e4, roughness: 0.22, metalness: 0.95 }),
      dark: M('cloth', { color: 0x14171c, roughness: 0.85, metalness: 0.05 }),
      leather: M('cloth', { color: 0x4a352a, roughness: 0.80, metalness: 0.04 })
    };
    set.pal = p;
    return set;
  }

  /* ============================================================
     三、骨架：每根骨一个 Group，网格挂在骨上向下延伸
     ============================================================ */
  var BONE = [];
  function bone(parent, name, x, y, z) {
    var g = new T.Group();
    g.name = name;
    g.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(g);
    BONE.push(g);
    return g;
  }

  /* 一段肢体：从骨原点向 -y 延伸 len，两端半径可不同 */
  function limb(parent, len, rTop, rBot, mat, opts) {
    opts = opts || {};
    var h = len;
    var geo = new T.CylinderGeometry(rTop, rBot, h, opts.seg || 12, 1, false);
    var mesh = new T.Mesh(geo, mat);
    mesh.position.y = -h / 2;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.part = mat.userData ? mat.userData.part : '';
    parent.add(mesh);
    return mesh;
  }

  function jointBall(parent, r, mat, y, sx, sy, sz) {
    var geo = new T.SphereGeometry(r, 12, 8);
    var mesh = new T.Mesh(geo, mat);
    mesh.position.y = y || 0;
    mesh.scale.set(sx || 1, sy || 1, sz || 1);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /* ============================================================
     四、人形装配（三职业 + 敌人共用同一套关节）
     ============================================================ */
  function build(kind, opts) {
    opts = opts || {};
    var M = (opts.mats) || matSet(kind);
    var p = M.pal;
    var root = new T.Group();
    var J = {};

    var tall = kind === 'boss' ? 1.22 : (kind === 'elite' ? 1.10 : 1);
    root.scale.setScalar(opts.scale || tall);

    /* --- 中轴 --- */
    J.pelvis = bone(root, 'pelvis', 0, 0.930, 0);
    J.spine = bone(J.pelvis, 'spine', 0, 0.100, 0);
    J.chest = bone(J.spine, 'chest', 0, 0.235, 0);
    J.neck = bone(J.chest, 'neck', 0, 0.185, 0);
    J.head = bone(J.neck, 'head', 0, 0.105, 0);

    /* --- 骨盆 / 腰 --- */
    jointBall(J.pelvis, 0.098, M.cloth, 0, 1.10, 1);
    limb(J.pelvis, 0.16, 0.108, 0.098, M.cloth, { seg: 12 });

    /* --- 腰腹：脊柱在胸下，把腰收进去 --- */
    limb(J.spine, 0.26, 0.104, 0.132, M.cloth, { seg: 14 });
    jointBall(J.spine, 0.104, M.cloth, 0.02, 1, 0.94, 0.86);

    /* --- 胸廓：上宽下窄的桶，胸前挂甲 --- */
    limb(J.chest, 0.24, 0.156, 0.132, M.cloth, { seg: 16 });
    jointBall(J.chest, 0.156, M.cloth, -0.005, 1.02, 0.80, 0.90);

    /* --- 颈与头 --- */
    limb(J.neck, 0.078, 0.056, 0.062, M.skin, { seg: 12 });
    var skull = new T.Mesh(new T.SphereGeometry(0.112, 20, 16), M.hair);
    skull.position.y = 0.118;
    skull.scale.set(0.96, 1.10, 1.0);
    skull.castShadow = true;
    J.head.add(skull);
    // 下半张脸：只取前半球贴脸，脸型与颅骨分开控制
    // 脸：头前部的一层球壳，半径必须明显大于颅骨（0.112），
    // 否则两张面几乎重合，脸会被头发"啃"成几个洞
    var faceGeo = new T.SphereGeometry(0.1188, 22, 18, Math.PI * 1.24, Math.PI * 0.52, Math.PI * 0.20, Math.PI * 0.60);
    var faceMesh = new T.Mesh(faceGeo, M.face);
    faceMesh.position.y = 0.120;
    J.faceMesh = faceMesh;
    J.head.add(faceMesh);
    // 下巴与下颌线（一点点实体，让侧脸不是球）
    var jaw = new T.Mesh(new T.SphereGeometry(0.104, 14, 10, Math.PI, Math.PI, Math.PI * 0.42, Math.PI * 0.36), M.skin);
    jaw.position.set(0, 0.104, -0.004);
    jaw.scale.set(0.94, 0.94, 1.02);
    J.jaw = jaw;
    J.head.add(jaw);
    // 耳朵
    J.ears = [];
    [-1, 1].forEach(function (s) {
      var ear = new T.Mesh(new T.SphereGeometry(0.026, 10, 8), M.skin);
      ear.position.set(0.104 * s, 0.118, 0.006);
      ear.scale.set(0.5, 1.0, 0.72);
      J.head.add(ear);
      J.ears.push(ear);
    });

    /* --- 锁骨与肩 --- */
    [-1, 1].forEach(function (s) {
      var side = s < 0 ? 'L' : 'R';
      J['shoulder' + side] = bone(J.chest, 'shoulder' + side, 0.192 * s, 0.150, 0);
      jointBall(J['shoulder' + side], 0.070, M.cloth, 0, 1.05, 0.95, 0.95);

      J['elbow' + side] = bone(J['shoulder' + side], 'elbow' + side, 0.020 * s, -0.300, 0);
      limb(J['shoulder' + side], 0.300, 0.058, 0.047, M.cloth, { seg: 12 });
      jointBall(J['elbow' + side], 0.047, M.cloth, 0, 1, 1, 1);

      J['wrist' + side] = bone(J['elbow' + side], 'wrist' + side, 0, -0.270, 0);
      // 前臂走布料，护腕甲片在 dress 里叠上去；不直接用肤色，否则远看是一根白棒
      limb(J['elbow' + side], 0.270, 0.045, 0.036, M.cloth, { seg: 12 });
      jointBall(J['wrist' + side], 0.036, M.leather, 0, 1, 1, 1);

      // 手：掌 + 四指合并的指块 + 拇指，戴护手（皮/甲），不露肤色面包块
      var hand = J['wrist' + side];
      var palm = new T.Mesh(new T.BoxGeometry(0.056, 0.086, 0.032), M.leather);
      palm.position.set(0, -0.048, 0);
      hand.add(palm);
      var backPlate = new T.Mesh(new T.BoxGeometry(0.050, 0.058, 0.012), M.armor);
      backPlate.position.set(0, -0.044, 0.020);
      hand.add(backPlate);
      var fingers = new T.Mesh(new T.BoxGeometry(0.050, 0.054, 0.028), M.leather);
      fingers.position.set(0, -0.098, -0.004);
      hand.add(fingers);
      var thumb = new T.Mesh(new T.CylinderGeometry(0.014, 0.011, 0.048, 8), M.leather);
      thumb.position.set(-0.032 * s, -0.052, -0.014);
      thumb.rotation.z = 0.7 * s;
      hand.add(thumb);
      palm.castShadow = fingers.castShadow = true;
    });

    /* --- 腿 --- */
    [-1, 1].forEach(function (s) {
      var side = s < 0 ? 'L' : 'R';
      J['hip' + side] = bone(J.pelvis, 'hip' + side, 0.088 * s, -0.020, 0);
      jointBall(J['hip' + side], 0.062, M.cloth, 0, 1, 1, 1);

      J['knee' + side] = bone(J['hip' + side], 'knee' + side, 0, -0.420, 0);
      limb(J['hip' + side], 0.420, 0.086, 0.062, M.cloth, { seg: 12 });
      jointBall(J['knee' + side], 0.062, M.cloth, 0, 1, 1, 1);

      J['ankle' + side] = bone(J['knee' + side], 'ankle' + side, 0, -0.400, 0);
      limb(J['knee' + side], 0.400, 0.062, 0.046, M.cloth, { seg: 12 });
      jointBall(J['ankle' + side], 0.046, M.leather, 0, 1, 1, 1);

      var foot = new T.Mesh(new T.BoxGeometry(0.092, 0.066, 0.220), M.leather);
      foot.position.set(0, -0.036, -0.062);
      J['ankle' + side].add(foot);
      foot.castShadow = true;
      // 靴口
      var cuff = new T.Mesh(new T.CylinderGeometry(0.066, 0.062, 0.076, 12), M.leather);
      cuff.position.y = 0.010;
      J['ankle' + side].add(cuff);
    });

    /* --- 职业装束 --- */
    dress(J, M, kind, p);

    /* --- 接触阴影 --- */
    var blob = blobShadow(kind === 'boss' ? 0.80 : 0.42);
    root.add(blob);

    root.userData.rig = {
      kind: kind, J: J, M: M,
      phase: 0, t: 0,
      // 动作权重：外部改这些值，update 会在帧间平滑过去
      w: { walk: 0, attack: 0, cast: 0, hit: 0, guard: 0, dead: 0 },
      attackClip: null, attackT: 0,
      aim: 0, air: 0, lean: 0,
      // 枪手平时就把枪抬到半举，静息不至于把枪垂在胯前
      baseAim: kind === 'gunner' ? 0.42 : 0
    };
    root.userData.part = 'hero3d';
    root.castShadow = true;
    return root;
  }

  /* --- 脚下接触阴影（与 art.js 同做法，独立一份避免耦合） --- */
  var _blob = null;
  function blobShadow(r) {
    if (!_blob) {
      var c = document.createElement('canvas');
      c.width = c.height = 128;
      var g = c.getContext('2d');
      var grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
      grad.addColorStop(0, 'rgba(0,0,0,0.62)');
      grad.addColorStop(0.45, 'rgba(0,0,0,0.28)');
      grad.addColorStop(0.78, 'rgba(0,0,0,0.09)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      _blob = new T.CanvasTexture(c);
      _blob.needsUpdate = true;
    }
    var mesh = new T.Mesh(new T.PlaneGeometry(r * 2, r * 2),
      new T.MeshBasicMaterial({ map: _blob, transparent: true, depthWrite: false, opacity: 0.8 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.012;
    mesh.renderOrder = 2;
    mesh.userData.part = 'shadow';
    return mesh;
  }

  /* ============================================================
     五、装束：甲片带厚度与边缘，软料带褶皱，武器握在右手腕
     ============================================================ */
  function platelen(parent, y, w, h, d, mat, rx, rz) {
    var m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.y = y;
    if (rx) m.rotation.x = rx;
    if (rz) m.rotation.z = rz;
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  /* 肩甲：三层圆弧片从肩顶往下包，外沿上翘 */
  function pauldron(J, M, s, scale) {
    scale = scale || 1;
    var sh = J['shoulder' + (s < 0 ? 'L' : 'R')];
    var base = s > 0 ? Math.PI * 0.76 : Math.PI * 1.76;
    // 甲片在小件上不能被 UV 重复挤成蜂巢，用 repeat=1 的专用材质
    var mat = M.armor;
    if (!M._smallArmor) {
      var tx = M.armor.map.clone();
      tx.needsUpdate = true;
      if (tx.repeat) tx.repeat.set(1, 1);
      var bm = M.armor.bumpMap && M.armor.bumpMap.clone();
      if (bm) { bm.needsUpdate = true; if (bm.repeat) bm.repeat.set(1, 1); }
      M._smallArmor = M.armor.clone();
      M._smallArmor.map = tx;
      if (bm) M._smallArmor.bumpMap = bm;
      M._smallArmor.userData = { part: 'armor', shared: false };
    }
    mat = M._smallArmor;
    for (var i = 0; i < 3; i++) {
      var geo = new T.SphereGeometry((0.112 - i * 0.008) * scale, 16, 10,
        base, Math.PI * 0.48, Math.PI * (0.10 + i * 0.14), Math.PI * 0.34);
      var m = new T.Mesh(geo, mat);
      m.position.set(0.004 * s, 0.010 - i * 0.004, 0);
      m.rotation.z = -0.16 * s;
      m.castShadow = true;
      m.receiveShadow = true;
      sh.add(m);
    }
    // 边缘压条：贴着最外层片的下沿
    var rim = new T.Mesh(new T.TorusGeometry(0.104 * scale, 0.007, 6, 16, Math.PI * 0.96), M.steel);
    rim.position.set(0.010 * s, -0.016, 0);
    rim.rotation.set(Math.PI / 2, 0, s > 0 ? -Math.PI * 0.24 : Math.PI * 0.24);
    rim.scale.set(1, 1, 0.62);
    sh.add(rim);
  }

  /* 胸甲：贴着胸廓的前半圈，带中脊与领口 */
  function chestPlate(J, M, w) {
    var geo = new T.CylinderGeometry(0.160 * w, 0.144 * w, 0.230, 20, 1, true, Math.PI * 0.67, Math.PI * 0.66);
    var m = new T.Mesh(geo, M.armor);
    m.position.set(0, -0.108, 0);
    m.rotation.y = Math.PI;
    m.scale.set(1, 1, 0.88);
    m.castShadow = true;
    J.chest.add(m);
    // 中脊
    platelen(J.chest, -0.108, 0.026, 0.226, 0.016, M.steel, 0, 0);
    // 领口
    var collar = new T.Mesh(new T.TorusGeometry(0.112, 0.012, 8, 22, Math.PI), M.armor);
    collar.position.y = 0.006;
    collar.rotation.set(Math.PI / 2, 0, 0);
    J.chest.add(collar);
    // 胸口徽记
    var crest = new T.Mesh(new T.CircleGeometry(0.030, 14), M.accent);
    crest.position.set(0, -0.070, -0.132);
    J.chest.add(crest);
  }

  /* 下摆 / 袍：一圈分片的软边，走动时跟着腿摆 */
  function skirt(J, M, top, bottom, y0, len, segs, mat, close) {
    var parts = [];
    var count = segs || 10;
    for (var i = 0; i < count; i++) {
      var a0 = (i / count) * Math.PI * 2;
      var a1 = ((i + 1) / count) * Math.PI * 2 - 0.02;
      if (close && Math.abs(Math.sin((a0 + a1) / 2)) < 0.28 && Math.cos((a0 + a1) / 2) > 0) continue;
      var geo = new T.CylinderGeometry(top, bottom, len, 3, 1, true, a0, a1 - a0);
      var m = new T.Mesh(geo, mat);
      m.position.y = y0;
      m.castShadow = true;
      J.pelvis.add(m);
      parts.push(m);
    }
    return parts;
  }

  /* 披风：网格面片顶点做低频扰动，双面 */
  function cape(J, M, w, h, mat) {
    var geo = new T.PlaneGeometry(w, h, 5, 10);
    var pa = geo.attributes.position;
    for (var i = 0; i < pa.count; i++) {
      var x = pa.getX(i), y = pa.getY(i);
      var k = (y + h / 2) / h;
      pa.setZ(i, Math.sin(x * 8 + y * 3) * 0.016 + k * 0.05 + Math.sin(y * 6) * 0.012);
      pa.setX(i, x * (1 + k * 0.30));
    }
    geo.computeVertexNormals();
    var m = new T.Mesh(geo, new T.MeshStandardMaterial({
      map: mat.map, bumpMap: mat.bumpMap, bumpScale: 0.02,
      roughness: 0.94, metalness: 0.02, side: T.DoubleSide, color: mat.color
    }));
    m.position.set(0, -0.04, 0.062);
    m.rotation.x = 0.06;
    J.chest.add(m);
    var pivot = m;
    J.cape = m;
    return pivot;
  }

  /* --- 长刀 --- */
  function weaponBlade(J, M, len) {
    len = len || 0.92;
    var w = J.wristR;
    var g = new T.Group();
    g.position.set(0, -0.052, 0);
    // 手腕在 y≈0.80，刀向前下斜 56° 才不戳进地面（纯垂直会让刀尖埋进土里 30cm）
    g.rotation.x = 0.98;
    w.add(g);
    // 柄
    var grip = new T.Mesh(new T.CylinderGeometry(0.016, 0.018, 0.200, 10), M.leather);
    grip.position.y = 0.040;
    grip.rotation.x = 0.0;
    g.add(grip);
    // 柄头
    var butt = new T.Mesh(new T.SphereGeometry(0.020, 10, 8), M.steel);
    butt.position.y = 0.146;
    g.add(butt);
    // 护手
    var guard = new T.Mesh(new T.BoxGeometry(0.112, 0.016, 0.040), M.steel);
    guard.position.y = -0.056;
    g.add(guard);
    // 刀身：扁棱 + 刃口薄片，刀尖斜切
    var blade = new T.Mesh(new T.BoxGeometry(0.034, len, 0.009), M.steel);
    blade.position.y = -0.060 - len / 2;
    g.add(blade);
    var edge = new T.Mesh(new T.BoxGeometry(0.010, len * 0.96, 0.006), M.steel);
    edge.position.set(-0.016, -0.060 - len / 2, 0.005);
    g.add(edge);
    var tip = new T.Mesh(new T.ConeGeometry(0.017, 0.070, 4), M.steel);
    tip.position.y = -0.060 - len - 0.030;
    tip.rotation.y = Math.PI / 4;
    g.add(tip);
    // 背脊亮线
    var spine = new T.Mesh(new T.BoxGeometry(0.006, len * 0.86, 0.004), M.steel);
    spine.position.set(0.016, -0.060 - len / 2, 0.004);
    g.add(spine);
    blade.castShadow = guard.castShadow = true;
    return g;
  }

  /* --- 长枪（右手端枪，枪口朝前 -z） --- */
  function weaponRifle(J, M, long) {
    var w = J.wristR;
    var g = new T.Group();
    g.position.set(0, -0.070, -0.020);
    g.rotation.x = -0.22;
    w.add(g);
    var L = long ? 1.10 : 0.92;
    // 枪身（沿 -z）
    var body = new T.Mesh(new T.BoxGeometry(0.054, 0.070, L * 0.62), M.dark);
    body.position.set(0, 0.006, -L * 0.30);
    g.add(body);
    // 枪管
    var barrel = new T.Mesh(new T.CylinderGeometry(0.013, 0.013, L * 0.52, 10), M.steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.016, -L * 0.62);
    g.add(barrel);
    // 消焰口
    var muzzle = new T.Mesh(new T.CylinderGeometry(0.019, 0.016, 0.038, 10), M.dark);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.016, -L * 0.88);
    g.add(muzzle);
    // 弹匣
    var mag = new T.Mesh(new T.BoxGeometry(0.030, 0.120, 0.046), M.dark);
    mag.position.set(0, -0.040, -L * 0.24);
    mag.rotation.x = -0.16;
    g.add(mag);
    // 枪托
    var stock = new T.Mesh(new T.BoxGeometry(0.040, 0.060, 0.180), M.leather);
    stock.position.set(0, -0.010, 0.076);
    g.add(stock);
    // 瞄具
    var scope = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.120, 10), M.dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.052, -L * 0.30);
    g.add(scope);
    var dot = new T.Mesh(new T.SphereGeometry(0.007, 8, 6), M.accent);
    dot.position.set(0, 0.052, -L * 0.36);
    g.add(dot);
    // 握把
    var grip = new T.Mesh(new T.BoxGeometry(0.026, 0.070, 0.030), M.leather);
    grip.position.set(0, -0.036, 0.010);
    grip.rotation.x = 0.30;
    g.add(grip);
    return g;
  }

  /* --- 法杖（杖身 + 顶环 + 悬浮法球） --- */
  function weaponStaff(J, M) {
    var w = J.wristR;
    var g = new T.Group();
    g.position.set(0, -0.060, -0.010);
    g.rotation.x = -0.10;
    w.add(g);
    var shaft = new T.Mesh(new T.CylinderGeometry(0.014, 0.018, 1.280, 10), M.leather);
    shaft.position.y = -0.180;
    g.add(shaft);
    // 缠绳
    for (var i = 0; i < 5; i++) {
      var ring = new T.Mesh(new T.TorusGeometry(0.019, 0.004, 6, 12), M.dark);
      ring.position.y = -0.300 - i * 0.030;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    // 顶环
    var ring2 = new T.Mesh(new T.TorusGeometry(0.072, 0.010, 8, 18), M.accent);
    ring2.position.y = 0.500;
    g.add(ring2);
    var ring3 = new T.Mesh(new T.TorusGeometry(0.052, 0.006, 8, 16), M.accent);
    ring3.position.y = 0.500;
    ring3.rotation.y = Math.PI / 2;
    g.add(ring3);
    // 法球
    var orb = new T.Mesh(new T.SphereGeometry(0.046, 14, 12),
      new T.MeshStandardMaterial({ color: M.pal.accent, emissive: new T.Color(M.pal.accent), emissiveIntensity: 0.75, roughness: 0.38 }));
    orb.position.y = 0.500;
    orb.userData.part = 'accent';
    g.add(orb);
    J.orb = orb;
    return g;
  }

  /* --- 兜帽：后半开的帽壳 + 顶 + 帽尖，前脸留出空间 --- */
  function hood(J, M) {
    var geo = new T.CylinderGeometry(0.140, 0.200, 0.300, 14, 1, true, Math.PI * 0.62, Math.PI * 1.24);
    var m = new T.Mesh(geo, M.cloth);
    m.position.set(0, 0.108, 0.014);
    m.rotation.y = Math.PI;
    m.scale.set(1, 1, 0.94);
    m.castShadow = true;
    J.head.add(m);
    var top = new T.Mesh(new T.SphereGeometry(0.126, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), M.cloth);
    top.position.set(0, 0.216, 0.012);
    top.scale.set(1, 0.66, 0.98);
    J.head.add(top);
    var tip = new T.Mesh(new T.ConeGeometry(0.032, 0.34, 10), M.cloth);
    tip.position.set(0, 0.150, 0.232);
    tip.rotation.x = 1.24;
    J.head.add(tip);
    // 后颈/帽内壁：整圈暗色桶，把头与肩连起来，不然戴帽时头看起来浮在空中
    var inner = new T.Mesh(new T.CylinderGeometry(0.122, 0.146, 0.220, 16), M.cloth);
    inner.position.set(0, 0.014, 0.026);
    inner.castShadow = true;
    J.head.add(inner);
    // 两侧翻边：贴着头侧的一小段，不能做成两片门板
    [-1, 1].forEach(function (s) {
      var lap = new T.Mesh(new T.BoxGeometry(0.024, 0.150, 0.104), M.cloth);
      lap.position.set(0.116 * s, 0.104, -0.012);
      lap.rotation.set(0, -0.30 * s, 0.12 * s);
      J.head.add(lap);
    });
  }

  function dress(J, M, kind, p) {
    var slim = kind === 'swordsman';
    var broad = kind === 'gunner';
    var robe = kind === 'warlock';

    if (slim) {
      pauldron(J, M, -1, 1.02);
      pauldron(J, M, 1, 1.02);
      chestPlate(J, M, 1.0);
      // 腰甲三片
      platelen(J.pelvis, -0.010, 0.104, 0.150, 0.026, M.armor, 0, 0);
      platelen(J.pelvis, -0.020, 0.096, 0.170, 0.026, M.armor, 0, -0.34);
      platelen(J.pelvis, -0.020, 0.096, 0.170, 0.026, M.armor, 0, 0.34);
      // 护腕 / 护胫
      [-1, 1].forEach(function (s) {
        var side = s < 0 ? 'L' : 'R';
        var b = new T.Mesh(new T.CylinderGeometry(0.046, 0.042, 0.150, 12), M.armor);
        b.position.y = -0.216;
        J['elbow' + side].add(b);
        var cu = new T.Mesh(new T.CylinderGeometry(0.062, 0.058, 0.230, 12), M.armor);
        cu.position.y = -0.150;
        J['knee' + side].add(cu);
        var kn = new T.Mesh(new T.SphereGeometry(0.062, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), M.armor);
        kn.position.y = 0.002;
        kn.rotation.x = Math.PI;
        J['knee' + side].add(kn);
      });
      // 长披（剪影里最长的一条软边）
      cape(J, M, 0.34, 0.92, M.cloth);
      // 束发 + 马尾（三段，越往下越细）
      // 束发：细的发绳 + 发髻，不能做成一个黑帽子
      var tie = new T.Mesh(new T.CylinderGeometry(0.030, 0.034, 0.036, 10), M.leather);
      tie.position.set(0, 0.196, 0.058);
      J.head.add(tie);
      var bun = new T.Mesh(new T.SphereGeometry(0.046, 12, 10), M.hair);
      bun.position.set(0, 0.222, 0.046);
      bun.scale.set(1.0, 0.86, 1.05);
      J.head.add(bun);
      var tail = new T.Group();
      tail.position.set(0, 0.196, 0.072);
      tail.rotation.x = -0.34;
      J.head.add(tail);
      var r0 = 0.040;
      for (var i = 0; i < 4; i++) {
        var seg = new T.Mesh(new T.CylinderGeometry(r0, r0 * 0.86, 0.150, 10), M.hair);
        seg.position.y = -0.075 - i * 0.150;
        seg.rotation.x = i * 0.10;
        tail.add(seg);
        r0 *= 0.86;
      }
      J.tail = tail;
      weaponBlade(J, M, 0.92);
      // 头发丝面片：额前几缕（放在脸壳外侧，别挡住眼睛）
      for (var k = 0; k < 5; k++) {
        var st = new T.Mesh(new T.PlaneGeometry(0.026, 0.090),
          new T.MeshStandardMaterial({
            map: tex('strand', function () { return strandTex(); }),
            alphaMap: tex('strand', function () { return strandTex(); }),
            transparent: true, side: T.DoubleSide, roughness: 0.5, color: new T.Color(p.hair).multiplyScalar(2.2)
          }));
        st.position.set(-0.070 + k * 0.035, 0.206, -0.092);
        st.rotation.set(-0.42, (k - 2) * 0.09, (k - 2) * 0.14);
        J.head.add(st);
      }
    } else if (broad) {
      pauldron(J, M, -1, 1.14);
      pauldron(J, M, 1, 1.14);
      chestPlate(J, M, 1.10);
      // 弹带：斜挂在胸前的一排弹壳
      for (var b = 0; b < 9; b++) {
        var shell = new T.Mesh(new T.CylinderGeometry(0.011, 0.011, 0.048, 8), M.accent);
        shell.position.set(-0.070 + b * 0.017, 0.070 - b * 0.024, -0.140);
        shell.rotation.set(0.4, 0, 0);
        J.chest.add(shell);
      }
      // 宽腰带 + 侧包
      var belt = new T.Mesh(new T.CylinderGeometry(0.118, 0.122, 0.070, 16), M.leather);
      belt.position.y = 0.006;
      J.pelvis.add(belt);
      platelen(J.pelvis, -0.010, 0.070, 0.100, 0.030, M.leather, 0, 0.5);
      // 护膝
      [-1, 1].forEach(function (s) {
        var kn = new T.Mesh(new T.SphereGeometry(0.058, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), M.armor);
        kn.position.y = 0.002;
        kn.rotation.x = Math.PI;
        J['knee' + (s < 0 ? 'L' : 'R')].add(kn);
        var gl = new T.Mesh(new T.CylinderGeometry(0.048, 0.046, 0.120, 12), M.leather);
        gl.position.y = -0.220;
        J['elbow' + (s < 0 ? 'L' : 'R')].add(gl);
      });
      // 短披肩
      cape(J, M, 0.34, 0.44, M.cloth);
      // 短刺发
      for (var h = 0; h < 7; h++) {
        var tuft = new T.Mesh(new T.ConeGeometry(0.026, 0.072, 6), M.hair);
        tuft.position.set(-0.080 + h * 0.027, 0.236, -0.030 + (h % 2) * 0.028);
        tuft.rotation.set(-0.5, 0, (h - 3) * 0.16);
        J.head.add(tuft);
      }
      weaponRifle(J, M, false);
    } else if (robe) {
      // 兜帽 + 露脸
      hood(J, M);
      chestPlate(J, M, 0.96);
      // 长袍：从腰到小腿的分片软摆（原来垂到 0.76 把腿全罩住，剪影太笨）
      skirt(J, M, 0.120, 0.262, -0.020, 0.640, 12, M.cloth, false);
      // 前襟两片交叠
      platelen(J.pelvis, -0.300, 0.160, 0.560, 0.020, M.cloth, 0.06, 0.10);
      platelen(J.pelvis, -0.320, 0.150, 0.520, 0.020, M.cloth, 0.06, -0.12);
      // 胸前符文
      for (var r = 0; r < 3; r++) {
        var rune = new T.Mesh(new T.CircleGeometry(0.016 + r * 0.002, 8), M.accent);
        rune.position.set(0, 0.020 - r * 0.032, -0.142);
        J.chest.add(rune);
      }
      // 袖口宽大
      [-1, 1].forEach(function (s) {
        var sleeve = new T.Mesh(new T.CylinderGeometry(0.052, 0.086, 0.260, 12), M.cloth);
        sleeve.position.y = -0.180;
        J['elbow' + (s < 0 ? 'L' : 'R')].add(sleeve);
      });
      weaponStaff(J, M);
    } else {
      /* ---- 敌人：甲片更厚，颜色按 kind ---- */
      // 黑甲武士不露脸：面甲之下不该出现"安卓脸"，耳朵也别露
      if (J.faceMesh) J.faceMesh.visible = false;
      if (J.ears) J.ears.forEach(function (e) { e.visible = false; });
      if (J.jaw) J.jaw.visible = false;
      // 全罩头盔：盖住颅骨与下巴，只留正面一条红缝，剪影立刻变成武士
      var dome = new T.Mesh(new T.SphereGeometry(0.136, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.74), M.armor);
      dome.position.set(0, 0.112, 0.004);
      dome.scale.set(1, 1.08, 1);
      dome.castShadow = true;
      J.head.add(dome);
      pauldron(J, M, -1, kind === 'boss' ? 1.5 : 1.16);
      pauldron(J, M, 1, kind === 'boss' ? 1.5 : 1.16);
      chestPlate(J, M, kind === 'boss' ? 1.26 : 1.08);
      skirt(J, M, 0.118, 0.190, -0.020, 0.340, 10, M.cloth, false);
      // 面甲：眼部一条暗缝 + 红点
      var visor = new T.Mesh(new T.CylinderGeometry(0.126, 0.132, 0.062, 16, 1, true, Math.PI * 0.88, Math.PI * 0.24), M.armor);
      visor.position.set(0, 0.148, -0.006);
      visor.rotation.y = Math.PI;
      J.head.add(visor);
      var slit = new T.Mesh(new T.BoxGeometry(0.130, 0.012, 0.010), M.accent);
      slit.position.set(0, 0.146, -0.108);
      J.head.add(slit);
      // 头盔尖
      var spike = new T.Mesh(new T.ConeGeometry(0.030, 0.120, 8), M.armor);
      spike.position.set(0, 0.250, 0.010);
      J.head.add(spike);
      if (kind === 'shooter') weaponRifle(J, M, true);
      else weaponBlade(J, M, kind === 'boss' ? 1.34 : (kind === 'elite' ? 1.10 : 0.86));
      if (kind === 'boss') {
        cape(J, M, 0.62, 1.10, M.cloth);
        // 肩刺
        [-1, 1].forEach(function (s) {
          var sp = new T.Mesh(new T.ConeGeometry(0.030, 0.180, 8), M.steel);
          sp.position.set(0.120 * s, 0.070, 0);
          sp.rotation.z = -0.5 * s;
          J['shoulder' + (s < 0 ? 'L' : 'R')].add(sp);
        });
      }
    }
  }

  /* ============================================================
     六、动作：步态用相位算、动作走关键帧，两者叠加成连续帧
     ============================================================ */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t * t * (3 - 2 * t); }

  /* 关键帧曲线：pts = [[t,v],...]，段内缓动 */
  function kf(p, pts) {
    if (p <= pts[0][0]) return pts[0][1];
    var n = pts.length;
    if (p >= pts[n - 1][0]) return pts[n - 1][1];
    for (var i = 0; i < n - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      if (p >= a[0] && p <= b[0]) {
        var u = (p - a[0]) / Math.max(0.0001, b[0] - a[0]);
        return lerp(a[1], b[1], ease(u));
      }
    }
    return pts[n - 1][1];
  }

  function swing(root, kind, dur) {
    var rig = root.userData.rig;
    if (!rig) return;
    rig.swing = { t: 0, dur: dur || 0.46, kind: kind || 'slash' };
  }
  function cast(root, dur) {
    var rig = root.userData.rig;
    if (!rig) return;
    rig.cast = { t: 0, dur: dur || 0.62 };
  }

  function update(root, dt, st) {
    var rig = root.userData.rig;
    if (!rig) return;
    var J = rig.J, M = rig.M, p = M.pal;
    st = st || {};
    dt = Math.min(dt || 0.016, 0.05);
    rig.t += dt;

    var k = 1 - Math.exp(-dt * 10);
    function tw(name, target) { rig.w[name] = lerp(rig.w[name], target, k); }

    var speed = st.speed || 0;
    tw('walk', speed > 0.25 ? Math.min(1, speed / 5.4) : 0);
    tw('aim', st.aim === undefined ? (rig.baseAim || 0) : (st.aim ? 1 : 0));
    tw('air', st.onGround === false ? 1 : 0);
    tw('hit', st.hitT > 0 ? Math.min(1, st.hitT) : 0);
    tw('dead', st.dead ? 1 : 0);
    tw('cast', rig.cast ? 1 : 0);

    var w = rig.w;
    // 步频跟着速度走：慢走 3.0 rad/s，疾跑 8.5
    if (w.walk > 0.02) rig.phase += dt * (2.8 + speed * 1.25);
    var ph = rig.phase;
    var s = Math.sin(ph), c = Math.cos(ph);
    var amp = 0.26 + 0.34 * Math.min(1.2, speed / 6.4);

    /* ---------- 复位所有关节 ---------- */
    J.pelvis.position.y = 0.930;
    J.pelvis.rotation.set(0, 0, 0);
    J.spine.rotation.set(0, 0, 0);
    J.chest.rotation.set(0, 0, 0);
    J.neck.rotation.set(0, 0, 0);
    J.head.rotation.set(0, 0, 0);
    ['L', 'R'].forEach(function (sd) {
      J['shoulder' + sd].rotation.set(0, 0, 0);
      J['elbow' + sd].rotation.set(0, 0, 0);
      J['wrist' + sd].rotation.set(0, 0, 0);
      J['hip' + sd].rotation.set(0, 0, 0);
      J['knee' + sd].rotation.set(0, 0, 0);
      J['ankle' + sd].rotation.set(0, 0, 0);
    });

    /* ---------- 静息：呼吸、微垂肩 ---------- */
    var breathe = Math.sin(rig.t * 1.5);
    J.chest.rotation.x = -0.018 + breathe * 0.010;
    J.chest.position.y = 0.235 + breathe * 0.004;
    J.neck.rotation.x = 0.012 - breathe * 0.006;
    J.head.rotation.x = -0.010;
    J.shoulderL.rotation.z = 0.075;
    J.shoulderR.rotation.z = -0.075;
    J.shoulderL.rotation.x = 0.030;
    J.shoulderR.rotation.x = 0.030;
    J.elbowL.rotation.x = 0.150;
    J.elbowR.rotation.x = 0.150;
    J.hipL.rotation.z = 0.020;
    J.hipR.rotation.z = -0.020;

    /* ---------- 步态 ---------- */
    if (w.walk > 0.01) {
      var a = amp * w.walk;
      J.hipL.rotation.x = s * a;
      J.hipR.rotation.x = -s * a;
      J.kneeL.rotation.x = -0.10 - Math.max(0, -s) * a * 1.7;
      J.kneeR.rotation.x = -0.10 - Math.max(0, s) * a * 1.7;
      J.ankleL.rotation.x = 0.10 + s * 0.18 * w.walk;
      J.ankleR.rotation.x = 0.10 - s * 0.18 * w.walk;
      J.shoulderL.rotation.x = 0.030 - s * a * 0.70;
      J.shoulderR.rotation.x = 0.030 + s * a * 0.70;
      J.elbowL.rotation.x = 0.150 + Math.max(0, s) * 0.30 * w.walk;
      J.elbowR.rotation.x = 0.150 + Math.max(0, -s) * 0.30 * w.walk;
      J.chest.rotation.y = s * 0.12 * w.walk;
      J.pelvis.rotation.y = -s * 0.07 * w.walk;
      J.head.rotation.y = -s * 0.10 * w.walk;
      J.pelvis.position.y = 0.930 + Math.abs(c) * 0.020 * w.walk;
      J.chest.rotation.x += 0.045 * w.walk;
      if (J.cape) J.cape.rotation.x = 0.06 + 0.22 * w.walk + Math.sin(ph) * 0.03;
      if (J.tail) J.tail.rotation.x = -0.34 + 0.16 * w.walk + Math.sin(ph + 0.8) * 0.06;
    } else if (J.cape) {
      J.cape.rotation.x = 0.06 + Math.sin(rig.t * 1.2) * 0.012;
      if (J.tail) J.tail.rotation.x = -0.34 + Math.sin(rig.t * 1.1) * 0.03;
    }

    /* ---------- 腾空 ---------- */
    if (w.air > 0.01) {
      var a2 = w.air;
      J.hipL.rotation.x += 0.62 * a2;
      J.hipR.rotation.x += 0.34 * a2;
      J.kneeL.rotation.x += -1.05 * a2;
      J.kneeR.rotation.x += -0.62 * a2;
      J.ankleL.rotation.x += -0.18 * a2;
      J.shoulderL.rotation.x += -0.55 * a2;
      J.shoulderR.rotation.x += -0.35 * a2;
      J.chest.rotation.x += -0.10 * a2;
    }

    /* ---------- 持枪瞄准（枪手常驻） ---------- */
    if (w.aim > 0.01) {
      var am = w.aim;
      J.shoulderR.rotation.x = lerp(J.shoulderR.rotation.x, 1.32, am);
      J.elbowR.rotation.x = lerp(J.elbowR.rotation.x, 0.34, am);
      J.shoulderL.rotation.x = lerp(J.shoulderL.rotation.x, 0.92, am * 0.6);
      J.elbowL.rotation.x = lerp(J.elbowL.rotation.x, 0.62, am * 0.6);
      J.chest.rotation.y = lerp(J.chest.rotation.y, -0.14, am);
    }

    /* ---------- 攻击 ---------- */
    if (rig.swing) {
      var sw = rig.swing;
      sw.t += dt;
      var q = Math.min(1, sw.t / sw.dur);
      var kind = sw.kind;
      if (kind === 'shoot') {
        var kick = kf(q, [[0, 0], [0.06, 1], [0.24, 0.35], [1, 0]]);
        J.shoulderR.rotation.x += 0.10 * kick;
        J.elbowR.rotation.x -= 0.16 * kick;
        J.chest.rotation.x -= 0.09 * kick;
        J.head.rotation.x -= 0.05 * kick;
      } else if (kind === 'cast') {
        var up = kf(q, [[0, 0], [0.30, 1], [0.62, 1], [1, 0.15]]);
        J.shoulderR.rotation.x += 2.05 * up;
        J.elbowR.rotation.x += 0.55 * up;
        J.shoulderL.rotation.x += 2.25 * up;
        J.elbowL.rotation.x += 0.70 * up;
        J.chest.rotation.x += 0.14 * up;
        J.head.rotation.x += -0.22 * up;
        if (J.orb) J.orb.scale.setScalar(1 + 0.8 * up);
      } else {
        // 近战：抬刀 → 劈下 → 收势，躯干与胯一起转，重量才够
        var raise = kf(q, [[0, 0], [0.30, 1], [0.46, 0.62], [0.62, 0.20], [1, 0]]);
        var slash = kf(q, [[0, 0], [0.30, 0], [0.44, 1], [0.62, 0.55], [1, 0.05]]);
        J.shoulderR.rotation.x += 2.45 * raise - 1.35 * slash;
        J.elbowR.rotation.x += 0.80 * raise - 0.55 * slash;
        J.shoulderR.rotation.z -= 0.45 * slash;
        J.chest.rotation.y += -0.40 * raise + 0.62 * slash;
        J.pelvis.rotation.y += -0.18 * raise + 0.28 * slash;
        J.head.rotation.y += -0.22 * raise + 0.26 * slash;
        J.hipL.rotation.x += 0.10 * slash;
        J.hipR.rotation.x -= 0.16 * slash;
        J.chest.rotation.x += 0.10 * raise - 0.16 * slash;
      }
      if (sw.t >= sw.dur) rig.swing = null;
    }

    /* ---------- 施法（独立于攻击的持续姿态） ---------- */
    if (rig.cast && !rig.swing) {
      rig.cast.t += dt;
      var cq = Math.min(1, rig.cast.t / rig.cast.dur);
      var cw = Math.sin(Math.min(1, cq) * Math.PI) * 0.9 + 0.1;
      J.shoulderR.rotation.x += 1.55 * cw;
      J.elbowR.rotation.x += 0.45 * cw;
      J.shoulderL.rotation.x += 1.30 * cw;
      J.chest.rotation.x -= 0.10 * cw;
      J.head.rotation.x -= 0.16 * cw;
      if (J.orb) J.orb.scale.setScalar(1 + 0.9 * cw);
      if (rig.cast.t >= rig.cast.dur) {
        rig.cast = null;
        if (J.orb) J.orb.scale.setScalar(1);
      }
    }

    /* ---------- 受击 ---------- */
    if (w.hit > 0.01) {
      var hh = w.hit;
      J.chest.rotation.x += -0.26 * hh;
      J.neck.rotation.x += -0.16 * hh;
      J.head.rotation.x += -0.14 * hh;
      J.pelvis.rotation.x += -0.10 * hh;
      J.shoulderL.rotation.x += -0.30 * hh;
      J.shoulderR.rotation.x += -0.24 * hh;
      J.kneeL.rotation.x += -0.20 * hh;
      J.pelvis.position.y = 0.930 - 0.020 * hh;
    }

    /* ---------- 倒地 ---------- */
    if (w.dead > 0.01) {
      var dd = w.dead;
      J.pelvis.rotation.x = lerp(J.pelvis.rotation.x, 1.42, dd);
      J.pelvis.position.y = lerp(J.pelvis.position.y, 0.560, dd);
      J.chest.rotation.x = lerp(J.chest.rotation.x, 0.10, dd);
      J.head.rotation.x = lerp(J.head.rotation.x, -0.30, dd);
      J.shoulderL.rotation.x = lerp(J.shoulderL.rotation.x, -0.65, dd);
      J.shoulderR.rotation.x = lerp(J.shoulderR.rotation.x, -0.55, dd);
      J.kneeL.rotation.x = lerp(J.kneeL.rotation.x, -0.55, dd);
      J.kneeR.rotation.x = lerp(J.kneeR.rotation.x, -0.35, dd);
    }
  }

  /* 状态外挂：让 game.js 能在任意模型上驱动动画 */
  function drive(mesh, dt, st) {
    if (!mesh) return;
    if (mesh.userData && mesh.userData.rig) { update(mesh, dt, st); return; }
    var m = mesh.userData && mesh.userData.hero3dTarget;
    if (m && m.userData && m.userData.rig) update(m, dt, st);
  }

  window.Hero3D = {
    build: build,
    matSet: matSet,
    PAL: PAL,
    bones: BONE,
    update: update,
    drive: drive,
    swing: swing,
    cast: cast,
    tex: tex
  };
})();
