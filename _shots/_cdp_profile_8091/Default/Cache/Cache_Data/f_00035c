/* ============================================================
   glb3d.js — GLB 写实档加载器与接口适配层（接缝 v1）
   ------------------------------------------------------------
   与 Real3D / Hero3D 同签名：build / update / swing / cast / pose /
   stats / setFace / matSet / PAL / HEAD / version / ready / info。
   契约要点（冻结规范 brief_glb_seam.md）：
   1) build 同步返回空组，GLB 异步挂载；未加载/失败时所有接口安全空转。
   2) 失败回退 window.Real3D，标 userData.glbFallback。
   3) 一份 GLB 只 fetch/parse 一次（url 缓存 Promise + gltf）；
      每实例 SkeletonUtils.clone + 独立 AnimationMixer。
   4) 资源守卫：geometry.userData.shared=true；material 按实例 clone
      （贴图只共享引用），material.userData.shared=true。
   5) Root motion：Hips x/z 锁回绑定姿势，角色不漂移。
   6) 48 帧采样取 Box3.min.y 最小值做贴地补偿。
   7) fit 因子只施加在内层节点，根节点 scale 归 game.js。
   8) 挂载完成后若 NightGrade.active() 则补做 silhouette（异步挂载不漏压暗）。
   9) 贴图档位 ?tex=1024 / setTexTier('1024')；文件缺失静默回退 2K 并记入 info()。
   ============================================================ */
(function () {
  if (!window.THREE) return;
  var T = THREE;
  var PI = Math.PI;

  /* ---------- kind → 模型映射（冻结） ---------- */
  var KIND_MAP = {
    swordsman: 'swordsman_idle', blade: 'swordsman_idle', grunt: 'swordsman_idle', elite: 'swordsman_idle',
    gunner: 'gunner_idle', shooter: 'gunner_idle', duelist: 'gunner_idle',
    warlock: 'mage_idle', mage: 'mage_idle', boss: 'mage_idle'
  };
  /* GLB 自带名义身高（m） */
  var GLB_H = { swordsman_idle: 1.84, gunner_idle: 1.89, mage_idle: 1.96 };
  /* fit 只做「敌人基准 1.800m / GLB 名义身高」归一；类型差异（elite/boss 放大）全部交给
     game.js 根 scale，禁止把根 scale 再算进 FIT（否则重复放大）。玩家/远端 fit=1。 */
  var FIT = {
    grunt: 1.800 / 1.84,
    shooter: 1.800 / 1.89,
    duelist: 1.800 / 1.89,
    elite: 1.800 / 1.84,
    boss: 1.800 / 1.96
  };
  var BASE_DIR = 'art/模型/glb/';

  /* ---------- 贴图档位：按 kind 策略 + URL 覆盖 ----------
     策略：hero 组 2K、enemy 组 1024；?tex=1024 / ?tex=2k 全局覆盖做对比。
     同一模型可同时存在 2K 与 1024 两个 URL，cache 按 URL 分开。 */
  var qs = new URLSearchParams(location.search);
  var HERO_KINDS = { swordsman: 1, blade: 1, gunner: 1, warlock: 1, mage: 1 };
  var ENEMY_KINDS = { grunt: 1, shooter: 1, duelist: 1, elite: 1, boss: 1 };
  var policy = { hero: '2k', enemy: '1024' };
  var urlOverride = qs.get('tex') === '1024' ? '1024' : (qs.get('tex') === '2k' ? '2k' : null);

  var cache = {};            // url -> Promise<gltf>
  var infoState = {
    override: urlOverride,
    policy: policy,
    entries: {},             // kind -> { kind, tier, url, model, mats, textures, bones, height }
    fallbacks: {},           // kind -> '2k'（1024 缺失回退标记）
    mountMs: {}
  };

  function tierForKind(kind) {
    if (urlOverride) return urlOverride;
    var grp = HERO_KINDS[kind] ? 'hero' : 'enemy';
    return policy[grp] || '2k';
  }
  function setTierPolicy(p) {
    p = p || {};
    policy.hero = p.hero === '1024' ? '1024' : '2k';
    policy.enemy = p.enemy === '2k' ? '2k' : '1024';
  }
  function setTexTier(t) { urlOverride = String(t || '2k') === '1024' ? '1024' : '2k'; }
  function getTexTier() { return urlOverride || 'policy(hero 2k / enemy 1024)'; }

  function modelUrl(model, tier) {
    var suffix = (tier || '2k') === '1024' ? '_1024' : '';
    return encodeURI(BASE_DIR + model + suffix + '.glb');
  }

  function loadGltf(url) {
    if (cache[url]) return cache[url];
    if (!T.GLTFLoader) return Promise.reject(new Error('THREE.GLTFLoader 缺失'));
    var loader = new T.GLTFLoader();
    cache[url] = new Promise(function (resolve, reject) {
      loader.load(url, function (gltf) { resolve(gltf); }, undefined, function (err) {
        delete cache[url];
        reject(err || new Error('GLB load error: ' + url));
      });
    });
    return cache[url];
  }

  function resolveModel(kind) { return KIND_MAP[kind] || 'swordsman_idle'; }
  function bn(name) { return String(name).replace('.', ''); }

  /* ---------- 兜底：Real3D ---------- */
  function fallbackBuild(root, kind, opts, err) {
    root.userData.glbPending = false;
    root.userData.glbFallback = true;
    if (window.Real3D) {
      var f = Real3D.build(kind, opts);
      while (f.children.length) root.add(f.children[0]);
      Object.keys(f.userData).forEach(function (k) { root.userData[k] = f.userData[k]; });
      root.userData.glbFallback = true;
    }
    if (err) console.warn('[glb3d] 加载失败，回退 Real3D:', err && err.message ? err.message : err);
  }

  /* 纯网格 Box3：只统计 Mesh，排除 Sprite（脚下冷光 Sprite 不计入身高/贴地口径） */
  function meshBox3(root) {
    var box = new T.Box3();
    box.makeEmpty();
    root.traverse(function (o) {
      if (o.isMesh && o.geometry) box.expandByObject(o);
    });
    return box;
  }

  /* ---------- 贴地采样：48 帧取 Box3.min.y 最小值 ---------- */
  function sampleGround(clone, mixer, clip) {
    var minY = Infinity;
    var box = new T.Box3();
    if (clip) {
      var dur = clip.duration || 2.0417;
      for (var i = 0; i < 48; i++) {
        mixer.setTime(dur * i / 47);
        clone.updateMatrixWorld(true);
        box = meshBox3(clone);
        if (box.min.y < minY) minY = box.min.y;
      }
      mixer.setTime(0);
    } else {
      box = meshBox3(clone);
      minY = box.min.y;
    }
    return isFinite(minY) ? minY : 0;
  }

  function collectMatInfo(clone) {
    var mats = [], texSeen = {}, textures = [];
    clone.traverse(function (o) {
      if (!o.isMesh) return;
      var ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(function (m) {
        if (!m) return;
        var emissive = m.emissive ? ('#' + m.emissive.getHexString()) : '-';
        var maps = [];
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach(function (mk) {
          var tx = m[mk];
          if (tx && tx.image) {
            var roleKey = (mk === 'roughnessMap' || mk === 'metalnessMap') ? 'rmMap' : mk;
            maps.push({ role: roleKey, w: tx.image.width || 0, h: tx.image.height || 0 });
            if (!texSeen[roleKey]) {
              texSeen[roleKey] = 1;
              textures.push({ role: roleKey, w: tx.image.width || 0, h: tx.image.height || 0 });
            }
          }
        });
        mats.push({ name: m.name || '(noname)', emissive: emissive, maps: maps });
      });
    });
    return { mats: mats, textures: textures };
  }

  /* ---------- 挂载 ---------- */
  function mount(root, kind, model, gltf, t0, tier, url) {
    var fit = root.userData.fit != null ? root.userData.fit : 1;
    var inner = new T.Group();
    inner.scale.setScalar(fit);

    var clone = T.SkeletonUtils.clone(gltf.scene);

    /* 材质按实例 clone（贴图共享引用）；几何/材质守卫 */
    clone.traverse(function (o) {
      if (!o.isMesh) return;
      o.geometry.userData.shared = true;
      if (Array.isArray(o.material)) {
        o.material = o.material.map(function (m) {
          if (!m) return m;
          var c = m.clone(); c.userData.shared = true; return c;
        });
      } else if (o.material) {
        var c = o.material.clone(); c.userData.shared = true; o.material = c;
      }
    });

    var bones = {}, rest = {};
    clone.traverse(function (o) {
      if (o.isBone) {
        bones[o.name] = o;
        rest[o.name] = { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z };
      }
    });

    var mixer = new T.AnimationMixer(clone);
    var clip = (gltf.animations && gltf.animations[0]) || null;
    var action = null;
    if (clip) { action = mixer.clipAction(clip); action.play(); }

    var hips = bones['Hips'];
    var hipsRest = hips ? { x: hips.position.x, z: hips.position.z } : null;

    var minY = sampleGround(clone, mixer, clip);
    inner.position.y = -minY;

    inner.add(clone);
    root.add(inner);

    var mi = collectMatInfo(clone);
    var rig = {
      inner: inner, clone: clone, mixer: mixer, action: action, clip: clip,
      bones: bones, rest: rest, model: model, fit: fit,
      tier: tier, url: url,
      hips: hips, hipsRest: hipsRest,
      attack: null, aim: 0, walk: 0, t: 0,
      groundMinY: minY, mats: mi.mats, textures: mi.textures
    };
    root.userData.glb = rig;
    root.userData.glbPending = false;
    root.userData.glbFallback = false;
    root.userData.groundMinY = minY;
    root.userData.matSlots = mi.mats.map(function (m) { return m.name; });

    infoState.entries[kind] = {
      kind: kind, tier: tier, url: url, model: model,
      arm: model === 'mage_idle' ? 'off' : 'on',
      mats: mi.mats, textures: mi.textures,
      bones: Object.keys(bones).length,
      height: GLB_H[model] || 1.8
    };
    if (t0 != null) {
      infoState.mountMs[kind] = Math.round(performance.now() - t0);
      root.userData.mountMs = infoState.mountMs[kind];
    }

    /* 夜间档：异步挂载后补做剪影（压暗公式只走 NightGrade 一份） */
    try {
      if (window.NightGrade && NightGrade.active()) {
        NightGrade.silhouette(root, root.userData.nightSil || 0.62);
      }
    } catch (e) { console.warn('[glb3d] night silhouette failed', e); }
  }

  /* ---------- build（同步返回空组） ---------- */
  function build(kind, opts) {
    opts = opts || {};
    var root = new T.Group();
    root.userData.glbPending = true;
    root.userData.heroKit = kind;
    var model = resolveModel(kind);
    root.userData.glbKind = model;
    root.userData.fit = FIT[kind] != null ? FIT[kind] : 1;
    root.userData.glbFallback = false;

    var canLoad = T.GLTFLoader && T.SkeletonUtils;
    if (!canLoad) { fallbackBuild(root, kind, opts, new Error('loader 缺失')); return root; }

    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var tier = tierForKind(kind);
    var url = modelUrl(model, tier);

    loadGltf(url).then(function (gltf) {
      mount(root, kind, model, gltf, t0, tier, url);
    }).catch(function (err) {
      /* 1024 缺失 → 静默回退 2K，info() 标记 */
      if (tier === '1024') {
        var baseUrl = modelUrl(model, '2k');
        loadGltf(baseUrl).then(function (gltf) {
          infoState.fallbacks[kind] = '2k';
          mount(root, kind, model, gltf, t0, '2k', baseUrl);
        }).catch(function (e2) { fallbackBuild(root, kind, opts, e2); });
      } else {
        fallbackBuild(root, kind, opts, err);
      }
    });
    return root;
  }

  /* ---------- 动作叠加（基于 _glb_boneaxes 实测轴） ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t * t * (3 - 2 * t); }

  function overlay(root, rig, dt, st, moving, speed) {
    var B = function (n) { return rig.bones[bn(n)]; };
    /* 资产侧限制：mage_idle（术士/boss）下摆/袖权重未绑到 Hips，任何可见抬臂都会拖出
       飞片/斜条；该模型所有动作的肩/上臂/前臂叠加一律禁用（arm=off），只保留躯干/头部微动。
       局内 boss 走 bossBurst() 弹幕、game.js 不调 swing，远端术士也不露破袍；待 Blender 重绑
       袖/摆权重后再按 0.55–0.75 放开手臂叠加。 */
    var MAGE = rig.model === 'mage_idle';
    /* Idle clip 全部骨骼走 .quaternion 轨；mixer 每帧先写四元数。局部增量四元数右乘
       （q' = q·dq，骨骼局部空间）；左乘是父空间旋转会搅乱轴。不碰欧拉角避免陈旧角堆积。 */
    var _q = new T.Quaternion(), _dq = new T.Quaternion(), _eq = new T.Euler();
    function addRot(bone, dx, dy, dz) {
      if (!bone) return;
      _eq.set(dx, dy, dz, 'XYZ');
      _dq.setFromEuler(_eq);
      _q.copy(bone.quaternion).multiply(_dq);
      bone.quaternion.copy(_q);
    }
    /* mage 躯干/头部微动上限：Chest ≤0.10、Spine ≤0.05、Head ≤0.08 */
    function addTorso(bone, dx, dy, dz) {
      if (!bone) return;
      if (MAGE) { dx = clamp(dx, -0.10, 0.10); dy = clamp(dy, -0.10, 0.10); dz = clamp(dz, -0.10, 0.10); }
      addRot(bone, dx, dy, dz);
    }
    function addSpine(bone, dx, dy, dz) {
      if (!bone) return;
      if (MAGE) { dx = clamp(dx, -0.05, 0.05); dy = clamp(dy, -0.05, 0.05); dz = clamp(dz, -0.05, 0.05); }
      addRot(bone, dx, dy, dz);
    }
    function addHead(bone, dx, dy, dz) {
      if (!bone) return;
      if (MAGE) { dx = clamp(dx, -0.08, 0.08); dy = clamp(dy, -0.08, 0.08); dz = clamp(dz, -0.08, 0.08); }
      addRot(bone, dx, dy, dz);
    }

    /* 待机/移动混合：timeScale 已随速度提升，这里叠轻微前倾 */
    rig.walk = lerp(rig.walk, moving ? 1 : 0, Math.min(1, dt * 9));
    var chest = B('Chest'), spine = B('Spine'), head = B('Head');
    if (chest && rig.walk > 0.01) addTorso(chest, -0.10 * rig.walk, 0, 0);

    /* 瞄准（枪手举枪待命）；mage 禁手臂叠加 */
    rig.aim = lerp(rig.aim, st.aim ? 1 : 0, Math.min(1, dt * 8));
    if (rig.aim > 0.01) {
      var uaR = B('UpperArm.R'), laR = B('LowerArm.R');
      var uaL = B('UpperArm.L'), laL = B('LowerArm.L');
      if (!MAGE) {
        addRot(uaR, lerp(0, -1.15, rig.aim), 0, 0);
        addRot(laR, lerp(0, -1.30, rig.aim), 0, 0);
        addRot(uaL, lerp(0, -0.95, rig.aim), 0, 0);
        addRot(laL, lerp(0, -1.45, rig.aim), 0, 0);
      }
      if (chest) addTorso(chest, 0, lerp(0, 0.26, rig.aim), 0);
    }

    /* 攻击程序化叠加；无新增 clip。当前 clip 姿态上四元数局部增量，结束后 0.25s 平滑回零 */
    if (rig.attack) {
      var c = rig.attack;
      c.t += dt;
      var q = clamp(c.t / c.dur, 0, 1);
      var w = ease(clamp(q < 0.25 ? q / 0.25 : (1 - q) / 0.25, 0, 1));
      if (q >= 1) {
        c.release = (c.release || 0) + dt;
        w = Math.max(0, 1 - c.release / 0.25);
        if (w <= 0) { rig.attack = null; w = 0; }
      }
      var uaR2 = B('UpperArm.R'), laR2 = B('LowerArm.R');
      var uaL2 = B('UpperArm.L'), laL2 = B('LowerArm.L');
      if (c.name === 'slash') {
        var wind = Math.sin(Math.min(1, q * 1.5) * PI * 0.5);
        var strike = q > 0.45 ? Math.sin((q - 0.45) / 0.55 * PI) : 0;
        /* 挥砍：肩前摆 ≤1.10、外展 ≤0.70；肘 ≤1.25；胸转 ≤0.26（躯干增量）。mage 禁手臂。 */
        if (!MAGE) {
          addRot(uaR2, (-1.30 * wind * 0.85) * w, 0, (0.40 + q * 0.30) * w);
          addRot(laR2, (-0.30 - wind * 0.70 + strike * 0.25) * w, 0, 0);
        }
        if (chest) addTorso(chest, 0, (-0.30 * wind * 0.6) * w + (0.26 * strike) * w, 0);
        if (spine) addSpine(spine, (0.04 + ease(q) * 0.08) * w, 0, 0);
      } else if (c.name === 'shoot') {
        /* 举枪射击：肩抬 0.45、肘弯 0.70/0.75，枪口大致朝前；胸转 0.15 + 小幅后坐 0.08。mage 禁手臂。 */
        var recoil = Math.sin(q * PI) * 0.08;
        if (!MAGE) {
          addRot(uaR2, -0.45 * w, 0, 0);
          addRot(laR2, -0.70 * w, 0, 0);
          addRot(uaL2, -0.35 * w, 0, 0);
          addRot(laL2, -0.75 * w, 0, 0);
        }
        if (chest) addTorso(chest, -recoil * w, 0.15 * w, 0);
      } else if (c.name === 'cast') {
        /* 施法：mage 手臂叠加禁用（资产侧限制，见下）；仅胸后仰 0.05、头抬 0.06 微动。
           非 mage：右上臂抬 0.15、前臂屈 0.10、左臂外展 ≤0.13（受术士权重限制的保守值）。 */
        var up = Math.sin(q * PI);
        if (!MAGE) {
          addRot(uaR2, -0.15 * up * w, 0, 0);
          addRot(laR2, -0.10 * up * w, 0, 0);
          addRot(uaL2, 0, 0, (-0.10 - up * 0.03) * w);
        }
        if (chest) addTorso(chest, -up * 0.05 * w, 0, 0);
        if (head) addHead(head, -up * 0.06 * w, 0, 0);
      }
    }

    /* 受击后仰（躯干增量） */
    var hit = st.hitT || 0;
    if (hit > 0) {
      if (spine) addSpine(spine, -0.18 * hit, 0, 0);
      if (chest) addTorso(chest, -0.10 * hit, 0, 0);
      if (head) addHead(head, -0.12 * hit, 0, 0);
    }
  }

  function update(mesh, dt, st) {
    if (!mesh || !mesh.userData) return;
    if (mesh.userData.glbFallback) {
      if (window.Real3D) Real3D.update(mesh, dt, st);
      return;
    }
    var rig = mesh.userData.glb;
    if (!rig || mesh.userData.glbPending) return;
    st = st || {};
    rig.t += dt;

    var speed = st.speed || 0;
    var moving = speed > 0.25;
    if (rig.action) rig.action.timeScale = moving ? Math.min(1.6, 1 + speed * 0.08) : 1;
    rig.mixer.update(dt);

    /* Root motion：锁 Hips x/z */
    if (rig.hips && rig.hipsRest) {
      rig.hips.position.x = rig.hipsRest.x;
      rig.hips.position.z = rig.hipsRest.z;
    }

    overlay(mesh, rig, dt, st, moving, speed);
  }

  function swing(mesh, name, dur) {
    if (!mesh || !mesh.userData) return;
    if (mesh.userData.glbFallback) { if (window.Real3D) Real3D.swing(mesh, name, dur); return; }
    var rig = mesh.userData.glb;
    if (!rig || mesh.userData.glbPending) return;
    rig.attack = { name: name || 'slash', dur: dur || 0.42, t: 0 };
  }
  function cast(mesh, dur) { swing(mesh, 'cast', dur || 0.7); }

  function pose(mesh, name) { /* GLB 无程序化姿态档，安全空实现 */ }

  function setFace(mesh, idx, v) { /* 无 morph 目标，安全空实现 */ }

  function stats(mesh) {
    var tris = 0, verts = 0, meshes = 0, bones = 0;
    var matNames = {};
    mesh.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      meshes++;
      var c = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count;
      tris += Math.floor(c / 3);
      verts += o.geometry.attributes.position.count;
      var ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(function (m) { if (m) matNames[m.name || '(noname)'] = 1; });
    });
    mesh.traverse(function (o) { if (o.isBone) bones++; });
    var box = meshBox3(mesh);   /* 纯网格身高，排除 Sprite */
    var h = box.max.y - box.min.y;
    var sc = mesh.scale.x || 1;
    return {
      tris: tris, verts: verts, meshes: meshes,
      height: +h.toFixed(3),
      heads: +(h / (0.243 * sc)).toFixed(2),
      mats: Object.keys(matNames).length,
      bones: bones
    };
  }

  /* ---------- 调试 ---------- */
  function ready(url) { return cache[url] || Promise.resolve(null); }
  function info() {
    return {
      tier: urlOverride || 'policy',
      override: urlOverride,
      policy: { hero: policy.hero, enemy: policy.enemy },
      armPolicy: { mage_idle: 'arm=off（资产限制：袖/下摆权重未绑 Hips，待 Blender 重绑）' },
      entries: infoState.entries,
      fallbacks: infoState.fallbacks,
      mountMs: infoState.mountMs,
      cacheUrls: Object.keys(cache)
    };
  }

  /* ---------- 同签名占位导出 ---------- */
  var PAL = {
    swordsman: { accent: 0x74e6f2 }, gunner: { accent: 0x35d8f2 }, warlock: { accent: 0xa87ef0 },
    grunt: { accent: 0x94c56f }, shooter: { accent: 0xd0ad55 }, elite: { accent: 0xcf5a68 }, boss: { accent: 0xb8453c }
  };
  var HEAD = { R: 0.112, sx: 0.70, sy: 1.10, sz: 0.90, cy: 0.118 };
  function matSet(kind) { return PAL[resolveModel(kind)] || PAL.swordsman; }

  window.Glb3D = {
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
    version: 'glb-seam-v1',
    ready: ready,
    info: info,
    setTierPolicy: setTierPolicy,
    tierForKind: tierForKind,
    setTexTier: setTexTier,
    getTexTier: getTexTier
  };
})();
