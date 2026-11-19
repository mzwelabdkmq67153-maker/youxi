/* ============================================================
   paint.js — 把白露的三人形立绘贴到 3D 模型上
   ------------------------------------------------------------
   做法：从立绘里按部位裁一块“画法样本”（甲面 / 衣褶 / 肤面），
   把它做成可无缝平铺的贴图，再按各部位的主色重新着色，
   于是模型带上了立绘的笔触、明暗和褶皱，而不丢调色板身份。
   甲 / 衣 / 肤 三个槽吃贴图；点缀槽（发光）保持纯色，不贴图。
   对外暴露 window.ArenaPaint，并在本文件加载时接管
   ArenaArt.buildHero / buildFighter，游戏侧不用改一行代码。
   ============================================================ */
(function () {
  if (!window.THREE || !window.ArenaArt) return;

  /* ---------- 1. 立绘源与部位裁切（归一化坐标） ---------- */
  var SRC = {
    swordsman: 'art/立绘_剑客_人形.png',
    gunner: 'art/立绘_枪手_人形.png',
    warlock: 'art/立绘_术士_人形.png'
  };

  // 每个部位取立绘上最有“画法信息”的一块：胸甲受光面 / 袍褶暗部 / 面部
  var CROP = {
    armor: { x: 0.400, y: 0.300, w: 0.200, h: 0.130 },
    cloth: { x: 0.300, y: 0.605, w: 0.290, h: 0.250 },
    skin: { x: 0.428, y: 0.128, w: 0.105, h: 0.072 }
  };

  var TILE = 128;          // 平铺块边长
  var SAMPLE = 40;         // 样本先降到这么小再放大：只留低频明暗，去掉铆钉级噪点
  var OUT = 256;           // 平铺后的贴图边长

  var texCache = {};       // key: kit|slot -> THREE.Texture
  var groups = [];         // 已构建过、等待贴图的模型
  var images = {};         // kit -> HTMLImageElement（已解码）
  var pending = 0;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 2. 无缝平铺 + 按主色重新着色 ---------- */
  function makeTile(img, crop, baseColor) {
    var c = document.createElement('canvas');
    c.width = OUT; c.height = OUT;
    var g = c.getContext('2d');

    var sx = Math.round(crop.x * img.naturalWidth);
    var sy = Math.round(crop.y * img.naturalHeight);
    var sw = Math.round(crop.w * img.naturalWidth);
    var sh = Math.round(crop.h * img.naturalHeight);

    // 先降采样成低频样本，再镜像拼成一个可无缝平铺的贴图
    var tmp = document.createElement('canvas');
    tmp.width = tmp.height = SAMPLE;
    tmp.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, SAMPLE, SAMPLE);
    img = tmp;
    sx = 0; sy = 0; sw = SAMPLE; sh = SAMPLE;

    g.drawImage(img, sx, sy, sw, sh, 0, 0, TILE, TILE);
    g.save(); g.translate(OUT, 0); g.scale(-1, 1);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, TILE, TILE); g.restore();
    g.save(); g.translate(0, OUT); g.scale(1, -1);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, TILE, TILE); g.restore();
    g.save(); g.translate(OUT, OUT); g.scale(-1, -1);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, TILE, TILE); g.restore();

    // 采样 -> 只保留“相对明暗”，再把主色乘回去
    var data = g.getImageData(0, 0, OUT, OUT).data;
    var base = new THREE.Color(baseColor);
    var br = base.r * 255, bg = base.g * 255, bb = base.b * 255;

    var sum = 0, n = 0;
    for (var i = 0; i < data.length; i += 4) {
      var l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l; n++;
    }
    var mean = Math.max(1, sum / n);

    for (var j = 0; j < data.length; j += 4) {
      var r = data[j], gg = data[j + 1], b = data[j + 2];
      var mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      // 纸底（接近纯亮灰）不参与造型，直接给主色
      var isPaper = mx > 188 && (mx - mn) < 26;
      var k = 1;
      if (!isPaper) {
        var lum = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        k = clamp(lum / mean, 0.72, 1.34);
      }
      data[j] = clamp(br * k, 0, 255);
      data[j + 1] = clamp(bg * k, 0, 255);
      data[j + 2] = clamp(bb * k, 0, 255);
      data[j + 3] = 255;
    }
    g.putImageData(new ImageData(data, OUT, OUT), 0, 0);

    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;   // 盒子面 UV 是 0..1，一张即一块
    tex.anisotropy = 4;
    tex.userData = { shared: true, kind: 'paint' };
    return tex;
  }

  function paletteOf(kit) {
    if (window.ArenaArt.HEROES && window.ArenaArt.HEROES[kit]) return window.ArenaArt.HEROES[kit];
    var K = window.ArenaArt.KITS && window.ArenaArt.KITS[kit];
    return K || { armor: 0x8a97a4, cloth: 0x22303a, skin: 0xd6b196, accent: 0x7fd8ff };
  }

  /* 敌方（grunt / shooter / elite / boss）没有自己的立绘，
     用剑客那张的甲面与衣褶当笔触源，只换主色，保留朱红敌我语言 */
  function sourceOf(kit) {
    if (kit === 'gunner' || kit === 'warlock' || kit === 'swordsman') return kit;
    return 'swordsman';
  }

  function texFor(kit, slot) {
    var key = kit + '|' + slot;
    if (texCache[key]) return texCache[key];
    var src = images[sourceOf(kit)];
    if (!src) return null;
    var PAL = paletteOf(kit);
    var base = PAL[slot];
    if (base === undefined) base = slot === 'skin' ? 0xd6b196 : 0x8a97a4;
    var t = makeTile(src, CROP[slot], base);
    texCache[key] = t;
    return t;
  }

  /* ---------- 3. 把贴图挂到部位网格上 ---------- */
  function applyGroup(grp, kit) {
    if (!grp || !grp.traverse) return;
    grp.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var part = o.userData && o.userData.part;
      if (!part || part === 'accent' || part === 'shadow') return;   // 发光槽与影子不贴图
      if (part !== 'armor' && part !== 'cloth' && part !== 'skin') return;
      var tex = texFor(kit, part);
      if (!tex) return;
      var mat = o.material;
      if (mat.userData && mat.userData.painted) return;
      mat.map = tex;
      mat.color.setHex(0xffffff);          // 色相已经烘进贴图，避免二次相乘变闷
      mat.needsUpdate = true;
      if (!mat.userData) mat.userData = {};
      mat.userData.painted = true;
      mat.userData.shared = false;
    });
    if (groups.indexOf(grp) < 0) groups.push(grp);
  }

  function repaintAll() {
    for (var i = groups.length - 1; i >= 0; i--) {
      var g = groups[i];
      if (!g) { groups.splice(i, 1); continue; }
      applyGroup(g, g.userData && g.userData.paintKit);
    }
  }

  /* ---------- 4. 接管 art.js 的构建入口 ---------- */
  var origHero = window.ArenaArt.buildHero;
  var origFighter = window.ArenaArt.buildFighter;

  function wrap(fn, kitOf) {
    return function (type) {
      var grp = fn.call(window.ArenaArt, type);
      var kit = kitOf(type);
      if (grp && grp.userData) grp.userData.paintKit = kit;
      applyGroup(grp, kit);
      return grp;
    };
  }

  window.ArenaArt.buildHero = wrap(origHero, function (t) { return t; });
  window.ArenaArt.buildFighter = wrap(origFighter, function (t) { return t in (window.ArenaArt.KITS || {}) ? t : 'grunt'; });
  if (window.ArenaArt.buildFighterLegacy) window.ArenaArt.buildFighterLegacy = wrap(window.ArenaArt.buildFighterLegacy, function (t) { return t; });
  if (window.ArenaArt.buildHeroV2) window.ArenaArt.buildHeroV2 = wrap(window.ArenaArt.buildHeroV2, function (t) { return t; });

  /* ---------- 5. 载入立绘，就绪后补刷已有模型 ---------- */
  Object.keys(SRC).forEach(function (k) {
    pending++;
    var img = new Image();
    img.onload = function () {
      images[k] = img;
      pending--;
      if (pending <= 0) repaintAll();
    };
    img.onerror = function () { pending--; };
    img.src = SRC[k];
  });

  window.ArenaPaint = {
    apply: applyGroup,
    repaintAll: repaintAll,
    ready: function () { return pending <= 0; },
    texture: texFor,
    CROP: CROP,
    SRC: SRC
  };
})();
