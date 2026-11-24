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
      targetRadius: 22.8,
      fog: [0xa8bccb, 120, 320],
      bg: 0xa8bccb,
      glow: 0xb8e2ff,
      glowI: 0.34,
      glowD: 46,
      envI: 1.2,
      exposure: 0.95
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
      exposure: 1.15
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

  function trisOf(obj) {
    var n = 0;
    obj.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      var g = o.geometry;
      var c = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
      n += Math.floor(c / 3);
    });
    return n;
  }

  function prepMaterials(obj) {
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
          mm.emissiveIntensity = 0.26;
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
    var dark = k === 'dungeon';
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

  /* ---------- 灯光按场景分气质 ---------- */
  function tuneLights(scene) {
    var isD = kind === 'dungeon';
    var sc = scene || sceneRef;
    if (!sc) return;
    /* GLB 是 PBR 材质、贴图本身偏暗，曝光按场景单独抬一档（程序化场景仍用 0.80） */
    if (window.__renderer && CFG[kind]) {
      window.__renderer.toneMappingExposure = CFG[kind].exposure || 0.8;
    }
    var dirs = 0;
    sc.traverse(function (o) {
      if (o.isHemisphereLight) {
        o.color.setHex(isD ? 0x7fb0cc : 0xd6e6f2);
        o.groundColor.setHex(isD ? 0x1b2a33 : 0x7a736a);
        o.intensity = isD ? 1.35 : 1.15;
      }
      if (o.isDirectionalLight) {
        if (dirs === 0) {
          o.color.setHex(isD ? 0xbfe2f4 : 0xfff4e2);
          o.intensity = isD ? 1.2 : 1.35;
        } else {
          o.color.setHex(isD ? 0x4a8ce0 : 0xd3dde4);
          o.intensity = isD ? 0.55 : 0.5;
        }
        dirs++;
      }
    });
  }

  /* ---------- 载入 ---------- */
  function load(k, cb) {
    if (cache[k]) { cb(null, cache[k]); return; }
    if (loading[k]) { loading[k].push(cb); return; }
    loading[k] = [cb];
    var cfg = CFG[k];
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
      prepMaterials(obj);
      var entry = { root: obj, fit: f, tris: trisOf(obj) };
      cache[k] = entry;
      log('load ok', k, 'tris', entry.tris, 'scale', f.scale.toFixed(2));
      var list = loading[k];
      delete loading[k];
      for (var i = 0; i < list.length; i++) list[i](null, entry);
    }, function (ev) {
      if (ev && ev.total && !loading[k]._logged && ev.loaded / ev.total > 0.15) {
        loading[k]._logged = true;
        log('loading', k, Math.round(ev.loaded / ev.total * 100) + '%');
      }
    }, function (err) {
      failed[k] = true;
      log('load FAILED', k, err && (err.message || err.type));
      var list = loading[k];
      delete loading[k];
      for (var i = 0; i < list.length; i++) list[i](err || new Error('load failed'));
    });
  }

  /* ---------- 挂模型 ---------- */
  function attach(k, scene, obstacles) {
    if (!group) return;
    var entry = cache[k];
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
    applyEnv(inst, k);
    collectPulses();

    var cfg = CFG[k];
    glowLight = new THREE.PointLight(cfg.glow, cfg.glowI, cfg.glowD, 1.8);
    glowLight.position.set(0, k === 'dungeon' ? 2.6 : 1.4, 0);
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
    scene.background = new THREE.Color(cfg.bg);

    ground = makeGround(k, 78);
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
    if (glowLight) glowLight.intensity = CFG[kind === 'dungeon' ? 'dungeon' : 'arena'].glowI * s;
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


