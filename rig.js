/* ============================================================
   第七竞技场 · 角色骨骼与动作（Joe）
   与 art.js 分离，避免与并发写入冲突
   - 骨骼：19 根，命名 bone_部位_侧
   - 部件挂在骨上（刚性分段，低模标准做法），关节旋转即动画
   - 武器通过 socket 挂在 hand_R 上，可单独替换
   ============================================================ */
(function () {
'use strict';

var GEO = {};

function g(key, make) {
  if (!GEO[key]) GEO[key] = make();
  return GEO[key];
}

var PALETTES = {
  swordsman: { armor: 0x8698a6, cloth: 0x22303a, accent: 0x7fd8ff, skin: 0xd6b196 },
  gunner:    { armor: 0x2d4d78, cloth: 0x16222f, accent: 0x66d9ff, skin: 0xc99b7d },
  warlock:   { armor: 0x4b3a78, cloth: 0x221a30, accent: 0xc9a2ff, skin: 0xcda78f }
};

/* 材质定义：颜色由职业调色板给，参数固定，便于做材质表 */
var MATDEF = {
  armor:  { rough: 0.42, metal: 0.50, name: '甲',  tex: '1024 图集 / 无细节贴图' },
  cloth:  { rough: 0.82, metal: 0.08, name: '衣',  tex: '1024 图集 / 布纹' },
  skin:   { rough: 0.62, metal: 0.00, name: '肤',  tex: '512 / 面部与手' },
  accent: { rough: 0.20, metal: 0.10, name: '缀',  tex: '发光，无贴图' },
  steel:  { rough: 0.24, metal: 0.90, name: '刃',  tex: '512 / 刃口高光条' }
};

function mk(color, d) {
  return new THREE.MeshStandardMaterial({
    color: color, roughness: d.rough, metalness: d.metal
  });
}

function materials(kind) {
  var P = PALETTES[kind];
  return {
    armor: mk(P.armor, MATDEF.armor),
    cloth: mk(P.cloth, MATDEF.cloth),
    skin: mk(P.skin, MATDEF.skin),
    accent: new THREE.MeshBasicMaterial({ color: P.accent }),
    steel: mk(0xc6d4e2, MATDEF.steel)
  };
}

/* ---------------- 骨骼 ---------------- */
var BONE_NAMES = [
  'root', 'hips', 'spine01', 'spine02', 'neck', 'head',
  'clav_L', 'upperarm_L', 'forearm_L', 'hand_L',
  'clav_R', 'upperarm_R', 'forearm_R', 'hand_R',
  'thigh_L', 'calf_L', 'foot_L', 'thigh_R', 'calf_R', 'foot_R'
];

function bone(name, pos, parent) {
  var b = new THREE.Bone();
  b.name = name;
  b.position.set(pos[0], pos[1], pos[2]);
  if (parent) parent.add(b);
  return b;
}

function makeSkeleton() {
  var B = {};
  B.root = bone('root', [0, 0, 0], null);
  B.hips = bone('hips', [0, 0.92, 0], B.root);
  B.spine01 = bone('spine01', [0, 0.10, 0], B.hips);
  B.spine02 = bone('spine02', [0, 0.16, 0], B.spine01);
  B.neck = bone('neck', [0, 0.16, 0], B.spine02);
  B.head = bone('head', [0, 0.08, 0], B.neck);

  [['L', 1], ['R', -1]].forEach(function (s) {
    var side = s[0], k = s[1];
    B['clav_' + side] = bone('clav_' + side, [0.055 * k, 0.125, 0], B.spine02);
    B['upperarm_' + side] = bone('upperarm_' + side, [0.135 * k, 0, 0], B['clav_' + side]);
    B['forearm_' + side] = bone('forearm_' + side, [0, -0.28, 0], B['upperarm_' + side]);
    B['hand_' + side] = bone('hand_' + side, [0, -0.26, 0], B['forearm_' + side]);

    B['thigh_' + side] = bone('thigh_' + side, [0.095 * k, 0, 0], B.hips);
    B['calf_' + side] = bone('calf_' + side, [0, -0.42, 0], B['thigh_' + side]);
    B['foot_' + side] = bone('foot_' + side, [0, -0.42, 0], B['calf_' + side]);
  });
  return B;
}

/* ---------------- 部件 ---------------- */
function part(parent, key, makeGeo, mat, pos, rot) {
  var m = new THREE.Mesh(g(key, makeGeo), mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

function buildBody(B, M, kind) {
  var grp = new THREE.Group();
  var SK = M.skin, CL = M.cloth, AR = M.armor, AC = M.accent;

  /* 旋转体：pts = [半径, y]，从下往上；zs = 侧向压扁（人体截面不是正圆）；
     phiStart/phiLen 用于开衩裙片（缺省为整圈） */
  function pl(parent, key, pts, seg, mat, zs, pos, rot, phiStart, phiLen) {
    var geo = g(key, function () {
      return new THREE.LatheGeometry(
        pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }),
        seg, phiStart || 0, phiLen || Math.PI * 2);
    });
    var m = new THREE.Mesh(geo, mat);
    if (zs) m.scale.z = zs;
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    parent.add(m);
    return m;
  }
  /* 关节接缝环：对应基体网格的肘/腕/膝/踝环线 */
  function seam(parent, key, r, y, mat) {
    var m = new THREE.Mesh(g(key, function () { return new THREE.TorusGeometry(r, 0.0065, 4, 18); }), mat);
    m.position.y = y;
    m.rotation.x = Math.PI / 2;
    parent.add(m);
    return m;
  }
  function blob(parent, key, r, pos, scl, mat, seg) {
    var m = new THREE.Mesh(g(key, function () { return new THREE.SphereGeometry(r, seg || 12, (seg || 12) - 2); }), mat);
    if (scl) m.scale.set(scl[0], scl[1], scl[2]);
    m.position.set(pos[0], pos[1], pos[2]);
    parent.add(m);
    return m;
  }

  var male = kind !== 'warlock';
  var hipW = male ? 0.160 : 0.172;

  /* ---------- 躯干：骨盆 / 腰 / 胸（吃 spine01 0.92→1.02、spine02 1.18、neck 1.34） ---------- */
  pl(B.hips, 'h_pelvis',
    [[0.055, -0.150], [0.112, -0.138], [0.144, -0.104], [hipW, -0.052], [hipW - 0.003, 0.0], [0.146, 0.052], [0.112, 0.080]],
    12, CL, 0.80);

  pl(B.spine01, 'h_waist',
    male ? [[0.140, -0.112], [0.136, -0.050], [0.134, 0.020], [0.146, 0.090], [0.156, 0.120]]
         : [[0.148, -0.112], [0.122, -0.050], [0.119, 0.020], [0.136, 0.090], [0.150, 0.120]],
    12, CL, 0.76);
  seam(B.spine01, 's_waist', 0.132, 0.030, AR);

  pl(B.spine02, 'h_chest', male
    ? [[0.150, -0.112], [0.174, -0.028], [0.188, 0.040], [0.192, 0.092], [0.176, 0.138], [0.142, 0.164], [0.086, 0.176]]
    : [[0.146, -0.112], [0.164, -0.028], [0.176, 0.040], [0.178, 0.092], [0.162, 0.138], [0.130, 0.162], [0.080, 0.174]],
    12, CL, 0.72);

  if (!male) {
    ['L', 'R'].forEach(function (side) {
      var k = side === 'L' ? 1 : -1;
      blob(B.spine02, 'h_bust', 0.058, [0.052 * k, 0.062, -0.100], [1.0, 0.92, 0.72], CL, 10);
    });
  }
  // 斜方肌：把胸顶与颈根接上，避免肩膀陡然收成细柱
  part(B.spine02, 'p_trap', function () { return new THREE.CylinderGeometry(0.054, 0.100, 0.048, 10); }, CL, [0, 0.170, 0.002]);
  part(B.spine02, 'p_plate', function () { return new THREE.BoxGeometry(0.094, 0.016, 0.012); }, AC, [0, 0.074, -0.146]);

  /* ---------- 颈 / 头 ---------- */
  part(B.neck, 'p_neck', function () { return new THREE.CylinderGeometry(0.046, 0.052, 0.10, 10); }, SK, [0, 0.03, 0]);
  var head = part(B.head, 'p_head', function () { return new THREE.SphereGeometry(0.098, 14, 12); }, SK, [0, 0.072, 0]);
  head.scale.set(0.90, 1.06, 0.94);
  part(B.head, 'p_jaw', function () { return new THREE.SphereGeometry(0.068, 12, 10); }, SK, [0, 0.020, -0.014]).scale.set(0.88, 0.64, 0.90);
  part(B.head, 'p_nose', function () { return new THREE.ConeGeometry(0.016, 0.034, 8); }, SK, [0, 0.062, -0.092], [Math.PI * 0.52, 0, 0]);
  ['L', 'R'].forEach(function (side) {
    var k = side === 'L' ? 1 : -1;
    part(B.head, 'p_ear', function () { return new THREE.SphereGeometry(0.024, 8, 6); }, SK, [0.086 * k, 0.078, -0.004]).scale.set(0.28, 0.80, 0.55);
    // 眉 / 眼 / 唇：只做低模起伏，不做瞳孔
    part(B.head, 'p_brow', function () { return new THREE.BoxGeometry(0.032, 0.005, 0.005); }, CL, [0.037 * k, 0.094, -0.085], [0, 0, -0.12 * k]);
    part(B.head, 'p_eye', function () { return new THREE.BoxGeometry(0.028, 0.007, 0.006); }, CL, [0.036 * k, 0.078, -0.088]);
    part(B.head, 'p_browRidge', function () { return new THREE.BoxGeometry(0.040, 0.020, 0.024); }, SK, [0.038 * k, 0.100, -0.062]);
  });
  part(B.head, 'p_mouth', function () { return new THREE.BoxGeometry(0.028, 0.005, 0.005); }, CL, [0, 0.032, -0.083]);

  /* ---------- 四肢 ---------- */
  ['L', 'R'].forEach(function (side) {
    var k = side === 'L' ? 1 : -1;

    blob(B['clav_' + side], 'h_delt', 0.056, [0.006 * k, 0.004, 0], [1.0, 0.96, 0.90], CL, 10);
    if (kind === 'gunner') {
      part(B['clav_' + side], 'p_padBroad', function () { return new THREE.BoxGeometry(0.13, 0.055, 0.175); }, AR, [0.012 * k, 0.030, 0], [0, 0, -0.20 * k]);
    } else if (kind === 'swordsman') {
      part(B['clav_' + side], 'p_padSlim', function () { return new THREE.ConeGeometry(0.072, 0.15, 6); }, AR, [0.018 * k, 0.026, 0], [0, 0, -Math.PI / 2 * k]);
    } else {
      blob(B['clav_' + side], 'h_padRobe', 0.066, [0.004 * k, 0.012, 0], [1.0, 0.9, 0.95], CL, 10);
    }

    pl(B['upperarm_' + side], 'h_upperarm',
      [[0, -0.282], [0.030, -0.268], [0.043, -0.220], [0.049, -0.150], [0.045, -0.060], [0.041, 0.0]],
      12, kind === 'swordsman' ? SK : CL, 0.94);
    seam(B['upperarm_' + side], 's_elbowTop', 0.040, -0.270, AR);
    // 剑客无袖：短袖口收在三角肌下缘
    if (kind === 'swordsman') {
      part(B['upperarm_' + side], 'p_sleeve', function () { return new THREE.CylinderGeometry(0.050, 0.047, 0.070, 10); }, CL, [0, -0.040, 0]);
    }

    pl(B['forearm_' + side], 'h_forearm',
      [[0, -0.262], [0.027, -0.248], [0.039, -0.190], [0.040, -0.128], [0.033, -0.042], [0.030, 0.0]],
      12, CL, 0.90);
    part(B['forearm_' + side], 'p_cuff', function () { return new THREE.CylinderGeometry(0.039, 0.034, 0.062, 10); }, AR, [0, -0.212, 0]);
    seam(B['forearm_' + side], 's_wrist', 0.031, -0.258, AR);

    part(B['hand_' + side], 'p_palm', function () { return new THREE.BoxGeometry(0.052, 0.064, 0.032); }, SK, [0, -0.030, 0]);
    part(B['hand_' + side], 'p_fingers', function () { return new THREE.BoxGeometry(0.048, 0.054, 0.028); }, SK, [0, -0.086, 0.002]);
    part(B['hand_' + side], 'p_thumb', function () { return new THREE.BoxGeometry(0.018, 0.038, 0.019); }, SK, [0.031 * k, -0.036, -0.006], [0, 0, -0.35 * k]);

    pl(B['thigh_' + side], 'h_thigh',
      [[0, -0.420], [0.050, -0.404], [0.070, -0.330], [0.079, -0.240], [0.077, -0.140], [0.071, -0.040], [0.067, 0.0]],
      12, kind === 'warlock' ? CL : AR, 0.90);
    seam(B['thigh_' + side], 's_kneeTop', 0.056, -0.404, AR);

    pl(B['calf_' + side], 'h_calf',
      [[0, -0.418], [0.030, -0.404], [0.046, -0.340], [0.058, -0.240], [0.050, -0.120], [0.040, -0.020], [0.038, 0.0]],
      12, CL, 0.90);
    seam(B['calf_' + side], 's_ankle', 0.033, -0.404, AR);

    // 脚：加长加宽到 0.20 级，前掌外撇一点，避免小脚桩
    part(B['foot_' + side], 'p_footBase', function () { return new THREE.BoxGeometry(0.090, 0.058, 0.200); }, CL, [0, -0.022, -0.058]);
    part(B['foot_' + side], 'p_toe', function () { return new THREE.SphereGeometry(0.046, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6); }, CL, [0, -0.022, -0.150], [Math.PI * 0.5, 0, 0]).scale.set(1.02, 0.66, 1.0);
    part(B['foot_' + side], 'p_heel', function () { return new THREE.SphereGeometry(0.044, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55); }, CL, [0, -0.016, 0.036], [Math.PI * 0.5, 0, 0]).scale.set(1.0, 0.8, 1.0);
  });

  /* ---------- 职业特征件 ---------- */
  if (kind === 'swordsman') {
    // 发：scalp 覆盖头顶后脑 + 发髻 + 后垂马尾
    var scalp = part(B.head, 'p_scalp', function () { return new THREE.SphereGeometry(0.109, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.42); }, CL, [0, 0.080, 0.008], [0.10, 0, 0]);
    scalp.scale.set(0.92, 1.00, 0.95);
    blob(B.head, 'p_bun', 0.048, [0, 0.142, 0.048], [1, 0.95, 1], CL, 10);
    part(B.head, 'p_tail', function () { return new THREE.ConeGeometry(0.038, 0.36, 7); }, CL, [0, 0.126, 0.104], [-2.35, 0, 0]);
    // 额侧小标记，替代原来横贯面部的发光条（那条读成蒙眼带）
    ['L', 'R'].forEach(function (side) {
      var k = side === 'L' ? 1 : -1;
      part(B.head, 'p_mark', function () { return new THREE.BoxGeometry(0.020, 0.005, 0.008); }, AC, [0.070 * k, 0.100, -0.052], [0, 0.30 * k, 0]);
    });
  } else if (kind === 'gunner') {
    // 护目镜：一条带 + 两片镜片，别做成一整块横条
    part(B.head, 'p_goggle', function () { return new THREE.BoxGeometry(0.132, 0.028, 0.018); }, AR, [0, 0.078, -0.082]);
    ['L', 'R'].forEach(function (side) {
      var k = side === 'L' ? 1 : -1;
      part(B.head, 'p_lens', function () { return new THREE.BoxGeometry(0.050, 0.020, 0.010); }, AC, [0.030 * k, 0.078, -0.090]);
    });
    part(B.head, 'p_helm', function () { return new THREE.SphereGeometry(0.104, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.40); }, AR, [0, 0.082, 0.004]);
  } else {
    part(B.head, 'p_hood', function () { return new THREE.SphereGeometry(0.118, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.44); }, CL, [0, 0.086, 0.012], [0.10, 0, 0]);
    blob(B.head, 'p_hoodBack', 0.128, [0, 0.062, 0.052], [1.0, 1.05, 1.0], CL, 12);

    pl(B.spine02, 'p_robeTop',
      [[0.150, -0.240], [0.178, -0.120], [0.190, -0.010], [0.170, 0.100], [0.120, 0.170]],
      14, CL, 0.84, [0, 0, 0]);
  }

  /* 长袍：两片侧裙，前后留开衩，走路能看见腿 */
  if (kind === 'warlock') {
    var RPTS = [[0.286, -0.790], [0.272, -0.720], [0.240, -0.580], [0.212, -0.420], [0.196, -0.240], [0.190, -0.060], [0.184, 0.0]];
    pl(B.hips, 'p_robeA', RPTS, 10, CL, 0.86, [0, 0, 0], [0, 0, 0], Math.PI * 0.09, Math.PI * 0.82);
    pl(B.hips, 'p_robeB', RPTS, 10, CL, 0.86, [0, 0, 0], [0, 0, 0], Math.PI * 1.09, Math.PI * 0.82);
  }

  grp.userData.bones = B;
  return grp;
}

/* ---------------- 武器 ---------------- */
function buildWeapon(kind, M) {
  var w = new THREE.Group();
  if (kind === 'swordsman') {
    // 长刀：刃长 0.95，柄 0.22
    var blade = new THREE.Mesh(g('w_katana', function () { return new THREE.BoxGeometry(0.042, 0.95, 0.022); }), M.steel);
    blade.position.set(0, 0.52, 0);
    w.add(blade);
    var edge = new THREE.Mesh(g('w_katanaEdge', function () { return new THREE.BoxGeometry(0.009, 0.95, 0.010); }), M.accent);
    edge.position.set(-0.024, 0, 0.010);
    blade.add(edge);
    var guard = new THREE.Mesh(g('w_guard', function () { return new THREE.BoxGeometry(0.10, 0.018, 0.05); }), M.armor);
    guard.position.set(0, 0.02, 0);
    w.add(guard);
    var grip = new THREE.Mesh(g('w_grip', function () { return new THREE.CylinderGeometry(0.018, 0.018, 0.22, 6); }), M.cloth);
    grip.position.set(0, -0.10, 0);
    w.add(grip);
    w.userData.len = 1.17;
  } else if (kind === 'gunner') {
    // 长枪：全长 1.45
    var body = new THREE.Mesh(g('w_lanceBody', function () { return new THREE.BoxGeometry(0.075, 0.10, 0.62); }), M.armor);
    body.position.set(0, 0, -0.16);
    w.add(body);
    var barrel = new THREE.Mesh(g('w_lanceBarrel', function () { return new THREE.CylinderGeometry(0.026, 0.026, 0.52, 8); }), M.steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, -0.55);
    w.add(barrel);
    var stock = new THREE.Mesh(g('w_lanceStock', function () { return new THREE.BoxGeometry(0.055, 0.10, 0.22); }), M.cloth);
    stock.position.set(0, -0.01, 0.22);
    w.add(stock);
    var muzzle = new THREE.Mesh(g('w_muzzle', function () { return new THREE.SphereGeometry(0.03, 8, 6); }), M.accent);
    muzzle.position.set(0, 0.015, -0.80);
    w.add(muzzle);
    w.userData.len = 1.45;
  } else {
    // 法杖：杆 1.45，法球 Ø0.14
    var rod = new THREE.Mesh(g('w_rod', function () { return new THREE.CylinderGeometry(0.024, 0.019, 1.45, 8); }), M.armor);
    rod.position.set(0, 0.10, 0);
    w.add(rod);
    var orb = new THREE.Mesh(g('w_orb', function () { return new THREE.SphereGeometry(0.07, 10, 8); }), M.accent);
    orb.position.set(0, 0.84, 0);
    w.add(orb);
    var halo = new THREE.Mesh(g('w_halo', function () { return new THREE.TorusGeometry(0.105, 0.010, 4, 14); }), M.accent);
    halo.position.set(0, 0.84, 0);
    halo.rotation.set(1.2, 0.3, 0);
    w.add(halo);
    w.userData.len = 1.60;
  }
  return w;
}

/* ---------------- 装配 ---------------- */
function buildRig(kind) {
  var M = materials(kind);
  var B = makeSkeleton();
  var root = new THREE.Group();
  root.add(B.root);
  buildBody(B, M, kind);
  root.scale.set(1, 1, 1);

  var weapon = buildWeapon(kind, M);
  weapon.position.set(0, -0.035, 0);
  weapon.rotation.set(kind === 'swordsman' ? -0.35 : 0, 0, 0);
  B.hand_R.add(weapon);

  root.userData = { kind: kind, bones: B, mats: M, weapon: weapon };
  return root;
}

/* ---------------- 姿势库 ----------------
   pose 格式：{ rootY, rootRX, bone: [rx, ry, rz] }
   -------------------------------------------------- */
function applyPose(obj, pose) {
  var B = obj.userData.bones;
  var baseY = 0.92;
  B.root.position.y = (pose.rootY || 0);
  B.root.rotation.set(pose.rootRX || 0, 0, 0);
  for (var name in B) {
    if (name === 'root') continue;
    var p = pose[name];
    if (p) B[name].rotation.set(p[0], p[1], p[2]);
    else B[name].rotation.set(0, 0, 0);
  }
}

var P = function (o) { return o; };

var ACTIONS = {
  idle: {
    cn: '待机', fps: 12, frames: 6,
    keys: [
      P({ spine01: [0.02, 0, 0], spine02: [-0.03, 0, 0], head: [0.02, 0, 0], upperarm_L: [0.08, 0, 0.10], upperarm_R: [0.08, 0, -0.10], forearm_L: [-0.16, 0, 0], forearm_R: [-0.16, 0, 0] }),
      P({ spine01: [0.03, 0, 0], spine02: [-0.05, 0, 0], head: [0.03, 0, 0], upperarm_L: [0.10, 0, 0.10], upperarm_R: [0.10, 0, -0.10], forearm_L: [-0.20, 0, 0], forearm_R: [-0.20, 0, 0] })
    ]
  },
  run: {
    cn: '跑动', fps: 12, frames: 8,
    keys: [
      P({ rootY: 0.02, rootRX: 0.10, thigh_L: [-0.75, 0, 0], calf_L: [0.55, 0, 0], thigh_R: [0.55, 0, 0], calf_R: [0.20, 0, 0], upperarm_L: [0.45, 0, 0], forearm_L: [-1.10, 0, 0], upperarm_R: [-0.30, 0, -0.10], forearm_R: [-0.55, 0, 0], hand_R: [0.72, 0, 0.30], spine02: [0.10, 0.06, 0] }),
      P({ rootY: 0.05, rootRX: 0.10, thigh_L: [-0.15, 0, 0], calf_L: [0.30, 0, 0], thigh_R: [0.10, 0, 0], calf_R: [0.65, 0, 0], upperarm_L: [0.15, 0, 0], forearm_L: [-1.05, 0, 0], upperarm_R: [-0.25, 0, -0.10], forearm_R: [-0.60, 0, 0], hand_R: [0.72, 0, 0.30], spine02: [0.10, 0, 0] }),
      P({ rootY: 0.02, rootRX: 0.10, thigh_L: [0.55, 0, 0], calf_L: [0.20, 0, 0], thigh_R: [-0.75, 0, 0], calf_R: [0.55, 0, 0], upperarm_L: [-0.55, 0, 0], forearm_L: [-1.00, 0, 0], upperarm_R: [-0.35, 0, -0.10], forearm_R: [-0.50, 0, 0], hand_R: [0.72, 0, 0.30], spine02: [0.10, -0.06, 0] })
    ]
  },
  sprint: {
    cn: '疾跑', fps: 14, frames: 8,
    keys: [
      P({ rootY: 0.03, rootRX: 0.24, thigh_L: [-1.00, 0, 0], calf_L: [0.85, 0, 0], thigh_R: [0.75, 0, 0], calf_R: [0.25, 0, 0], upperarm_L: [0.70, 0, 0.12], forearm_L: [-1.35, 0, 0], upperarm_R: [-0.45, 0, -0.12], forearm_R: [-0.75, 0, 0], hand_R: [0.86, 0, 0.34], spine02: [0.16, 0.05, 0], head: [-0.10, 0, 0] }),
      P({ rootY: 0.07, rootRX: 0.24, thigh_L: [-0.20, 0, 0], calf_L: [0.45, 0, 0], thigh_R: [0.05, 0, 0], calf_R: [0.95, 0, 0], upperarm_L: [0.25, 0, 0.12], forearm_L: [-1.30, 0, 0], upperarm_R: [-0.40, 0, -0.12], forearm_R: [-0.80, 0, 0], hand_R: [0.86, 0, 0.34], spine02: [0.16, 0, 0], head: [-0.10, 0, 0] }),
      P({ rootY: 0.03, rootRX: 0.24, thigh_L: [0.75, 0, 0], calf_L: [0.25, 0, 0], thigh_R: [-1.00, 0, 0], calf_R: [0.85, 0, 0], upperarm_L: [-0.80, 0, 0.12], forearm_L: [-1.25, 0, 0], upperarm_R: [-0.50, 0, -0.12], forearm_R: [-0.70, 0, 0], hand_R: [0.86, 0, 0.34], spine02: [0.16, -0.05, 0], head: [-0.10, 0, 0] })
    ]
  },
  jump: {
    cn: '跳跃', fps: 16, frames: 8,
    keys: [
      P({ rootY: -0.10, rootRX: 0.12, thigh_L: [-0.55, 0, 0], calf_L: [0.95, 0, 0], thigh_R: [-0.55, 0, 0], calf_R: [0.95, 0, 0], upperarm_L: [0.30, 0, 0.15], forearm_L: [-0.90, 0, 0], upperarm_R: [0.30, 0, -0.15], forearm_R: [-0.90, 0, 0], hand_R: [0.62, 0, 0.26], spine02: [0.18, 0, 0] }),
      P({ rootY: 0.18, rootRX: -0.05, thigh_L: [-0.15, 0, 0], calf_L: [0.10, 0, 0], thigh_R: [-0.15, 0, 0], calf_R: [0.10, 0, 0], upperarm_L: [-0.55, 0, 0.10], forearm_L: [-0.35, 0, 0], upperarm_R: [-0.55, 0, -0.10], forearm_R: [-0.35, 0, 0], hand_R: [0.66, 0, 0.24], spine02: [-0.10, 0, 0] }),
      P({ rootY: 0.55, rootRX: -0.12, thigh_L: [-0.35, 0, 0], calf_L: [0.50, 0, 0], thigh_R: [-0.20, 0, 0], calf_R: [0.35, 0, 0], upperarm_L: [-0.80, 0, 0.18], forearm_L: [-0.55, 0, 0], upperarm_R: [-0.70, 0, -0.18], forearm_R: [-0.45, 0, 0], hand_R: [0.70, 0, 0.22], spine02: [-0.14, 0, 0], head: [-0.06, 0, 0] }),
      P({ rootY: 0.10, rootRX: 0.14, thigh_L: [-0.45, 0, 0], calf_L: [0.55, 0, 0], thigh_R: [-0.45, 0, 0], calf_R: [0.55, 0, 0], upperarm_L: [0.20, 0, 0.20], forearm_L: [-0.70, 0, 0], upperarm_R: [0.20, 0, -0.20], forearm_R: [-0.70, 0, 0], hand_R: [0.64, 0, 0.26], spine02: [0.16, 0, 0] }),
      P({ rootY: -0.14, rootRX: 0.20, thigh_L: [-0.80, 0, 0], calf_L: [1.10, 0, 0], thigh_R: [-0.80, 0, 0], calf_R: [1.10, 0, 0], upperarm_L: [0.45, 0, 0.22], forearm_L: [-1.00, 0, 0], upperarm_R: [0.45, 0, -0.22], forearm_R: [-1.00, 0, 0], hand_R: [0.60, 0, 0.28], spine02: [0.24, 0, 0], head: [0.10, 0, 0] })
    ]
  },
  attack: {
    cn: '攻击（斜劈横斩）', fps: 18, frames: 8,
    keys: [
      // 起手：右臂外张后引，刀口向上，重心压后腿
      P({ rootRX: 0.06, spine02: [0.04, 0.32, 0], upperarm_R: [-0.05, 0, -1.00], forearm_R: [-0.80, 0, 0], hand_R: [0.25, 0, 0.45], upperarm_L: [0.35, 0, 0.28], forearm_L: [-0.70, 0, 0], thigh_L: [-0.28, 0, 0], thigh_R: [0.22, 0, 0], head: [0.02, 0.20, 0] }),
      // 走刀：右臂扫至正前，脊柱反拧，刀刃朝外
      P({ rootRX: 0.10, spine02: [0.06, -0.30, 0], upperarm_R: [0.35, 0, -0.85], forearm_R: [-0.40, 0, 0], hand_R: [0.25, 0, 0.50], upperarm_L: [0.20, 0, 0.18], forearm_L: [-0.55, 0, 0], thigh_L: [-0.48, 0, 0], thigh_R: [0.38, 0, 0], head: [0.04, -0.18, 0] }),
      // 收势：刀走完弧线停在身前偏左，肩先停、刀梢余摆
      P({ rootRX: 0.04, spine02: [0.02, -0.55, 0], upperarm_R: [0.70, 0, -0.45], forearm_R: [-0.28, 0, 0], hand_R: [0.25, 0, 0.55], upperarm_L: [0.10, 0, 0.12], forearm_L: [-0.45, 0, 0], thigh_L: [-0.22, 0, 0], thigh_R: [0.16, 0, 0], head: [0.02, -0.30, 0] })
    ]
  },
  skill: {
    cn: '技能释放（法球）', fps: 16, frames: 8,
    keys: [
      P({ rootY: -0.03, rootRX: 0.05, spine01: [0.04, 0, 0], spine02: [0.10, 0, 0], upperarm_L: [0.20, 0, 0.25], forearm_L: [-0.90, 0, 0], upperarm_R: [-0.90, 0, -0.20], forearm_R: [-1.30, 0, 0], hand_R: [0.85, 0, 0.55], head: [0.10, 0, 0], thigh_L: [-0.18, 0, 0], thigh_R: [0.10, 0, 0] }),
      P({ rootY: 0.02, rootRX: -0.04, spine01: [-0.02, 0, 0], spine02: [-0.12, 0, 0], upperarm_L: [-1.05, 0, 0.30], forearm_L: [-0.35, 0, 0], upperarm_R: [-0.40, 0, -0.55], forearm_R: [-0.20, 0, 0], hand_R: [1.00, 0, 0.40], head: [-0.14, 0, 0], thigh_L: [-0.05, 0, 0], thigh_R: [-0.05, 0, 0] }),
      P({ rootY: 0.00, rootRX: -0.02, spine01: [-0.01, 0, 0], spine02: [-0.06, 0, 0], upperarm_L: [-0.75, 0, 0.25], forearm_L: [-0.45, 0, 0], upperarm_R: [-0.25, 0, -0.45], forearm_R: [-0.35, 0, 0], hand_R: [0.90, 0, 0.45] })
    ]
  }
};

var RESTPOSE = {
  upperarm_L: [0, 0, 0.34], upperarm_R: [0, 0, -0.34],
  forearm_L: [-0.10, 0, 0.06], forearm_R: [-0.10, 0, -0.06],
  thigh_L: [0, 0, 0.03], thigh_R: [0, 0, -0.03]
};

/* 关键帧插值：输出 frames 帧，形成连贯帧 */
function sampleAction(actionKey, frameIndex) {
  var A = ACTIONS[actionKey];
  var f = frameIndex % A.frames;
  var t = f / A.frames;
  var n = A.keys.length;
  var segT = t * n;
  var i = Math.floor(segT) % n;
  var j = (i + 1) % n;
  var k = segT - Math.floor(segT);

  var out = {};
  var a = A.keys[i], b = A.keys[j];
  for (var name in a) {
    if (typeof a[name] === 'number') { out[name] = a[name] + ((b[name] === undefined ? a[name] : b[name]) - a[name]) * k; continue; }
    var av = a[name], bv = b[name] || av;
    out[name] = [av[0] + (bv[0] - av[0]) * k, av[1] + (bv[1] - av[1]) * k, av[2] + (bv[2] - av[2]) * k];
  }
  for (var nb in b) {
    if (out[nb] !== undefined) continue;
    if (typeof b[nb] === 'number') out[nb] = b[nb];
    else out[nb] = b[nb].slice();
  }
  return out;
}

/* 骨骼连线：用于骨架图 */
function skeletonLines(obj) {
  var B = obj.userData.bones;
  var segs = [];
  var pairs = [
    ['hips', 'spine01'], ['spine01', 'spine02'], ['spine02', 'neck'], ['neck', 'head'],
    ['spine02', 'clav_L'], ['clav_L', 'upperarm_L'], ['upperarm_L', 'forearm_L'], ['forearm_L', 'hand_L'],
    ['spine02', 'clav_R'], ['clav_R', 'upperarm_R'], ['upperarm_R', 'forearm_R'], ['forearm_R', 'hand_R'],
    ['hips', 'thigh_L'], ['thigh_L', 'calf_L'], ['calf_L', 'foot_L'],
    ['hips', 'thigh_R'], ['thigh_R', 'calf_R'], ['calf_R', 'foot_R'],
    ['root', 'hips']
  ];
  obj.updateMatrixWorld(true);
  pairs.forEach(function (p) {
    var a = new THREE.Vector3().setFromMatrixPosition(B[p[0]].matrixWorld);
    var b = new THREE.Vector3().setFromMatrixPosition(B[p[1]].matrixWorld);
    segs.push([a, b]);
  });
  return segs;
}

window.ArenaRig = {
  buildRig: buildRig, applyPose: applyPose, sampleAction: sampleAction,
  ACTIONS: ACTIONS, BONE_NAMES: BONE_NAMES, MATDEF: MATDEF, PALETTES: PALETTES,
  buildWeapon: buildWeapon, materials: materials, skeletonLines: skeletonLines, RESTPOSE: RESTPOSE
};

})();
