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
    }
  };

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
        mm.metalness = 0.08;
        if (typeof mm.roughness === 'number') mm.roughness = Math.max(mm.roughness, 0.72);
        /* Tripo 的 albedo 整体偏暗（尤其副本的冷色石头），纯靠打光会糊成一团；
           用 albedo 做微弱自发光把暗部细节提出来，同时保留贴图层次 */
        if (mm.map) {
          mm.emissiveMap = mm.map;
          mm.emissive = new THREE.Color(0xffffff);
          mm.emissiveIntensity = (k === 'arena' ? 0.15 : 0.26);
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
    g.fillStyle = dark ? '#20262a' : '#6a7176';
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
        color: dark ? 0x2a3338 : 0x7b858a,
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
      var scale = cfg.mode === 'disc'
        ? cfg.targetRadius / cfg.deckR
        : cfg.targetSpan / Math.max(size0.x, size0.z);
      obj.scale.multiplyScalar(scale);
      obj.updateMatrixWorld(true);
      var box = boxOf(obj);
      var c = box.getCenter(new THREE.Vector3());
      /* 以模型自带的“台面/地面”为准落到 y=0：
         disc（竞技场）用圆台面，rect（副本）用室内地面；下方台基沉到地面以下 */
      var deckY = (cfg.mode === 'disc' ? cfg.deckZ : cfg.floorZ) * scale;
      obj.position.x -= c.x;
      obj.position.z -= c.z;
      obj.position.y -= deckY;
      var box2 = boxOf(obj);
      var f = {
        scale: scale,
        deckRadius: cfg.mode === 'disc' ? cfg.deckR * scale : 0,
        deckTop: 0,
        floor: deckY,
        size: box2.getSize(new THREE.Vector3())
      };
      prepMaterials(obj, sk);
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
    /* 方形世界（副本 / 新手村）与圆台世界（竞技场 / 主城 / 神之巅）两套布局 */
    var rect = (k === 'dungeon' || k === 'village');

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

    /* 掩体：方形世界 8 处 r15.6，圆台世界 6 处 r17（偏到出生环内侧之外，不挡住出生视野） */
    var cov = rect ? 8 : 6;
    var covR = rect ? 15.6 : 17.0;
    var covPhase = rect ? 0.18 : Math.PI / 6;
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
    applyEnv(props, k);
    /* 代理件比模型更暗一档，避免在白色大理石台面上抢眼 */
    props.traverse(function (o) {
      if (!o.isMesh || !o.material || !o.material.isMeshStandardMaterial) return;
      o.material.envMapIntensity = (CFG[k] ? CFG[k].envI : 1) * 0.55;
      o.material.needsUpdate = true;
    });
  }

  /* ---------- 世界天空层：神之巅的云海（不参与碰撞，纯远景） ----------
     云面压在台沿以下，从台面往外看是“一圈白云托着高台” */
  function addSky(k, group) {
    var cfg = CFG[k];
    if (!cfg || !cfg.clouds) return;
    var cloud = new THREE.Group();
    cloud.name = 'worldClouds';
    var rings = [
      { r: 34, y: -1.5, o: 0.62 },
      { r: 54, y: -3.8, o: 0.46 },
      { r: 88, y: -7.4, o: 0.30 },
      { r: 152, y: -12.5, o: 0.16 }
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
    addProps(k, scene, obstacles);
    addSky(k, group);

    glowLight = new THREE.PointLight(cfg.glow, cfg.glowI, cfg.glowD, 1.8);
    glowLight.position.set(0, cfg.glowY || 1.4, 0);
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
    glowLight = null;
    pulses.length = 0;
  }

  function fallback(k, scene, obstacles) {
    failed[k] = true;
    log('fallback → procedural', k);
    kind = null;
    clearAll();
    if (window.ArenaScene && scene) {
      if (obstacles) obstacles.length = 0;
      window.ArenaScene.build(k, scene, obstacles || []);
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








