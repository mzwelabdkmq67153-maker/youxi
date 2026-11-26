/* 第七竞技场 · 场景模型档（scene_glb.js）
   把 Tripo 生成的两个场景 GLB（副本 石砌回廊 / 竞技场 圆形擂台）接进实时场景，
   对外保持与 scene.js 相同的 build / update / tuneLights 契约，game.js 只换引用即可。

   口径：
   - 竞技场：台面按「外接 ±22 玩法方场」定标（台面半径 31.2m），台面顶面抬到 y=0，
     台身整个沉到地面以下，玩家始终站在台面上；
   - 副本：按最长边 44m 定标，墙面对齐 ±22 的玩法边界，地面落在 y=0；
   - 加载失败或 ?stage=proc 时退回 scene.js 的程序化场景；
   - 模型本体不投阴影（20 万面进 shadow map 不划算），只接收阴影。 */
(function () {
  'use strict';

  var q = new URLSearchParams(location.search);
  var FORCE_PROC = q.get('stage') === 'proc';

  var CFG = {
    arena: {
      file: 'art/模型/场景/arena_scene_lod.glb',
      mode: 'disc',
      /* 模型自带的圆台：半径 6.0、台面高 6.2（离线量体测出，单位=模型单位） */
      deckR: 6.0,
      deckZ: 6.2,
      /* 玩法占地是 ±22 的方场，方场对角 30.3m；圆台半径取 31.2 让四角都落在台面上，
         否则玩家走到角上会“跨出”台沿 */
      targetRadius: 24,
      /* 台面十字沟压在出生轴线上，靠打光压住亮度即可（不做整体旋转：
         模型不是中心对称，转 45° 会把圆台从居中位置挪开） */
      spin: 0,
      fog: [0x8fa6b6, 120, 320],
      bg: 0x7d95a8,
      glow: 0xb8e2ff,
      glowI: 0.3,
      glowD: 46,
      envI: 1.0,
      exposure: 0.85,
      lift: 0.15
    },
    dungeon: {
      file: 'art/模型/场景/fuben_scene_lod.glb',
      mode: 'rect',
      /* 模型自带的地面在 1.0 高（下方 1 单位是台基），以地面为准对齐 y=0 */
      floorZ: 1.0,
      targetSpan: 44,
      fog: [0x1b2a33, 55, 150],
      bg: 0x0d1720,
      glow: 0x66d8ff,
      glowI: 1.25,
      glowD: 30,
      envI: 1.6,
      exposure: 1.15,
      lift: 0.26
    },

    /* ---------- 三个主要世界：同资产换气质（新手村=石村暖光 / 主城=白日广场 / 神之巅=云海金白） ---------- */
    village: {
      file: 'art/模型/场景/fuben_scene_lod.glb',
      src: 'dungeon',        // 复用副本几何：石砌回廊当村道
      mode: 'rect',
      floorZ: 1.0,
      targetSpan: 44,
      fog: [0xe3d3b6, 30, 120],
      bg: 0xbcb6a4,
      sky: [0x8ea6b8, 0xe8d9be],
      glow: 0xffdca0,
      glowI: 0.85,
      glowD: 34,
      envI: 1.20,
      exposure: 0.92,
      lift: 0.10,
      groundDark: false,
      glowY: 2.2,
      lights: {
        hemiSky: 0xdde6da, hemiGround: 0x6a6152, hemi: 1.00,
        keyColor: 0xfff0d2, key: 1.00,
        fillColor: 0x9dbcdc, fill: 0.38
      }
    },
    city: {
      file: 'art/模型/场景/arena_scene_lod.glb',
      src: 'arena',
      mode: 'disc',
      deckR: 6.0,
      deckZ: 6.2,
      targetRadius: 24,
      spin: 0,
      fog: [0xa9c2d4, 42, 160],
      bg: 0x8fa7ba,
      sky: [0x6f9dc4, 0xdbe8f1],
      glow: 0xd8f0ff,
      glowI: 0.45,
      glowD: 50,
      envI: 0.85,
      exposure: 0.70,
      lift: 0.08,
      groundDark: false,
      glowY: 1.6,
      lights: {
        hemiSky: 0xd6e6f2, hemiGround: 0x7a736a, hemi: 0.72,
        keyColor: 0xfff4e2, key: 0.82,
        fillColor: 0xd3dde4, fill: 0.42
      }
    },
    peak: {
      file: 'art/模型/场景/arena_scene_lod.glb',
      src: 'arena',
      mode: 'disc',
      deckR: 6.0,
      deckZ: 6.2,
      targetRadius: 24,
      spin: 0,
      /* 云海：远景白得发亮、雾贴着台面压过来，纯粹靠光和天空撑“高处” */
      fog: [0xffe8bc, 44, 165],
      bg: 0xd6e4f2,
      sky: [0xa7b3d6, 0xfff3d2],
      glow: 0xffe39a,
      glowI: 2.2,
      glowD: 44,
      envI: 1.25,
      exposure: 0.92,
      lift: 0.14,
      groundDark: false,
      glowY: 1.8,
      clouds: true,
    /* 神之巅的补地只铺到台沿外一点，台外直接是云海，看起来像浮在云上的高台 */
    groundR: 31,
      lights: {
        hemiSky: 0xfff0d2, hemiGround: 0xd0a860, hemi: 1.00,
        keyColor: 0xffd48a, key: 1.10,
        fillColor: 0xffb060, fill: 1.00
      }
    },

    /* ---------- 六段世界里后三段的专属配置（同一批 GLB 上加专属地貌道具层） ---------- */
    wild: {
      file: 'art/模型/场景/arena_scene_lod.glb',
      src: 'arena',
      mode: 'disc',
      deckR: 6.0,
      deckZ: 6.2,
      targetRadius: 24,
      spin: 0,
      props: 'wild',
      /* 边境野外：黄昏斜光 + 沙尘雾，天色压成土黄，和主城的正午冷白拉开 */
      fog: [0xc9a06a, 40, 155],
      bg: 0xbfa07a,
      sky: [0x8f6f48, 0xf2d8a8],
      glow: 0xffb066,
      glowI: 0.9,
      glowD: 42,
      envI: 1.10,
      exposure: 0.86,
      lift: 0.12,
      groundDark: false,
      glowY: 1.6,
      lights: {
        hemiSky: 0xf0d6ac, hemiGround: 0x6a5238, hemi: 0.95,
        keyColor: 0xffd08a, key: 1.05,
        fillColor: 0x8fa8c8, fill: 0.30
      }
    },
    cliff: {
      file: 'art/模型/场景/arena_scene_lod.glb',
      src: 'arena',
      mode: 'disc',
      deckR: 6.0,
      deckZ: 6.2,
      targetRadius: 24,
      spin: 0,
      props: 'cliff',
      /* 断崖战场：冷灰蓝、强反差，远景雾压低让崖口显得高 */
      fog: [0xb8c6d2, 45, 170],
      bg: 0xa9bccb,
      sky: [0x5c7794, 0xd6e2ec],
      glow: 0x9fd8ff,
      glowI: 0.7,
      glowD: 46,
      envI: 1.15,
      exposure: 0.88,
      lift: 0.10,
      groundDark: false,
      glowY: 1.7,
      lights: {
        hemiSky: 0xdbe8f2, hemiGround: 0x59646e, hemi: 1.05,
        keyColor: 0xf2f8ff, key: 1.15,
        fillColor: 0x9fc0da, fill: 0.50
      }
    },
    throne: {
      file: 'art/模型/场景/fuben_scene_lod.glb',
      src: 'dungeon',
      mode: 'rect',
      floorZ: 1.0,
      targetSpan: 44,
      props: 'throne',
      /* 王座回廊：黑石 + 幽金，雾更近更暗，把注意力收到王座上 */
      fog: [0x2a1f16, 40, 130],
      bg: 0x181008,
      sky: [0x2a1a10, 0x6b4a22],
      glow: 0xffcf6b,
      glowI: 1.5,
      glowD: 32,
      envI: 1.35,
      exposure: 1.00,
      lift: 0.22,
      groundDark: false,
      glowY: 1.9,
      lights: {
        hemiSky: 0xffdca8, hemiGround: 0x3a2818, hemi: 0.85,
        keyColor: 0xffc978, key: 1.00,
        fillColor: 0xff9a4a, fill: 0.60
      }
    }
  };

  /* ---------- Tripo 版场景档（?set=tripo） ----------
     七份由 Tripo 重建、Blender 减面的 LOD（tripo_*_lod.glb，15–24 万面）。
     尺寸按 Blender 量体结果定标：Tripo 输出最大边归一化到 1，圆台直径 0.979、
     宫体 0.965×0.985、台面顶 0.153 / 地面 0.004（模型单位）。
     缺省档（无参数）仍是原来的双资产 + 换气质做法。 */
  if (q.get('set') === 'tripo') {
    /* tripo 档自带一套美术参数：天色 / 雾 / 曝光 / 灯光色温，配合 PAINT 的白模调色。
       默认档不受影响，两档可以并排对比。 */
    var TRIPO_SET = {
      arena: {
        f: 'tripo_arena_detail_lod.glb', autoFit: 48, autoGround: 'top', groundColor: 0x4c5763,
        sky: [0x25343f, 0x6d8ba1], bg: 0x2b3a46, fog: [0x2b3a46, 90, 260], exposure: 1.00,
        lights: { hemiSky: 0xc9dcf0, hemiGround: 0x26313a, hemi: 0.95,
                  keyColor: 0xfff4e4, key: 1.20, fillColor: 0x4a7bd0, fill: 0.52 }
      },
      dungeon: {
        f: 'tripo_dungeon_detail_lod.glb', autoFit: 44, autoGround: 'bottom', groundColor: 0x1d2628,
        sky: [0x0c161a, 0x21363e], bg: 0x0f191d, fog: [0x14232a, 55, 150], exposure: 1.34,
        lights: { hemiSky: 0x9ec2cf, hemiGround: 0x223028, hemi: 1.15,
                  keyColor: 0xffdfae, key: 1.24, fillColor: 0x2a6f88, fill: 0.55 }
      },
      village: {
        f: 'tripo_wild_detail_lod.glb', autoFit: 44, autoGround: 'bottom', groundColor: 0x6f6248,
        sky: [0x7a5c38, 0xcfa06a], bg: 0x9d7d52, fog: [0xa98a5e, 70, 230], exposure: 1.08,
        lights: { hemiSky: 0xffe0b8, hemiGround: 0x3a3128, hemi: 0.92,
                  keyColor: 0xffd9a8, key: 1.10, fillColor: 0x7f96c8, fill: 0.40 }
      },
      city: {
        f: 'tripo_city_detail_lod.glb', autoFit: 44, autoGround: 'bottom', groundColor: 0x9c8464,
        sky: [0x8a6b42, 0xd9b884], bg: 0xb29068, fog: [0xc4a276, 80, 240], exposure: 1.08,
        lights: { hemiSky: 0xffdfae, hemiGround: 0x50432f, hemi: 1.10,
                  keyColor: 0xffe0a6, key: 1.20, fillColor: 0x5a8fc0, fill: 0.42 }
      },
      peak: {
        f: 'tripo_peak_detail_lod.glb', autoFit: 44, autoGround: 'bottom', groundColor: 0xb2c1ce,
        sky: [0x9db2c6, 0xeef3f6], bg: 0xccd9e2, fog: [0xdbe4ec, 70, 250], exposure: 0.94,
        lights: { hemiSky: 0xffefd0, hemiGround: 0x777570, hemi: 1.04,
                  keyColor: 0xfff2d4, key: 1.18, fillColor: 0x8fb4de, fill: 0.40 }
      },
      wild: {
        f: 'tripo_wild_detail_lod.glb', autoFit: 44, autoGround: 'bottom', groundColor: 0x6f6248,
        sky: [0x7a5c38, 0xcfa06a], bg: 0x9d7d52, fog: [0xa98a5e, 70, 230], exposure: 1.08,
        lights: { hemiSky: 0xffe0b8, hemiGround: 0x3a3128, hemi: 0.92,
                  keyColor: 0xffd9a8, key: 1.10, fillColor: 0x7f96c8, fill: 0.40 }
      },
      cliff: {
        f: 'tripo_cliff_detail_lod.glb', autoFit: 44, autoGround: 'bottom', groundColor: 0x394b5b,
        sky: [0x1a2a38, 0x5c7a92], bg: 0x354a5c, fog: [0x3d5468, 80, 240], exposure: 1.06,
        lights: { hemiSky: 0xb3cddf, hemiGround: 0x1e2a33, hemi: 0.88,
                  keyColor: 0xe6f2ff, key: 1.16, fillColor: 0x3d6fa8, fill: 0.52 }
      },
      throne: {
        f: 'tripo_throne_detail_lod.glb', autoFit: 44, autoGround: 'bottom', groundColor: 0x362a3e,
        sky: [0x2b1f3b, 0x8d6c5c], bg: 0x3c2b46, fog: [0x46324e, 80, 240], exposure: 1.06,
        lights: { hemiSky: 0xe2c78e, hemiGround: 0x241c2e, hemi: 1.00,
                  keyColor: 0xffcf8e, key: 1.22, fillColor: 0x7a5fd0, fill: 0.52 }
      }
    };
    for (var tk in TRIPO_SET) {
      if (!CFG[tk]) continue;
      var ts = TRIPO_SET[tk];
      CFG[tk].file = 'art/模型/场景/' + ts.f;
      CFG[tk].src = tk;
      CFG[tk].autoFit = ts.autoFit;
      CFG[tk].autoGround = ts.autoGround;
      if (ts.groundColor !== undefined) CFG[tk].groundColor = ts.groundColor;
      CFG[tk].paintOn = false;
      if (ts.sky) CFG[tk].sky = ts.sky;
      if (ts.bg !== undefined) CFG[tk].bg = ts.bg;
      if (ts.fog) CFG[tk].fog = ts.fog;
      if (ts.exposure) CFG[tk].exposure = ts.exposure;
      if (ts.lights) CFG[tk].lights = ts.lights;
    }
    console.log('[SceneGlb] tripo set on');
  }

  var group = null;
  var kind = null;
  var root = null;
  var fit = null;
  var ground = null;
  var glowLight = null;
  var pulses = [];
  var cache = {};
  var loading = {};
  var sceneRef = null;
  var obstaclesRef = null;
  var failed = {};
  var acc = 0;

  var _ray = new THREE.Raycaster();
  var _down = new THREE.Vector3(0, -1, 0);
  var _dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function log() {
    if (window.console && console.log) console.log.apply(console, ['[SceneGlb]'].concat([].slice.call(arguments)));
  }

  /* ---------- 量体 ---------- */
  function boxOf(obj) {
    obj.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(obj);
  }

  function hitY(obj, x, z, fromY) {
    _ray.set(new THREE.Vector3(x, fromY, z), _down);
    var hits = _ray.intersectObject(obj, true);
    return hits.length ? hits[0].point.y : null;
  }

  /* 量出「台面高度」和「台面半径」：中心下打射线取高度，再四向横推取同高的最远点 */
  function measure(obj) {
    var box = boxOf(obj);
    var fromY = box.max.y + 2;
    var y0 = hitY(obj, 0, 0, fromY);
    if (y0 === null) return null;
    var span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
    var best = 0;
    for (var d = 0; d < _dirs.length; d++) {
      var last = 0;
      for (var r = 0.5; r <= span; r += 0.25) {
        var y = hitY(obj, _dirs[d][0] * r, _dirs[d][1] * r, fromY);
        if (y === null || Math.abs(y - y0) > 0.06) break;
        last = r;
      }
      if (last > best) best = last;
    }
    return {
      topY: y0,
      radius: best || span,
      size: box.getSize(new THREE.Vector3())
    };
  }

  /* 圆台中心的定位：从上方打一片射线，取落在台面高度的那批点的重心。
     竞技场模型的圆台相对包围盒中心是偏的，按包围盒居中会让台面偏出去，
     一旦再转 45°（把发光十字沟移到对角）偏移会更明显，所以这里单独量台心。 */
  function deckCenterOf(obj, cfg) {
    var box = boxOf(obj);
    var fromY = box.max.y + 2;
    var cx = (box.min.x + box.max.x) / 2;
    var cz = (box.min.z + box.max.z) / 2;
    var lim = (cfg.deckR || 6) * 1.4;
    var sx = 0, sz = 0, n = 0;
    for (var i = -10; i <= 10; i++) {
      for (var j = -10; j <= 10; j++) {
        var x = cx + i * lim / 10;
        var z = cz + j * lim / 10;
        var h = hitY(obj, x, z, fromY);
        if (h === null || Math.abs(h - cfg.deckZ) > 0.35) continue;
        sx += x; sz += z; n++;
      }
    }
    if (!n) return { x: cx, z: cz, y: cfg.deckZ };
    return { x: sx / n, z: sz / n, y: cfg.deckZ };
  }

  function trisOf(obj) {    var n = 0;
    obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      var g = o.geometry;
      var c = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
      n += Math.floor(c / 3);
    });
    return n;
  }

  /* ---------- 场景配色（tripo 白模的色彩/材质补全） ----------
     白模 albedo 近白，靠世界高度把资产分成"台基／主体／顶部"三段着色：
     lo 低处（地砖、台基、崖脚）、mid 主体（墙体、崖壁）、hi 高处（台面、顶饰）。
     tint 是乘法系数（>1 可提亮，允许超过 1），acc 给自发光带氛围色。
     纯几何着色，不改 GLB、不加贴图，游戏与离线渲染吃同一份。 */
  var PAINT = {
    /* 以下色值按 sRGB 视觉写，paintMaterial 内统一转线性 */
    /* 竞技场：青钢台壁，台面冷白钢，青蓝环线自发 */
    arena:   { lo: [0.36, 0.44, 0.54], mid: [0.62, 0.70, 0.82], hi: [0.92, 0.94, 0.97],
               acc: [0.22, 0.86, 0.98], emi: 0.32, rough: 0.74, metal: 0.12 },
    /* 地宫：苔绿石墙，王座区暖金 */
    dungeon: { lo: [0.32, 0.36, 0.30], mid: [0.55, 0.60, 0.50], hi: [0.78, 0.80, 0.70],
               acc: [0.95, 0.62, 0.26], emi: 0.42, rough: 0.88, metal: 0.04 },
    /* 主城：灰白台面 + 暖砂台壁，内城青琉璃 */
    city:    { lo: [0.40, 0.32, 0.24], mid: [0.72, 0.58, 0.40], hi: [0.92, 0.88, 0.82],
               acc: [0.90, 0.55, 0.24], emi: 0.38, rough: 0.84, metal: 0.06 },
    /* 孤峰：雪白岩体，淡金轮廓 */
    peak:    { lo: [0.42, 0.48, 0.56], mid: [0.66, 0.72, 0.80], hi: [0.97, 0.97, 0.98],
               acc: [0.95, 0.80, 0.50], emi: 0.34, rough: 0.82, metal: 0.05 },
    /* 野外：土黄荒原，苔绿残件 */
    wild:    { lo: [0.40, 0.32, 0.22], mid: [0.62, 0.50, 0.34], hi: [0.86, 0.72, 0.50],
               acc: [0.46, 0.62, 0.30], emi: 0.36, rough: 0.90, metal: 0.03 },
    /* 断崖：冷蓝崖体，锈红标记 */
    cliff:   { lo: [0.28, 0.36, 0.46], mid: [0.48, 0.60, 0.74], hi: [0.88, 0.93, 1.00],
               acc: [0.85, 0.28, 0.20], emi: 0.34, rough: 0.86, metal: 0.04 },
    /* 神坛：紫曜台阶，幽金顶饰 */
    throne:  { lo: [0.36, 0.26, 0.44], mid: [0.56, 0.42, 0.64], hi: [0.90, 0.82, 0.52],
               acc: [0.80, 0.55, 0.95], emi: 0.46, rough: 0.70, metal: 0.16 }
  };

  function paintMaterial(mm, p) {
    if (!p || mm.userData._painted) return;
    mm.userData._painted = true;
    /* 本工程是 three r128，没有 ColorManagement：材质色/顶点色都按线性值参与着色，
       而 PAINT 表是按 sRGB 视觉写的，这里统一做 sRGB→线性，否则 0.9 看着还是白 */
    var toLin = function (a) {
      return new THREE.Color(Math.pow(a[0], 2.2), Math.pow(a[1], 2.2), Math.pow(a[2], 2.2));
    };
    var u = {
      uPaintLo: { value: toLin(p.lo) },
      uPaintMid: { value: toLin(p.mid) },
      uPaintHi: { value: toLin(p.hi) },
      uPaintLowY: { value: 0 },
      uPaintHighY: { value: 10 },
      uPaintMix: { value: parseFloat(q.get('pmix') || '1') }
    };
    mm.userData.paintU = u;
    mm.onBeforeCompile = function (sh) {
      sh.uniforms.uPaintLo = u.uPaintLo;
      sh.uniforms.uPaintMid = u.uPaintMid;
      sh.uniforms.uPaintHi = u.uPaintHi;
      sh.uniforms.uPaintLowY = u.uPaintLowY;
      sh.uniforms.uPaintHighY = u.uPaintHighY;
      sh.uniforms.uPaintMix = u.uPaintMix;
      sh.vertexShader = 'varying vec3 vPaintW;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vPaintW = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
      sh.fragmentShader = 'varying vec3 vPaintW;\n' +
        'uniform vec3 uPaintLo;\nuniform vec3 uPaintMid;\nuniform vec3 uPaintHi;\n' +
        'uniform float uPaintLowY;\nuniform float uPaintHighY;\nuniform float uPaintMix;\n' +
        sh.fragmentShader.replace(
          '#include <map_fragment>',
          '#include <map_fragment>\n  {\n' +
          '    float ph = clamp((vPaintW.y - uPaintLowY) / max(uPaintHighY - uPaintLowY, 0.001), 0.0, 1.0);\n' +
          '    vec3 pt = mix(uPaintLo, uPaintMid, smoothstep(0.18, 0.34, ph));\n' +
          '    pt = mix(pt, uPaintHi, smoothstep(0.62, 0.88, ph));\n' +
          '    /* 减面后的镂空内壁背光会掉到纯黑，抬一个地板色避免死黑 */\n' +
          '    diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.055));\n' +
          '    diffuseColor.rgb *= mix(vec3(1.0), pt, uPaintMix);\n' +
          '  }'
        );
    };
    mm.needsUpdate = true;
  }

  function setPaintRange(obj, low, high) {
    var h = Math.max(high - low, 0.5);
    obj.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      for (var i = 0; i < mats.length; i++) {
        var u = mats[i] && mats[i].userData && mats[i].userData.paintU;
        if (u) { u.uPaintLowY.value = low; u.uPaintHighY.value = low + h; }
      }
    });
  }

  function prepMaterials(obj, k) {
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = true;
      o.frustumCulled = false;
      var mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (var i = 0; i < mats.length; i++) {
        var mm = mats[i];
        if (!mm) continue;
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(function (slot) {
          if (mm[slot]) {
            mm[slot].anisotropy = 4;
            mm[slot].minFilter = THREE.LinearMipmapLinearFilter;
          }
        });
        mm.envMapIntensity = 0.85;
        /* Tripo 材质的金属度默认是 1，游戏里没有环境贴图时金属会全反射成黑；
           场景是石头/铁件，压到低金属度，靠漫反射出体积 */
        /* 配色：?paint=0 可关掉，回到原白模 */
        /* 带贴图细节的档不需要再乘色：贴图本身就是最终色，染色只会压掉它 */
        var painted = CFG[k] && CFG[k].paintOn === false;
        var pp = (q.get('paint') !== '0' && PAINT[k] && !painted) ? PAINT[k] : null;
        mm.metalness = pp ? pp.metal : 0.08;
        if (typeof mm.roughness === 'number') {
          mm.roughness = pp ? pp.rough : Math.max(mm.roughness, 0.72);
        }
        paintMaterial(mm, pp);
        /* Tripo 的 albedo 整体偏暗（尤其副本的冷色石头），纯靠打光会糊成一团；
           用 albedo 做微弱自发光把暗部细节提出来，同时保留贴图层次 */
        if (mm.map) {
          mm.emissiveMap = mm.map;
          mm.emissive = pp ? new THREE.Color(Math.pow(pp.acc[0], 2.2), Math.pow(pp.acc[1], 2.2), Math.pow(pp.acc[2], 2.2)) : new THREE.Color(0xffffff);
          mm.emissiveIntensity = pp ? (pp.emi * 0.62) : (painted ? 0.10 : (k === 'arena' ? 0.15 : 0.26));
          mm.userData._lift = true;
        }
        /* 单面材质从场内看会被背面剔除，场景一律双面 */
        mm.side = THREE.DoubleSide;
        mm.needsUpdate = true;
      }
    });
  }

  /* ---------- 环境光：Tripo 是 PBR 材质，没有环境贴图石头就渲染成一团黑 ---------- */
  var envCache = {};

  function envSceneOf(k) {
    var isD = k === 'dungeon';
    var s = new THREE.Scene();
    var geo = new THREE.SphereGeometry(55, 32, 20);
    var pos = geo.attributes.position;
    var top = new THREE.Color(isD ? 0x51677a : 0xe2eff9);
    var mid = new THREE.Color(isD ? 0x22303a : 0xa6b3ba);
    var bot = new THREE.Color(isD ? 0x070b0d : 0x5a5d58);
    var cols = [];
    var c = new THREE.Color();
    for (var i = 0; i < pos.count; i++) {
      var t = (pos.getY(i) / 55 + 1) * 0.5;
      if (t < 0.5) c.copy(bot).lerp(mid, t * 2); else c.copy(mid).lerp(top, (t - 0.5) * 2);
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    /* 头顶一团天光，给石面一点方向感 */
    var lit = new THREE.Color().setRGB(isD ? 1.5 : 2.8, isD ? 1.8 : 2.7, isD ? 2.3 : 2.5);
    var d = new THREE.Mesh(
      new THREE.CircleGeometry(isD ? 12 : 20, 24),
      new THREE.MeshBasicMaterial({ color: lit, side: THREE.DoubleSide })
    );
    d.position.set(0, 22, 0);
    d.rotation.x = -Math.PI / 2;
    s.add(d);
    return s;
  }

  function cubeFallback(k) {
    var isD = k === 'dungeon';
    var cTop = isD ? '#4a5f72' : '#dce9f3';
    var cBot = isD ? '#080c0e' : '#525550';
    var faces = [];
    for (var i = 0; i < 6; i++) {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      var g = cv.getContext('2d');
      var lg = g.createLinearGradient(0, 0, 0, 128);
      if (i === 2) { lg.addColorStop(0, cTop); lg.addColorStop(1, cTop); }
      else if (i === 3) { lg.addColorStop(0, cBot); lg.addColorStop(1, cBot); }
      else { lg.addColorStop(0, cTop); lg.addColorStop(1, cBot); }
      g.fillStyle = lg;
      g.fillRect(0, 0, 128, 128);
      faces.push(cv);
    }
    var tex = new THREE.CubeTexture(faces);
    tex.mapping = THREE.CubeReflectionMapping;
    tex.needsUpdate = true;
    return tex;
  }

  function envOf(k) {
    if (envCache[k]) return envCache[k].tex;
    var tex = null;
    var r = window.__renderer;
    if (r && THREE.PMREMGenerator) {
      try {
        var pm = new THREE.PMREMGenerator(r);
        var rt = pm.fromScene(envSceneOf(k), 0.06, 1, 120);
        tex = rt.texture;
        pm.dispose();
      } catch (e) {
        log('env pmrem failed', e && e.message);
        tex = null;
      }
    }
    if (!tex) tex = cubeFallback(k);
    envCache[k] = { tex: tex };
    return tex;
  }

  function applyEnv(obj, k) {
    var tex = envOf(k);
    if (!tex) return;
    var cfg = CFG[k] || CFG.arena;
    var ei = cfg.envI || 1.2;
    var n = 0;
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      var mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (var i = 0; i < mats.length; i++) {
        var mm = mats[i];
        if (!mm || !mm.isMeshStandardMaterial) continue;
        mm.envMap = tex;
        mm.envMapIntensity = ei;
        mm.needsUpdate = true;
        n++;
      }
    });
    log('env applied', k, n);
  }

  function collectPulses() {
    pulses.length = 0;
    if (!group) return;
    group.traverse(function (o) {
      if (!o.isMesh) return;
      var mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (var i = 0; i < mats.length; i++) {
        var mm = mats[i];
        if (mm && mm.emissive && mm.emissiveIntensity > 0.2 && !mm.userData._lift) {
          if (mm.userData._base === undefined) mm.userData._base = mm.emissiveIntensity;
          pulses.push(mm);
        }
      }
    });
  }

  /* ---------- 补地（方场角落不露空） ---------- */
  function makeGround(k, radius) {
    var c = document.createElement('canvas');
    c.width = c.height = 256;
    var g = c.getContext('2d');
    var dark = (CFG[k] && typeof CFG[k].groundDark === 'boolean') ? CFG[k].groundDark : (k === 'dungeon');
    var gc = (CFG[k] && typeof CFG[k].groundColor === 'number') ? CFG[k].groundColor : (dark ? 0x2a3338 : 0x7b858a);
    var gcHex = '#' + ('000000' + gc.toString(16)).slice(-6);
    g.fillStyle = gcHex;
    g.fillRect(0, 0, 256, 256);
    g.globalAlpha = 0.10;
    for (var i = 0; i < 70; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : '#000000';
      g.fillRect(Math.random() * 256, Math.random() * 256, 18 + Math.random() * 34, 5 + Math.random() * 12);
    }
    g.globalAlpha = 1;
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(radius / 3, radius / 3);
    var mesh = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.MeshStandardMaterial({
        map: tex,
        color: gc,
        roughness: 0.95,
        metalness: 0.05
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.08;
    mesh.receiveShadow = true;
    mesh.userData.tag = 'scene_ground';
    return mesh;
  }

  /* ---------- 灯光按场景分气质 ----------
     世界各自带 lights 参数（新手村暖光 / 主城白日 / 神之巅金白），没配的沿用旧二元逻辑 */
  function tuneLights(scene) {
    var cfg = CFG[kind] || CFG.arena;
    var L = cfg.lights;
    var isD = kind === 'dungeon';
    var sc = scene || sceneRef;
    if (!sc) return;
    /* GLB 是 PBR 材质、贴图本身偏暗，曝光按场景单独抬一档（程序化场景仍用 0.80） */
    if (window.__renderer && CFG[kind]) {
      window.__renderer.toneMappingExposure = cfg.exposure || 0.8;
    }
    var dirs = 0;
    sc.traverse(function (o) {
      if (o.isHemisphereLight) {
        if (L) {
          o.color.setHex(L.hemiSky);
          o.groundColor.setHex(L.hemiGround);
          o.intensity = L.hemi;
        } else {
          o.color.setHex(isD ? 0x7fb0cc : 0xd6e6f2);
          o.groundColor.setHex(isD ? 0x1b2a33 : 0x7a736a);
          o.intensity = isD ? 1.35 : 1.05;
        }
      }
      if (o.isDirectionalLight) {
        if (L) {
          if (dirs === 0) {
            o.color.setHex(L.keyColor);
            o.intensity = L.key;
          } else {
            o.color.setHex(L.fillColor);
            o.intensity = L.fill;
          }
        } else if (dirs === 0) {
          o.color.setHex(isD ? 0xbfe2f4 : 0xfff4e2);
          o.intensity = isD ? 1.2 : 1.15;
        } else {
          o.color.setHex(isD ? 0x4a8ce0 : 0xd3dde4);
          o.intensity = isD ? 0.55 : 0.5;
        }
        dirs++;
      }
    });
  }

  /* ---------- 载入 ----------
     世界可以复用同一份资产（CFG[k].src 指到实际模型），缓存与量体都按 src 键走，
     新手村和旧副本、主城和神之巅各自只下载一次模型。 */
  function load(k, cb) {
    var sk = (CFG[k] && CFG[k].src) || k;
    if (cache[sk]) { cb(null, cache[sk]); return; }
    if (loading[sk]) { loading[sk].push(cb); return; }
    loading[sk] = [cb];
    var cfg = CFG[sk];
    var loader = new THREE.GLTFLoader();
    log('load start', cfg.file);

    loader.load(cfg.file, function (gltf) {
      var obj = gltf.scene;
      var box0 = boxOf(obj);
      var size0 = box0.getSize(new THREE.Vector3());
      var scale = cfg.autoFit
        ? cfg.autoFit / Math.max(size0.x, size0.z)
        : (cfg.fixedScale || (cfg.mode === 'disc'
          ? cfg.targetRadius / cfg.deckR
          : cfg.targetSpan / Math.max(size0.x, size0.z)));
      obj.scale.multiplyScalar(scale);
      obj.updateMatrixWorld(true);
      var box = boxOf(obj);
      var c = box.getCenter(new THREE.Vector3());
      /* 以模型自带的“台面/地面”为准落到 y=0：
         disc（竞技场）用圆台面，rect（副本）用室内地面；下方台基沉到地面以下 */
      var deckY;
      if (cfg.autoGround === 'top') deckY = box.max.y;
      else if (cfg.autoGround === 'bottom') deckY = box.min.y;
      else deckY = (cfg.mode === 'disc' ? cfg.deckZ : cfg.floorZ) * scale;
      obj.position.x -= c.x;
      obj.position.z -= c.z;
      obj.position.y -= deckY;
      var box2 = boxOf(obj);
      var f = {
        scale: scale,
        deckRadius: cfg.mode === 'disc'
          ? (cfg.autoFit ? Math.min(box2.max.x, box2.max.z) : cfg.deckR * scale)
          : 0,
        deckTop: 0,
        floor: deckY,
        size: box2.getSize(new THREE.Vector3())
      };
      /* 台面真实高度：从正上方打一条射线量出来。
         deckZ 是模型自带单位，落到 y=0 后不一定等于 0，玩家会被放到台脚（相机贴地仰视）。
         中心十字水槽略低，取 0.35R 与 0.6R 两圈四个点的中位数更稳。 */
      try {
        obj.updateMatrixWorld(true);
        var rc = new THREE.Raycaster();
        var ys = [];
        var rr = f.deckRadius || Math.min(box2.max.x, box2.max.z) * 0.6;
        [[0, 0], [rr * 0.35, 0], [-rr * 0.35, 0], [0, rr * 0.35], [0, -rr * 0.35],
         [rr * 0.6 * 0.707, rr * 0.6 * 0.707], [-rr * 0.6 * 0.707, -rr * 0.6 * 0.707]]
          .forEach(function (p) {
            rc.set(new THREE.Vector3(p[0], box2.max.y + 200, p[1]), new THREE.Vector3(0, -1, 0));
            var hs = rc.intersectObject(obj, true);
            /* 室内世界头顶有拱顶，从上面打第一条命中的是屋顶；取最靠近 y=0 的那一层当地面 */
            var best = null;
            for (var i = 0; i < hs.length; i++) {
              if (best === null || Math.abs(hs[i].point.y) < Math.abs(best)) best = hs[i].point.y;
            }
            if (best !== null && Math.abs(best) < 8) ys.push(best);
          });
        if (ys.length) {
          ys.sort(function (a, b) { return a - b; });
          f.deckTop = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.75))];
        }
      } catch (e) { log('deckTop probe failed', e && e.message); }
      prepMaterials(obj, sk);
      /* 配色按资产真实高度归一化（竞技台是 -7.5~0，其它是 0~高度） */
      setPaintRange(obj, box2.min.y, box2.max.y);
      var entry = { root: obj, fit: f, tris: trisOf(obj) };
      cache[sk] = entry;
      log('load ok', sk, 'tris', entry.tris, 'scale', f.scale.toFixed(2));
      var list = loading[sk];
      delete loading[sk];
      for (var i = 0; i < list.length; i++) list[i](null, entry);
    }, function (ev) {
      if (ev && ev.total && !loading[sk]._logged && ev.loaded / ev.total > 0.15) {
        loading[sk]._logged = true;
        log('loading', sk, Math.round(ev.loaded / ev.total * 100) + '%');
      }
    }, function (err) {
      failed[sk] = true;
      log('load FAILED', sk, err && (err.message || err.type));
      var list = loading[sk];
      delete loading[sk];
      for (var i = 0; i < list.length; i++) list[i](err || new Error('load failed'));
    });
  }

  /* ---------- 玩法道具（断柱 / 掩体）：模型不带这些，补低面数代理件 ---------- */
  var TAU = Math.PI * 2;
  var stoneTexCache = null;

  /* 程序化砌石贴图：底色 + 斑点 + 石缝，给代理件一点材质层次，别让它们在
     白色大理石台面上变成一块纯色板 */
  function stoneTex() {
    if (stoneTexCache) return stoneTexCache;
    var c = document.createElement('canvas');
    c.width = c.height = 512;
    var g = c.getContext('2d');
    g.fillStyle = '#8a9198';
    g.fillRect(0, 0, 512, 512);
    for (var i = 0; i < 11000; i++) {
      var x = Math.random() * 512, y = Math.random() * 512;
      var r = Math.random() * 1.8 + 0.3;
      var v = Math.random();
      g.fillStyle = v > 0.5
        ? 'rgba(226,232,236,' + (0.10 + Math.random() * 0.22).toFixed(2) + ')'
        : 'rgba(46,52,58,' + (0.10 + Math.random() * 0.24).toFixed(2) + ')';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    /* 石缝：横缝每 128，竖缝错缝 */
    g.strokeStyle = 'rgba(38,44,50,0.26)';
    g.lineWidth = 3;
    for (var row = 0; row < 4; row++) {
      var yy = row * 128;
      g.beginPath(); g.moveTo(0, yy); g.lineTo(512, yy); g.stroke();
      var off = (row % 2) * 64;
      for (var col = 0; col < 4; col++) {
        var xx = off + col * 128;
        g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, yy + 128); g.stroke();
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.6, 1.6);
    tex.anisotropy = 4;
    stoneTexCache = tex;
    return tex;
  }

  function partMesh(parent, mat, geo, x, y, z, ry, rz) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    if (rz) m.rotation.z = rz;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function addProps(k, scene, obstacles) {
    if (!group) return;
    if (q.get('noprops') === '1') return;
    var out = obstacles || [];
    var props = new THREE.Group();
    props.name = 'stageProps';
    /* 方形世界（副本 / 新手村 / 王座回廊）与圆台世界（竞技场 / 主城 / 神之巅 / 野外 / 断崖）两套布局 */
    var cfg0 = CFG[k] || {};
    var rect = cfg0.mode === 'rect';

    var tone = rect ? 0x4a5258 : 0x5c646b;
    var toneHi = rect ? 0x565e65 : 0x687077;
    var map = stoneTex();
    var stone = new THREE.MeshStandardMaterial({ color: tone, map: map, roughness: 0.95, metalness: 0.04, side: THREE.DoubleSide });
    var stoneHi = new THREE.MeshStandardMaterial({ color: toneHi, map: map, roughness: 0.97, metalness: 0.03, side: THREE.DoubleSide });

    var shaftGeo, baseGeo, capGeo, rubGeo, coverGeo, chunkGeo;
    if (rect) {
      shaftGeo = new THREE.CylinderGeometry(0.50, 0.62, 6.6, 10);
      baseGeo = new THREE.BoxGeometry(1.3, 0.3, 1.3);
      capGeo = new THREE.BoxGeometry(1.0, 0.22, 1.0);
      rubGeo = new THREE.BoxGeometry(0.62, 0.44, 0.56);
      coverGeo = new THREE.BoxGeometry(2.6, 1.1, 0.9);
      chunkGeo = new THREE.BoxGeometry(1.1, 1.0, 0.9);
    } else {
      shaftGeo = new THREE.CylinderGeometry(0.52, 0.64, 2.6, 10);
      baseGeo = new THREE.BoxGeometry(1.5, 0.34, 1.5);
      capGeo = new THREE.BoxGeometry(1.0, 0.22, 1.0);
      rubGeo = new THREE.BoxGeometry(0.72, 0.42, 0.60);
      coverGeo = new THREE.BoxGeometry(2.4, 1.1, 1.1);
      chunkGeo = new THREE.BoxGeometry(0.9, 0.9, 0.7);
    }
    var shaftTop = rect ? 6.6 : 2.6;

    /* 断柱：副本 / 新手村 5 根 r12.6；圆台世界 4 根 r10.5，角度整体偏 22.5° 避开出生轴线 */
    var pil = rect ? 5 : 4;
    for (var i = 0; i < pil; i++) {
      var a = rect ? (i / 5) * TAU + 0.45 : Math.PI / 8 + (i / 4) * TAU;
      var r = rect ? 12.6 : 10.5;
      var x = Math.cos(a) * r, z = Math.sin(a) * r;
      partMesh(props, stone, shaftGeo, x, shaftTop / 2 + 0.15, z);
      partMesh(props, stoneHi, baseGeo, x, 0.15, z);
      partMesh(props, stoneHi, capGeo, x, shaftTop + 0.26, z);
      partMesh(props, stone, rubGeo, x + 0.1, shaftTop + 0.55, z, 0.3);
      /* 圆台世界改成断柱残墩：柱头多堆两块碎石，别让 6m 光柱在台面上一柱擎天 */
      if (!rect) {
        partMesh(props, stone, rubGeo, x - 0.32, shaftTop + 0.42, z + 0.18, -0.35, 0.12);
        partMesh(props, stoneHi, capGeo, x + 0.34, shaftTop + 0.20, z - 0.22, 0.6, 0.08);
      }
      out.push({ x: x, z: z, r: rect ? 0.8 : 0.86 });
    }

    /* 掩体：方形世界 8 处 r15.6，圆台世界 6 处 r17（偏到出生环内侧之外，不挡住出生视野）。
       圆台相位取 15° 而不是 30°：30° 时正好有一块掩体落在 z 主轴尽头，玩家出生就正对着一块方砖 */
    var cov = rect ? 8 : 6;
    var covR = rect ? 15.6 : 17.0;
    var covPhase = rect ? 0.18 : Math.PI / 12;
    for (var c = 0; c < cov; c++) {
      var ca = (c / cov) * TAU + covPhase;
      var cx = Math.cos(ca) * covR, cz = Math.sin(ca) * covR;
      partMesh(props, stone, coverGeo, cx, 0.55, cz, -ca);
      partMesh(props, stoneHi, chunkGeo,
        cx + Math.cos(ca + (rect ? 0.5 : 1.2)) * 1.5, 0.5,
        cz + Math.sin(ca + (rect ? 0.5 : 1.2)) * 1.5, -ca + 0.25);
      out.push({ x: cx, z: cz, r: rect ? 1.4 : 1.35 });
    }

    group.add(props);
    /* 后三段世界的专属地貌件（枯树/断桥/王座），叠在通用断柱与掩体之上 */
    addWorldProps(k, props, out, stone, stoneHi);
    applyEnv(props, k);
    /* 代理件比模型更暗一档，避免在白色大理石台面上抢眼 */
    props.traverse(function (o) {
      if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
      var ud = o.material.userData || {};
      if (ud.noEnv) {
        o.material.envMapIntensity = ud.envKeep != null ? ud.envKeep : 0;
        o.material.needsUpdate = true;
        return;
      }
      o.material.envMapIntensity = (CFG[k] ? CFG[k].envI : 1) * 0.55;
      o.material.needsUpdate = true;
    });
  }

  /* ---------- 后三段世界的专属地貌 ----------
     在同一批 GLB 上加一组只属于这个世界的道具，让"换光换天"之外还有能走过去的实物。
     全部用基础几何拼，单件 3–6 个面，进来只多几十个 mesh。 */
  function addWorldProps(k, parent, out, stone, stoneHi) {
    var key = (CFG[k] && CFG[k].props) || '';
    if (!key) return;

    function mesh(geo, mat, x, y, z, rx, ry, rz) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      if (ry) m.rotation.y = ry;
      if (rz) m.rotation.z = rz;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    }

    /* 专属件的材质吃环境贴图会被洗成大理石白，这里统一关掉反照；
       只有王座的金件需要一点金属反光，单独给强度 */
    function noEnv(m, keep) {
      m.userData.noEnv = true;
      if (typeof keep === 'number') m.userData.envKeep = keep;
      return m;
    }

    if (key === 'wild') {
      /* 边境野外：枯树 6 株 + 岩堆 4 处 + 篝火残址 2 处 + 半塌木栅栏 3 段 */
      var bark = noEnv(new THREE.MeshStandardMaterial({ color: 0x3a2b1c, roughness: 0.95, metalness: 0.02 }));
      var barkHi = noEnv(new THREE.MeshStandardMaterial({ color: 0x4b3a26, roughness: 0.92 }));
      var rockM = noEnv(new THREE.MeshStandardMaterial({ color: 0x6f6355, roughness: 0.98, metalness: 0.02 }));
      var ashM = noEnv(new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 1.0 }));
      var emberM = new THREE.MeshBasicMaterial({ color: 0xff9a3c });
      var trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.8, 7);
      var branchGeo = new THREE.CylinderGeometry(0.07, 0.11, 2.2, 5);

      for (var t = 0; t < 6; t++) {
        var ta = (t / 6) * TAU + 0.4;
        var tr = 19.0 + (t % 3) * 1.7;
        var tx = Math.cos(ta) * tr, tz = Math.sin(ta) * tr;
        mesh(trunkGeo, bark, tx, 1.9, tz, 0, ta);
        for (var b = 0; b < 3; b++) {
          mesh(branchGeo, barkHi, tx + Math.cos(ta + b) * 0.5, 2.6 + b * 0.5,
            tz + Math.sin(ta + b) * 0.5, 0.45 + b * 0.12, ta + b * 1.6, 0.55);
        }
        out.push({ x: tx, z: tz, r: 0.55 });
      }

      for (var r0 = 0; r0 < 4; r0++) {
        var ra = (r0 / 4) * TAU + 1.1;
        var rx0 = Math.cos(ra) * 21.0, rz0 = Math.sin(ra) * 21.0;
        mesh(new THREE.BoxGeometry(1.5, 1.1, 1.3), rockM, rx0, 0.55, rz0, 0.10, ra);
        mesh(new THREE.BoxGeometry(0.9, 0.7, 0.8), rockM, rx0 + 0.7, 0.35, rz0 + 0.4, -0.12, ra + 0.7);
        mesh(new THREE.BoxGeometry(0.7, 0.55, 0.6), rockM, rx0 - 0.6, 0.28, rz0 - 0.3, 0.2, ra - 0.4);
        out.push({ x: rx0, z: rz0, r: 1.2 });
      }

      for (var c0 = 0; c0 < 2; c0++) {
        var ca0 = c0 * Math.PI + 2.2;
        var cx0 = Math.cos(ca0) * 15.5, cz0 = Math.sin(ca0) * 15.5;
        mesh(new THREE.CylinderGeometry(0.52, 0.34, 0.34, 10), stone, cx0, 0.17, cz0);
        mesh(new THREE.CircleGeometry(0.46, 16), ashM, cx0, 0.35, cz0, -Math.PI / 2);
        mesh(new THREE.SphereGeometry(0.10, 8, 6), emberM, cx0, 0.44, cz0);
        mesh(new THREE.SphereGeometry(0.06, 6, 5), emberM, cx0 + 0.22, 0.40, cz0 - 0.12);
        out.push({ x: cx0, z: cz0, r: 0.55 });
      }

      var plankGeo = new THREE.BoxGeometry(2.4, 0.12, 0.12);
      var postGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6);
      for (var g0 = 0; g0 < 3; g0++) {
        var ga = (g0 / 3) * TAU + 0.9;
        var gx = Math.cos(ga) * 22.0, gz = Math.sin(ga) * 22.0;
        mesh(postGeo, bark, gx - 1.0, 0.55, gz);
        mesh(postGeo, bark, gx + 1.0, 0.55, gz);
        mesh(plankGeo, barkHi, gx, 0.78, gz, 0, ga);
        mesh(plankGeo, barkHi, gx, 0.52, gz, 0.12, ga + 0.08);
        out.push({ x: gx, z: gz, r: 1.1 });
      }
      return;
    }

    if (key === 'cliff') {
      /* 断崖战场：断桥 2 段 + 弩台 2 座 + 裂痕 4 道 + 破旗 3 面 */
      var slabM = noEnv(new THREE.MeshStandardMaterial({ color: 0x767e87, roughness: 0.9, metalness: 0.06 }));
      var darkM = noEnv(new THREE.MeshStandardMaterial({ color: 0x2b333b, roughness: 0.85, metalness: 0.2 }));
      var poleM = noEnv(new THREE.MeshStandardMaterial({ color: 0x3c4650, roughness: 0.7, metalness: 0.4 }));
      var flagM = noEnv(new THREE.MeshStandardMaterial({
        color: 0xc0242f, roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.92
      }));
      var crackM = new THREE.MeshBasicMaterial({ color: 0x141a20, transparent: true, opacity: 0.95 });

      for (var s0 = 0; s0 < 2; s0++) {
        var sa = 4.6 + s0 * 3.0;
        var sx = Math.cos(sa) * 19.5, sz = Math.sin(sa) * 19.5;
        mesh(new THREE.BoxGeometry(3.4, 0.26, 1.5), slabM, sx, 0.62, sz, 0.18, sa);
        mesh(new THREE.BoxGeometry(1.2, 0.22, 1.2), darkM, sx + 2.2, 0.55, sz + 0.9, -0.1, sa + 0.5);
        out.push({ x: sx, z: sz, r: 1.7 });
      }

      for (var n0 = 0; n0 < 2; n0++) {
        var na = 5.6 + n0 * 3.0;
        var nx = Math.cos(na) * 21.0, nz = Math.sin(na) * 21.0;
        for (var lg = 0; lg < 3; lg++) {
          mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.7, 6), poleM,
            nx + Math.cos(na + lg * 2.1) * 0.5, 0.85, nz + Math.sin(na + lg * 2.1) * 0.5,
            Math.cos(lg * 2.1) * 0.28, na, Math.sin(lg * 2.1) * 0.28);
        }
        mesh(new THREE.BoxGeometry(1.7, 0.10, 0.22), darkM, nx, 1.55, nz, 0, na);
        mesh(new THREE.BoxGeometry(0.06, 0.06, 0.9), poleM, nx, 1.62, nz, 0, na + Math.PI / 2);
        out.push({ x: nx, z: nz, r: 0.8 });
      }

      for (var k0 = 0; k0 < 4; k0++) {
        var ka = (k0 / 4) * TAU + 1.9;
        mesh(new THREE.BoxGeometry(0.8, 0.02, 6.4), crackM,
          Math.cos(ka) * 19.0, 0.02, Math.sin(ka) * 19.0, 0, ka);
      }

      for (var f0 = 0; f0 < 3; f0++) {
        var fa = 4.2 + f0 * 1.1;
        var fx0 = Math.cos(fa) * 22.0, fz0 = Math.sin(fa) * 22.0;
        mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.4, 6), poleM, fx0, 2.2, fz0);
        var flag = mesh(new THREE.PlaneGeometry(1.5, 2.0), flagM, fx0 + 0.7, 3.0, fz0, 0, fa);
        flag.castShadow = false;
        out.push({ x: fx0, z: fz0, r: 0.4 });
      }
      return;
    }

    if (key === 'throne') {
      /* 王座回廊：三层台阶王座 + 金柱 4 根 + 垂幔 2 面 + 烛台 6 座 */
      var goldM = noEnv(new THREE.MeshStandardMaterial({
        color: 0xa9772a, roughness: 0.55, metalness: 0.55, emissive: 0x2e1c06
      }), 1.25);
      var blackM = noEnv(new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: 0.75, metalness: 0.15 }));
      var redM = noEnv(new THREE.MeshStandardMaterial({
        color: 0x6b1420, roughness: 0.9, side: THREE.DoubleSide
      }));
      var flameM = new THREE.MeshBasicMaterial({ color: 0xffc45c });

      /* 王座坐北朝南，出生点在 +z 侧，王座在 -z */
      var bx = 0, bz = -13.5;
      mesh(new THREE.BoxGeometry(7.0, 0.35, 3.2), blackM, bx, 0.18, bz);
      mesh(new THREE.BoxGeometry(5.2, 0.32, 2.5), blackM, bx, 0.50, bz);
      mesh(new THREE.BoxGeometry(3.6, 0.30, 1.9), blackM, bx, 0.80, bz);
      mesh(new THREE.BoxGeometry(2.4, 2.6, 1.4), blackM, bx, 2.25, bz - 0.4, -0.08);
      mesh(new THREE.BoxGeometry(2.7, 0.28, 1.6), goldM, bx, 3.62, bz - 0.4);
      mesh(new THREE.BoxGeometry(0.3, 0.62, 0.9), goldM, bx - 1.55, 1.55, bz + 0.55);
      mesh(new THREE.BoxGeometry(0.3, 0.62, 0.9), goldM, bx + 1.55, 1.55, bz + 0.55);
      out.push({ x: bx, z: bz, r: 3.0 });

      for (var p0 = 0; p0 < 4; p0++) {
        var pa = (p0 / 4) * TAU + Math.PI / 4;
        var px = Math.cos(pa) * 9.6, pz = Math.sin(pa) * 9.6;
        mesh(new THREE.CylinderGeometry(0.42, 0.48, 7.2, 12), goldM, px, 3.6, pz);
        mesh(new THREE.BoxGeometry(1.3, 0.3, 1.3), blackM, px, 0.15, pz);
        mesh(new THREE.BoxGeometry(0.9, 0.24, 0.9), goldM, px, 7.32, pz);
        out.push({ x: px, z: pz, r: 0.75 });
      }

      for (var q0 = 0; q0 < 2; q0++) {
        var qx = q0 === 0 ? -2.6 : 2.6;
        mesh(new THREE.PlaneGeometry(1.6, 4.6), redM, qx, 2.9, bz - 0.2);
        mesh(new THREE.BoxGeometry(1.8, 0.12, 0.12), goldM, qx, 5.2, bz - 0.2);
      }

      for (var l0 = 0; l0 < 6; l0++) {
        var la = (l0 / 6) * TAU;
        var lx = Math.cos(la) * 12.8, lz = Math.sin(la) * 12.8;
        mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.25, 8), goldM, lx, 0.62, lz);
        mesh(new THREE.SphereGeometry(0.13, 8, 6), flameM, lx, 1.36, lz);
        out.push({ x: lx, z: lz, r: 0.35 });
      }
      return;
    }
  }

  /* ---------- 世界天空层：神之巅的云海（不参与碰撞，纯远景） ----------
     云面压在台沿以下，从台面往外看是“一圈白云托着高台” */
  function addSky(k, group) {
    var cfg = CFG[k];
    if (!cfg || !cfg.clouds) return;
    var cloud = new THREE.Group();
    cloud.name = 'worldClouds';
    var rings = [
      { r: 40, y: -3.2, o: 0.55 },
      { r: 60, y: -6.0, o: 0.45 },
      { r: 92, y: -9.5, o: 0.30 },
      { r: 155, y: -14.0, o: 0.16 }
    ];
    for (var i = 0; i < rings.length; i++) {
      var R = rings[i];
      var m = new THREE.Mesh(
        new THREE.CircleGeometry(R.r, 64),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: R.o,
          depthWrite: false, side: THREE.DoubleSide, fog: false
        })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.y = R.y;
      m.userData.tag = 'world_cloud';
      cloud.add(m);
    }
    /* 云面按台面高度抬起来（圆台模型台面不在 y=0，否则云海沉到台基下面看不见） */
    cloud.position.y = (fit && typeof fit.deckTop === 'number') ? fit.deckTop : 0;
    group.add(cloud);
  }

  /* 天空渐变：同资产的世界靠天色区分最有效——几何被墙挡住，天色却铺满整屏 */
  function skyTex(topHex, botHex) {
    var c = document.createElement('canvas');
    c.width = 8; c.height = 256;
    var g = c.getContext('2d');
    var lg = g.createLinearGradient(0, 0, 0, 256);
    var hex = function (v) { return '#' + ('000000' + v.toString(16)).slice(-6); };
    lg.addColorStop(0, hex(topHex));
    lg.addColorStop(0.72, hex(botHex));
    lg.addColorStop(1, hex(botHex));
    g.fillStyle = lg;
    g.fillRect(0, 0, 8, 256);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /* 圆形边界：竞技场圆台用半径夹止，副本仍走方形 */
  function boundary() {
    /* 圆台世界（竞技场 / 主城 / 神之巅）都按台面半径夹止，方形世界返回 0 走方场逻辑 */
    var cfg = CFG[kind];
    if (cfg && cfg.mode === 'disc' && fit && fit.deckRadius) return fit.deckRadius - 1.4;
    return 0;
  }

  /* ---------- 挂模型 ---------- */
  function attach(k, scene, obstacles) {
    if (!group) return;
    var sk = (CFG[k] && CFG[k].src) || k;
    var entry = cache[sk];
    if (!entry) {
      log('pending', k);
      load(k, function (err) {
        if (err) { fallback(k, scene, obstacles); return; }
        if (kind === k && group) attach(k, scene, obstacles);
      });
      return;
    }

    var inst = entry.root.clone(true);
    group.add(inst);
    root = inst;
    fit = entry.fit;
    var cfg = CFG[k] || CFG.arena;
    applyEnv(inst, k);
    /* 几何是按模型键缓存的（新手村复用副本），自发光要按世界再覆盖一档：
       暖村克制、主城中性、神之巅略提，否则同一批材质在三个世界亮得一模一样 */
    if (typeof cfg.lift === 'number') {
      inst.traverse(function (o) {
        if (!o.isMesh) return;
        var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (var i = 0; i < ms.length; i++) {
          var mm = ms[i];
          if (mm && mm.userData && mm.userData._lift) mm.emissiveIntensity = cfg.lift;
        }
      });
    }
    collectPulses();
    addSky(k, group);
    /* 道具层是在模型到之前按 y=0 摆好的；竞技场/主城这类圆台的台面实际抬在 5.7m，
       不跟着抬的话断柱与掩体全埋在台基里，只剩几个方块从台面戳出来——看起来就像「两个图层」 */
    alignPropsToDeck();

    glowLight = new THREE.PointLight(cfg.glow, cfg.glowI, cfg.glowD, 1.8);
    glowLight.position.set(0, (cfg.glowY || 1.4) + ((fit && typeof fit.deckTop === 'number') ? fit.deckTop : 0), 0);
    group.add(glowLight);

    log('attached', k, 'tris', entry.tris, 'deckRadius', fit.deckRadius ? fit.deckRadius.toFixed(1) : '-');
  }

  function clearAll() {
    if (!group) return;
    if (ground) { ground.geometry.dispose(); ground.material.dispose(); ground = null; }
    while (group.children.length) group.remove(group.children[0]);
    if (group.parent) group.parent.remove(group);
    group = null;
    root = null;
    fit = null;
    glowLight = null;
    pulses.length = 0;
  }

  /* 道具层对齐台面：fit.deckTop 是量出来的台面高度（arena 约 5.7，副本类为 0） */
  function alignPropsToDeck() {
    if (!group) return;
    var props = group.getObjectByName('stageProps');
    if (!props) return;
    var top = (fit && typeof fit.deckTop === 'number') ? fit.deckTop : 0;
    props.position.y = top;
    return top;
  }

  function fallback(k, scene, obstacles) {
    failed[k] = true;
    log('fallback → procedural', k);
    kind = null;
    clearAll();
    if (window.ArenaScene && scene) {
      if (obstacles) obstacles.length = 0;
      /* 程序化场景只有 arena / dungeon 两套：后三段世界按 src 映射回去 */
      var proc = (CFG[k] && CFG[k].src) || k;
      window.ArenaScene.build(proc, scene, obstacles || []);
      window.ArenaScene.tuneLights(scene);
    }
  }

  /* ---------- 对外 ---------- */
  function build(k, scene, obstacles) {
    sceneRef = scene;
    obstaclesRef = obstacles;
    clearAll();
    kind = k;
    group = new THREE.Group();
    group.name = 'scene_glb_' + k;
    scene.add(group);

    var cfg = CFG[k] || CFG.arena;
    scene.fog = new THREE.Fog(cfg.fog[0], cfg.fog[1], cfg.fog[2]);
    /* 有 sky 渐变就铺渐变色（破晓暖光 / 正午蓝天 / 金白云端），否则退回纯色 */
    scene.background = cfg.sky ? skyTex(cfg.sky[0], cfg.sky[1]) : new THREE.Color(cfg.bg);

    ground = makeGround(k, cfg.groundR || 78);
    group.add(ground);

    /* 道具层先于模型落地：GLB 是异步下载的，等它就等于世界在头几秒是空的。
       断柱 / 掩体 / 专属地貌都不依赖模型，先把台面撑起来，模型到了再叠上去。 */
    addProps(k, scene, obstacles);

    attach(k, scene, obstacles);
    tuneLights(scene);

    var st = { kind: k, meshes: root ? 1 : 0, tris: root ? trisOf(root) : 0, ready: !!root };
    log('build', k, JSON.stringify(st));
    return st;
  }

  function update(dt) {
    acc += dt || 0;
    if (!pulses.length && !glowLight) return;
    var s = 1 + Math.sin(acc * 2.0) * 0.05;
    for (var i = 0; i < pulses.length; i++) {
      var mm = pulses[i];
      if (mm) mm.emissiveIntensity = (mm.userData._base || 1) * s;
    }
    if (glowLight) glowLight.intensity = (CFG[kind] ? CFG[kind].glowI : CFG.arena.glowI) * s;
  }

  function stats() {
    return {
      kind: kind,
      tris: root ? trisOf(root) : 0,
      ready: !!root,
      scale: fit ? fit.scale : 0,
      deckRadius: fit && fit.deckRadius ? fit.deckRadius : 0
    };
  }

  window.SceneGlb = {
    enabled: !FORCE_PROC && !!(window.THREE && THREE.GLTFLoader),
    build: build,
    update: update,
    tuneLights: tuneLights,
    stats: stats,
    boundary: boundary,
    preload: load,
    get kind() { return kind; },
    get info() { return { kind: kind, fit: fit, failed: failed, obstacles: obstaclesRef }; }
  };

  /* 验收用只读把手（不改逻辑，只在控制台/DOM 里看状态） */
  window.__sceneGlbDebug = {
    get group() { return group; },
    get root() { return root; },
    get fit() { return fit; },
    get scene() { return sceneRef; }
  };

  log('ready, enabled=' + window.SceneGlb.enabled + (FORCE_PROC ? ' (?stage=proc)' : ''));
})();








