/* ============================================================
   第七竞技场 · 美术资产（白露）
   低模人形角色：几何与材质按类型共享，避免每只怪重复分配显存
   形象方向：按原著职业气质重构剪影（轻甲剑客 / 重装枪炮师 / 长袍术士 /
   精英与首领按体量与披风做层级），不使用任何官方立绘或角色姓名
   ============================================================ */
(function () {
'use strict';

const GEO = {};
const MAT = {};

/* 共享几何 */
function g(key, make) {
  if (!GEO[key]) {
    GEO[key] = make();
    GEO[key].userData.shared = true;
  }
  return GEO[key];
}

/* 共享材质 */
function m(key, make) {
  if (!MAT[key]) {
    MAT[key] = make();
    if (!MAT[key].userData) MAT[key].userData = {};
    MAT[key].userData.shared = true;
  }
  return MAT[key];
}

function std(color, emissive, rough, metal) {
  return new THREE.MeshStandardMaterial({
    color: color,
    emissive: emissive === undefined ? 0x000000 : emissive,
    roughness: rough === undefined ? 0.5 : rough,
    metalness: metal === undefined ? 0.3 : metal
  });
}

function glow(color) {
  return new THREE.MeshBasicMaterial({ color: color });
}

/* 每个类型的配色与装备（白露的资产表）
   明度拉开：甲亮、衣暗、职业色发光，保证在暗场里也能读出剪影 */
const KITS = {
  grunt: {
    armor: 0x496a8c, cloth: 0x1b2b3d, accent: 0xff5c72,
    weapon: 'sword', scale: 1.00, cloak: false, crest: false
  },
  shooter: {
    armor: 0x8a6a34, cloth: 0x2c2114, accent: 0xffcf6b,
    weapon: 'rifle', scale: 1.02, cloak: false, crest: false
  },
  elite: {
    armor: 0x9c5128, cloth: 0x35200f, accent: 0xff9a6b,
    weapon: 'greatsword', scale: 1.24, cloak: true, crest: true
  },
  boss: {
    armor: 0x7c1c2b, cloth: 0x2e0a12, accent: 0xff3860,
    weapon: 'greatsword', scale: 1.85, cloak: true, crest: true
  },
  duelist: {
    armor: 0x1d6560, cloth: 0x0b2a26, accent: 0x2ee6c0,
    weapon: 'rifle', scale: 1.04, cloak: false, crest: false
  }
};

function mats(type) {
  const K = KITS[type] || KITS.grunt;
  const A = m('armor_' + type, () => std(K.armor, 0x0a1018, 0.4, 0.45));
  const C = m('cloth_' + type, () => std(K.cloth, 0x000000, 0.8, 0.1));
  const G = m('accent_' + type, () => glow(K.accent));

  // 每具身体持有一份材质副本：受击闪红只作用于自己，不会被同伴一起点亮；
  // 标记为非共享，销毁时由 disposeGroup 正常释放
  const armor = A.clone();
  const cloth = C.clone();
  const accent = G.clone();
  armor.userData = { shared: false };
  cloth.userData = { shared: false };
  accent.userData = { shared: false };
  const steel = STEEL.clone();
  steel.userData = { shared: false };

  return { K: K, armor: armor, cloth: cloth, accent: accent, steel: steel };
}

/* 武器钢面：作为模板共享，实际使用时会克隆 */
const STEEL = m('steel', () => std(0xc6d4e2, 0x131c26, 0.24, 0.9));

/* 武器：靠剪影区分职业 */
function addWeapon(grp, type, M) {
  const w = M.K.weapon;

  if (w === 'sword' || w === 'greatsword') {
    const big = w === 'greatsword';

    // 剑身：钢面 + 一道发光刃口
    const blade = new THREE.Mesh(
      big ? g('greatBlade', () => new THREE.BoxGeometry(0.11, 1.02, 0.042))
          : g('blade', () => new THREE.BoxGeometry(0.062, 0.76, 0.032)),
      M.steel
    );
    blade.position.set(0.38, 1.28, 0.06);
    blade.rotation.set(0.2, 0, -0.26);
    grp.add(blade);

    const edge = new THREE.Mesh(
      big ? g('greatEdge', () => new THREE.BoxGeometry(0.016, 1.02, 0.014))
          : g('bladeEdge', () => new THREE.BoxGeometry(0.012, 0.76, 0.012)),
      M.accent
    );
    edge.position.set(big ? -0.056 : -0.031, 0, 0.022);
    blade.add(edge);

    // 护手
    const guard = new THREE.Mesh(
      g('guard', () => new THREE.BoxGeometry(0.2, 0.035, 0.075)),
      M.armor
    );
    guard.position.set(0.3, 0.92, 0.03);
    guard.rotation.z = -0.26;
    grp.add(guard);

    // 握柄
    const grip = new THREE.Mesh(
      g('grip', () => new THREE.CylinderGeometry(0.024, 0.024, 0.18, 6)),
      M.cloth
    );
    grip.position.set(0.25, 0.84, 0.02);
    grip.rotation.z = -0.26;
    grp.add(grip);
  } else if (w === 'rifle') {
    const body = new THREE.Mesh(
      g('rifleBody', () => new THREE.BoxGeometry(0.09, 0.12, 0.52)),
      M.armor
    );
    body.position.set(0.31, 1.02, -0.2);
    grp.add(body);

    const barrel = new THREE.Mesh(
      g('rifleBarrel', () => new THREE.CylinderGeometry(0.03, 0.03, 0.44, 8)),
      M.armor
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.31, 1.03, -0.64);
    grp.add(barrel);

    const stock = new THREE.Mesh(
      g('rifleStock', () => new THREE.BoxGeometry(0.07, 0.14, 0.2)),
      M.cloth
    );
    stock.position.set(0.31, 1.0, 0.1);
    grp.add(stock);

    // 枪口能量点
    const dot = new THREE.Mesh(
      g('rifleDot', () => new THREE.SphereGeometry(0.032, 8, 8)),
      M.accent
    );
    dot.position.set(0.31, 1.03, -0.87);
    grp.add(dot);
  } else if (w === 'staff') {
    const rod = new THREE.Mesh(
      g('staffRod', () => new THREE.CylinderGeometry(0.03, 0.024, 1.1, 8)),
      M.cloth
    );
    rod.rotation.x = 1.22;
    rod.position.set(0.3, 1.02, -0.22);
    grp.add(rod);

    const orb = new THREE.Mesh(
      g('orb', () => new THREE.SphereGeometry(0.085, 12, 12)),
      M.accent
    );
    orb.position.set(0.3, 1.16, -0.72);
    grp.add(orb);
  }
}

function buildFighter(type) {
  const M = mats(type);
  const grp = new THREE.Group();

  // 腿（护腿用甲色，靴子加深）
  [-0.11, 0.11].forEach((x) => {
    const boot = new THREE.Mesh(g('boot', () => new THREE.BoxGeometry(0.17, 0.14, 0.28)), M.cloth);
    boot.position.set(x, 0.07, 0);
    grp.add(boot);
  });

  // 腿
  [-0.11, 0.11].forEach((x) => {
    const leg = new THREE.Mesh(g('leg', () => new THREE.CylinderGeometry(0.078, 0.066, 0.56, 6)), M.armor);
    leg.position.set(x, 0.4, 0);
    grp.add(leg);
  });

  // 裙甲与腰带
  const skirt = new THREE.Mesh(g('skirt', () => new THREE.BoxGeometry(0.42, 0.2, 0.3)), M.cloth);
  skirt.position.y = 0.7;
  grp.add(skirt);

  const belt = new THREE.Mesh(g('belt', () => new THREE.BoxGeometry(0.43, 0.07, 0.31)), M.armor);
  belt.position.y = 0.81;
  grp.add(belt);

  // 躯干
  const torso = new THREE.Mesh(g('torso', () => new THREE.CylinderGeometry(0.23, 0.285, 0.76, 8)), M.armor);
  torso.position.y = 1.05;
  grp.add(torso);

  // 胸前职业色发光条
  const plate = new THREE.Mesh(g('plate', () => new THREE.BoxGeometry(0.28, 0.12, 0.05)), M.accent);
  plate.position.set(0, 1.16, -0.25);
  grp.add(plate);

  // 双肩尖甲：锥体朝外，做出职业轮廓
  [-1, 1].forEach((s) => {
    const shoulder = new THREE.Mesh(g('shoulderSpike', () => new THREE.ConeGeometry(0.15, 0.28, 5)), M.armor);
    shoulder.position.set(0.3 * s, 1.4, 0);
    shoulder.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    grp.add(shoulder);
  });

  // 头（头盔色比衣服亮，避免黑头）
  const head = new THREE.Mesh(g('head', () => new THREE.SphereGeometry(0.155, 12, 10)), M.armor);
  head.position.y = 1.6;
  grp.add(head);

  // 面罩带
  const visor = new THREE.Mesh(g('visor', () => new THREE.BoxGeometry(0.21, 0.045, 0.035)), M.accent);
  visor.position.set(0, 1.61, -0.142);
  grp.add(visor);

  // 颈甲
  const neck = new THREE.Mesh(g('neck', () => new THREE.CylinderGeometry(0.09, 0.11, 0.1, 6)), M.cloth);
  neck.position.y = 1.46;
  grp.add(neck);

  // 双臂
  [-0.28, 0.28].forEach((x) => {
    const arm = new THREE.Mesh(g('arm', () => new THREE.CylinderGeometry(0.058, 0.05, 0.48, 6)), M.cloth);
    arm.position.set(x, 1.12, 0);
    grp.add(arm);
    // 护腕
    const cuff = new THREE.Mesh(g('cuff', () => new THREE.CylinderGeometry(0.068, 0.062, 0.1, 6)), M.armor);
    cuff.position.set(x, 0.94, 0);
    grp.add(cuff);
  });

  // 披风（精英与首领）
  if (M.K.cloak) {
    const cloak = new THREE.Mesh(g('cloak', () => new THREE.BoxGeometry(0.48, 0.72, 0.04)), M.cloth);
    cloak.position.set(0, 1.04, 0.26);
    cloak.rotation.x = -0.16;
    grp.add(cloak);
  }

  addWeapon(grp, type, M);

  // 头冠：精英一道，首领四尖
  if (M.K.crest) {
    const spike = g('spike', () => new THREE.ConeGeometry(0.05, 0.2, 5));
    const xs = type === 'boss' ? [-0.12, -0.04, 0.04, 0.12] : [0];
    xs.forEach((x) => {
      const s = new THREE.Mesh(spike, M.accent);
      s.position.set(x, type === 'boss' ? 1.78 : 1.74, -0.03);
      grp.add(s);
    });
  }

  // 敌方识别环（脚底）
  const ring = new THREE.Mesh(g('baseRing', () => new THREE.TorusGeometry(0.36, 0.035, 6, 20)), M.accent);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  grp.add(ring);
  grp.userData.baseRing = ring;
  grp.userData.ring = ring;

  grp.userData.kit = type;
  return grp;
}

function scaleOf(type) {
  return (KITS[type] || KITS.grunt).scale;
}

/* ============================================================
   玩家职业 · 全身展示模型（建模：Joe）
   用途：展示台、三视图、结算镜头。第一人称局内不加载。
   规格：单角色 ≤1400 三角面 / 3 个材质槽位 / 优先共享几何
   色相：玩家冷色系（月白 / 靛蓝 / 紫），与敌方暖色系分开；
        敌我识别的第一通道是敌方脚底识别环，颜色是第二通道。
   ============================================================ */
const HEROES = {
  swordsman: { armor: 0x8698a6, cloth: 0x22303a, accent: 0x7fd8ff, kind: 'slim' },
  gunner:    { armor: 0x2d4d78, cloth: 0x16222f, accent: 0x66d9ff, kind: 'broad' },
  warlock:   { armor: 0x4b3a78, cloth: 0x221a30, accent: 0xc9a2ff, kind: 'robe' }
};

function heroMats(type) {
  const H = HEROES[type];
  return {
    H: H,
    armor: m('hArmor_' + type, () => std(H.armor, 0x0d141c, 0.42, 0.5)),
    cloth: m('hCloth_' + type, () => std(H.cloth, 0x000000, 0.82, 0.08)),
    accent: m('hAccent_' + type, () => glow(H.accent))
  };
}

/* 玩家武器：三职业各一条独有长线 */
function addHeroWeapon(grp, kind, M) {
  if (kind === 'slim') {
    // 长刀：斜向前伸，是三视图里最长的一条线
    const blade = new THREE.Mesh(
      g('hKatana', () => new THREE.BoxGeometry(0.055, 1.18, 0.03)),
      M.armor
    );
    blade.position.set(0.46, 1.28, -0.26);
    blade.rotation.set(0.24, 0, -0.3);
    grp.add(blade);

    const edge = new THREE.Mesh(
      g('hKatanaEdge', () => new THREE.BoxGeometry(0.012, 1.18, 0.014)),
      M.accent
    );
    edge.position.set(-0.028, 0, 0.02);
    blade.add(edge);

    const guard = new THREE.Mesh(g('hGuard', () => new THREE.BoxGeometry(0.19, 0.03, 0.07)), M.armor);
    guard.position.set(0.36, 0.82, -0.17);
    guard.rotation.z = -0.3;
    grp.add(guard);

    const grip = new THREE.Mesh(g('hGrip', () => new THREE.CylinderGeometry(0.022, 0.022, 0.17, 6)), M.cloth);
    grip.position.set(0.32, 0.73, -0.14);
    grip.rotation.z = -0.3;
    grp.add(grip);
  } else if (kind === 'broad') {
    // 长枪：横置，长度压过肩宽
    const body = new THREE.Mesh(g('hLanceBody', () => new THREE.BoxGeometry(0.1, 0.15, 0.92)), M.armor);
    body.position.set(0.29, 1.02, -0.34);
    grp.add(body);

    const barrel = new THREE.Mesh(g('hLanceBarrel', () => new THREE.CylinderGeometry(0.032, 0.032, 0.7, 8)), M.armor);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.29, 1.05, -0.62);
    grp.add(barrel);

    const stock = new THREE.Mesh(g('hLanceStock', () => new THREE.BoxGeometry(0.08, 0.15, 0.24)), M.cloth);
    stock.position.set(0.29, 0.98, 0.1);
    grp.add(stock);

    const muzzle = new THREE.Mesh(g('hMuzzle', () => new THREE.SphereGeometry(0.042, 8, 6)), M.accent);
    muzzle.position.set(0.29, 1.05, -0.96);
    grp.add(muzzle);

    // 战术背带：一条斜切的点缀，枪手独有
    const strap = new THREE.Mesh(g('hStrap', () => new THREE.BoxGeometry(0.05, 0.52, 0.02)), M.accent);
    strap.position.set(0.02, 1.16, -0.2);
    strap.rotation.z = 0.42;
    grp.add(strap);
  } else {
    // 法杖 + 悬浮法球
    const rod = new THREE.Mesh(g('hRod', () => new THREE.CylinderGeometry(0.028, 0.022, 1.24, 8)), M.cloth);
    rod.rotation.x = 1.34;
    rod.position.set(0.31, 1.06, -0.24);
    grp.add(rod);

    const orb = new THREE.Mesh(g('hOrb', () => new THREE.SphereGeometry(0.09, 10, 8)), M.accent);
    orb.position.set(0.31, 1.24, -0.84);
    grp.add(orb);

    const halo = new THREE.Mesh(g('hHalo', () => new THREE.TorusGeometry(0.145, 0.014, 5, 16)), M.accent);
    halo.position.set(0.31, 1.24, -0.84);
    halo.rotation.set(1.15, 0.25, 0);
    grp.add(halo);
  }
}

function buildHero(type) {
  const M = heroMats(type);
  const H = M.H;
  const grp = new THREE.Group();
  const slim = H.kind === 'slim';
  const broad = H.kind === 'broad';
  const robe = H.kind === 'robe';

  // 腿与靴：术士用长袍遮住，不做腿，省面数
  if (!robe) {
    [-0.12, 0.12].forEach((x) => {
      const boot = new THREE.Mesh(g('hBoot', () => new THREE.BoxGeometry(0.18, 0.13, 0.3)), M.cloth);
      boot.position.set(x, 0.065, -0.02);
      grp.add(boot);

      const leg = new THREE.Mesh(g('hLeg', () => new THREE.CylinderGeometry(0.07, 0.058, 0.58, 6)), M.cloth);
      leg.position.set(x, 0.43, 0);
      grp.add(leg);

      if (broad) {
        const knee = new THREE.Mesh(g('hKnee', () => new THREE.BoxGeometry(0.15, 0.08, 0.16)), M.armor);
        knee.position.set(x, 0.56, -0.03);
        grp.add(knee);
      }
    });
  }

  if (robe) {
    const robeMesh = new THREE.Mesh(g('hRobe', () => new THREE.CylinderGeometry(0.23, 0.47, 1.06, 8)), M.cloth);
    robeMesh.position.y = 0.62;
    grp.add(robeMesh);

    const hem = new THREE.Mesh(g('hRobeHem', () => new THREE.TorusGeometry(0.47, 0.022, 5, 16)), M.accent);
    hem.rotation.x = Math.PI / 2;
    hem.position.y = 0.1;
    grp.add(hem);
  } else {
    const skirt = new THREE.Mesh(g('hSkirt', () => new THREE.BoxGeometry(0.38, 0.18, 0.27)), M.cloth);
    skirt.position.y = 0.74;
    grp.add(skirt);
  }

  const belt = new THREE.Mesh(g('hBelt', () => new THREE.BoxGeometry(0.4, 0.06, 0.28)), M.armor);
  belt.position.y = 0.86;
  grp.add(belt);

  // 躯干：剑客收腰、枪手厚胸、术士直筒
  const torso = new THREE.Mesh(
    slim ? g('hTorsoSlim', () => new THREE.CylinderGeometry(0.185, 0.225, 0.72, 8))
      : broad ? g('hTorsoBroad', () => new THREE.CylinderGeometry(0.24, 0.24, 0.72, 8))
        : g('hTorsoRobe', () => new THREE.CylinderGeometry(0.2, 0.27, 0.74, 8)),
    M.armor
  );
  torso.position.y = 1.1;
  grp.add(torso);

  // 胸前职业色块：三职业位置一致，保证一眼识别阵营
  const plate = new THREE.Mesh(g('hPlate', () => new THREE.BoxGeometry(0.14, 0.09, 0.04)), M.accent);
  plate.position.set(0, 1.22, -0.2);
  grp.add(plate);

  // 肩：三种完全不同的轮廓语言
  if (broad) {
    [-1, 1].forEach((s) => {
      const pad = new THREE.Mesh(g('hPadBroad', () => new THREE.BoxGeometry(0.22, 0.1, 0.28)), M.armor);
      pad.position.set(0.27 * s, 1.42, 0);
      pad.rotation.z = -0.24 * s;
      grp.add(pad);
    });
  } else if (slim) {
    [-1, 1].forEach((s) => {
      const spike = new THREE.Mesh(g('hPadSlim', () => new THREE.ConeGeometry(0.13, 0.26, 5)), M.armor);
      spike.position.set(0.26 * s, 1.42, 0);
      spike.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      grp.add(spike);
    });
  } else {
    [-1, 1].forEach((s) => {
      const pad = new THREE.Mesh(g('hPadRobe', () => new THREE.SphereGeometry(0.11, 8, 6)), M.cloth);
      pad.position.set(0.25 * s, 1.38, 0);
      grp.add(pad);
    });
  }

  const neck = new THREE.Mesh(g('hNeck', () => new THREE.CylinderGeometry(0.08, 0.1, 0.1, 6)), M.cloth);
  neck.position.y = 1.5;
  grp.add(neck);

  const head = new THREE.Mesh(g('hHead', () => new THREE.SphereGeometry(0.15, 12, 10)), M.armor);
  head.position.y = 1.63;
  grp.add(head);

  if (slim) {
    // 束发：头顶球 + 上挑发尾，正面与侧面都能读出来
    const bun = new THREE.Mesh(g('hBun', () => new THREE.SphereGeometry(0.062, 8, 6)), M.cloth);
    bun.position.set(0, 1.73, 0.1);
    grp.add(bun);

    const tail = new THREE.Mesh(g('hTail', () => new THREE.ConeGeometry(0.05, 0.4, 5)), M.cloth);
    tail.position.set(0, 1.64, 0.3);
    tail.rotation.x = -2.05;
    grp.add(tail);

    const mask = new THREE.Mesh(g('hMask', () => new THREE.BoxGeometry(0.17, 0.032, 0.03)), M.accent);
    mask.position.set(0, 1.63, -0.135);
    grp.add(mask);
  } else if (broad) {
    // 护目镜：横贯全脸的宽条，枪手识别符
    const goggle = new THREE.Mesh(g('hGoggle', () => new THREE.BoxGeometry(0.25, 0.06, 0.04)), M.accent);
    goggle.position.set(0, 1.64, -0.13);
    grp.add(goggle);

    const helm = new THREE.Mesh(g('hHelm', () => new THREE.BoxGeometry(0.28, 0.06, 0.28)), M.armor);
    helm.position.set(0, 1.74, 0);
    grp.add(helm);
  } else {
    // 兜帽：罩住后脑，压出术士的暗部轮廓
    const hood = new THREE.Mesh(g('hHood', () => new THREE.ConeGeometry(0.21, 0.16, 8)), M.cloth);
    hood.position.set(0, 1.68, 0.04);
    hood.rotation.x = 0.1;
    grp.add(hood);
  }

  [-0.27, 0.27].forEach((x) => {
    const arm = new THREE.Mesh(g('hArm', () => new THREE.CylinderGeometry(0.055, 0.048, 0.46, 6)), M.cloth);
    arm.position.set(x, 1.14, 0);
    grp.add(arm);

    const cuff = new THREE.Mesh(g('hCuff', () => new THREE.CylinderGeometry(0.065, 0.058, 0.09, 6)), M.armor);
    cuff.position.set(x, 0.94, 0);
    grp.add(cuff);
  });

  addHeroWeapon(grp, H.kind, M);

  grp.userData.kit = type;
  return grp;
}

/* ============================================================
   玩家职业 · 人形模型 v2（建模：Joe）
   依据 art/立绘_*_人形.png：7.5 头身、人形结构、国漫赛璐璐配色
   规格：≤2200 三角面；材质 3 主（甲/衣/点缀）+ 1 皮肤小面积
         所有零件按材质合并成单个 BufferGeometry，单角色 drawcall 4
   旧的低模积木版 buildHero 保留在上面，仅供对照，不再导出使用。
   ============================================================ */
const HEROES_V2 = {
  swordsman: { armor: 0x9aa6b2, cloth: 0x1b2733, accent: 0x7fd8ff, skin: 0xd9c0a6, kind: 'slim' },
  gunner:    { armor: 0x2a4a72, cloth: 0x0f1720, accent: 0x5fd8ff, skin: 0xd9c0a6, kind: 'broad' },
  warlock:   { armor: 0x8f93a8, cloth: 0x2a2340, accent: 0xc9a2ff, skin: 0xcdb49c, kind: 'robe' }
};

function heroMatsV2(type) {
  const H = HEROES_V2[type];
  return {
    H: H,
    armor: m('h2Armor_' + type, () => std(H.armor, 0x0d141c, 0.44, 0.55)),
    cloth: m('h2Cloth_' + type, () => std(H.cloth, 0x000000, 0.86, 0.04)),
    accent: m('h2Accent_' + type, () => glow(H.accent)),
    skin: m('h2Skin_' + type, () => std(H.skin, 0x120c08, 0.74, 0.03))
  };
}

const _HM = new THREE.Matrix4();
const _HQ = new THREE.Quaternion();
const _HE = new THREE.Euler();
const _HV = new THREE.Vector3();
const _HS = new THREE.Vector3();

/* 按材质把零件并成一块几何，drawcall 才压得住 */
function mergeParts(parts) {
  const P = [], N = [], U = [];
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    const src = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    _HE.set(p.rot ? p.rot[0] : 0, p.rot ? p.rot[1] : 0, p.rot ? p.rot[2] : 0);
    _HQ.setFromEuler(_HE);
    _HV.set(p.pos[0], p.pos[1], p.pos[2]);
    _HS.set(p.scale ? p.scale[0] : 1, p.scale ? p.scale[1] : 1, p.scale ? p.scale[2] : 1);
    _HM.compose(_HV, _HQ, _HS);
    src.applyMatrix4(_HM);
    const a = src.attributes;
    for (let i = 0; i < a.position.count; i++) {
      P.push(a.position.getX(i), a.position.getY(i), a.position.getZ(i));
      N.push(a.normal.getX(i), a.normal.getY(i), a.normal.getZ(i));
      if (a.uv) U.push(a.uv.getX(i), a.uv.getY(i)); else U.push(0, 0);
    }
    src.dispose();
    p.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return out;
}

function hb(list, w, h, d, x, y, z, rx, ry, rz) {
  list.push({ geo: new THREE.BoxGeometry(w, h, d), pos: [x, y, z], rot: [rx || 0, ry || 0, rz || 0] });
}
function hc(list, rt, rb, h, x, y, z, seg, rx) {
  list.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg || 8), pos: [x, y, z], rot: [rx || 0, 0, 0] });
}

/* 骨架：7.5 头身，总高 1.80，头高 0.24 */
function buildHeroV2(type) {
  const M = heroMatsV2(type);
  const H = M.H;
  const cloth = [], armor = [], accent = [], skin = [];
  const slim = H.kind === 'slim';
  const broad = H.kind === 'broad';
  const robe = H.kind === 'robe';

  /* ---------- 头颈 ---------- */
  skin.push({ geo: new THREE.SphereGeometry(0.108, 10, 8), pos: [0, 1.662, 0], rot: [0, 0, 0], scale: [0.94, 1.14, 0.99] });
  hb(skin, 0.085, 0.10, 0.085, 0, 1.525, 0);

  /* ---------- 躯干 ---------- */
  hb(cloth, 0.335, 0.255, 0.195, 0, 1.325, 0);
  hb(cloth, 0.275, 0.155, 0.165, 0, 1.135, 0);
  hb(cloth, 0.305, 0.135, 0.185, 0, 0.985, 0);
  // 斜方肌到肩的过渡，避免脖子下面挖空
  hb(cloth, 0.30, 0.075, 0.16, 0, 1.455, 0);

  /* ---------- 腿脚 ---------- */
  if (!robe) {
    [-0.095, 0.095].forEach(function (x) {
      hb(cloth, 0.125, 0.415, 0.135, x, 0.715, 0);
      hb(cloth, 0.115, 0.375, 0.125, x, 0.295, 0);
      hb(cloth, 0.125, 0.085, 0.255, x, 0.045, -0.05);
    });
  } else {
    // 术士：袍子及地，只留一点鞋尖
    [-0.09, 0.09].forEach(function (x) {
      hb(cloth, 0.12, 0.06, 0.16, x, 0.03, -0.10);
    });
  }

  /* ---------- 手臂 ---------- */
  [-1, 1].forEach(function (s) {
    hb(cloth, 0.095, 0.315, 0.105, 0.222 * s, 1.255, 0, 0, 0, 0.06 * s);
    hb(cloth, 0.088, 0.295, 0.098, 0.238 * s, 0.955, -0.02, 0, 0, 0.04 * s);
    hb(skin, 0.078, 0.095, 0.085, 0.243 * s, 0.775, -0.03);
  });

  /* ---------- 职业差异 ---------- */
  if (slim) {
    /* 剑客：银甲 + 深蓝内衬 + 长披 */
    // 肩甲：两层错位
    [-1, 1].forEach(function (s) {
      hb(armor, 0.185, 0.065, 0.245, 0.235 * s, 1.435, 0, 0, 0, -0.22 * s);
      hb(armor, 0.155, 0.055, 0.205, 0.255 * s, 1.345, 0, 0, 0, -0.34 * s);
    });
    // 胸甲与胸线点缀
    hb(armor, 0.295, 0.205, 0.045, 0, 1.335, -0.102);
    hb(accent, 0.245, 0.011, 0.016, 0, 1.372, -0.126);
    // 腹甲两块
    hb(armor, 0.235, 0.058, 0.038, 0, 1.205, -0.096);
    hb(armor, 0.215, 0.055, 0.036, 0, 1.132, -0.090);
    // 腰甲三片
    hb(armor, 0.105, 0.165, 0.032, -0.092, 0.905, -0.098);
    hb(armor, 0.105, 0.185, 0.032, 0, 0.895, -0.104);
    hb(armor, 0.105, 0.165, 0.032, 0.092, 0.905, -0.098);
    // 护腕、胫甲
    [-1, 1].forEach(function (s) {
      hb(armor, 0.108, 0.155, 0.112, 0.236 * s, 0.955, -0.02, 0, 0, 0.04 * s);
      hb(armor, 0.132, 0.275, 0.142, 0.095 * s, 0.315, 0);
      hb(armor, 0.128, 0.10, 0.245, 0.095 * s, 0.055, -0.045);
    });
    // 长披：身后一条垂到底的布，剪影最长的第二条线
    hb(cloth, 0.255, 0.74, 0.022, 0.02, 0.72, 0.145, 0.10);
    // 束发：发团 + 一条连贯的向后飘长马尾（两段同向衔接）
    hb(cloth, 0.180, 0.078, 0.195, 0, 1.762, 0.012);
    hb(cloth, 0.064, 0.070, 0.060, 0, 1.808, 0.070);
    hb(cloth, 0.072, 0.540, 0.058, 0, 1.700, 0.290, 1.72);
    hb(cloth, 0.048, 0.300, 0.038, 0, 1.478, 0.310, 1.92);
    // 长刀：从右手向前下方伸出，刀身、刃线、护手、刀柄连成一条
    var KX = 0.243, KY = 0.41, KZ = -0.44, KR = -2.30;
    hb(armor, 0.044, 1.06, 0.024, KX, KY, KZ, KR, 0, 0.06);
    hb(accent, 0.011, 1.02, 0.010, KX + 0.020, KY, KZ - 0.006, KR, 0, 0.06);
    hb(armor, 0.145, 0.022, 0.058, 0.243, 0.775, -0.030, KR, 0, 0);
    hc(cloth, 0.019, 0.019, 0.150, 0.243, 0.860, -0.030, 6, KR);
  } else if (broad) {
    /* 枪手：深蓝机甲 + 亮青护目镜 */
    [-1, 1].forEach(function (s) {
      hb(armor, 0.175, 0.075, 0.255, 0.238 * s, 1.432, 0, 0, 0, -0.20 * s);
      hb(armor, 0.150, 0.062, 0.215, 0.258 * s, 1.335, 0, 0, 0, -0.30 * s);
      // 护腕带灯、膝甲、胫甲
      hb(armor, 0.112, 0.175, 0.118, 0.237 * s, 0.945, -0.015);
      hb(accent, 0.030, 0.045, 0.012, 0.238 * s, 0.960, -0.078);
      hb(armor, 0.135, 0.155, 0.140, 0.096 * s, 0.455, -0.012);
      hb(accent, 0.070, 0.010, 0.010, 0.096 * s, 0.395, -0.082);
      hb(armor, 0.135, 0.300, 0.142, 0.096 * s, 0.255, 0);
      hb(armor, 0.140, 0.105, 0.255, 0.096 * s, 0.055, -0.05);
    });
    // 颈甲与胸甲
    hb(armor, 0.245, 0.075, 0.185, 0, 1.485, 0);
    hb(armor, 0.300, 0.235, 0.048, 0, 1.330, -0.100);
    hb(accent, 0.026, 0.026, 0.014, 0, 1.330, -0.128);
    // 斜跨弹药带
    hb(accent, 0.042, 0.36, 0.016, 0.03, 1.305, -0.112, 0, 0, 0.55);
    // 腰包
    hb(cloth, 0.095, 0.105, 0.055, -0.145, 0.930, -0.085, 0, 0, 0.05);
    hb(cloth, 0.095, 0.105, 0.055, 0.145, 0.930, -0.085, 0, 0, -0.05);
    hb(accent, 0.028, 0.012, 0.010, -0.145, 0.955, -0.115);
    // 护目镜 + 短碎发
    hb(accent, 0.185, 0.048, 0.022, 0, 1.678, -0.098);
    hb(cloth, 0.180, 0.070, 0.195, 0, 1.775, 0.005);
    hb(cloth, 0.070, 0.085, 0.055, -0.055, 1.820, 0.030, 0.25, 0, 0.3);
    hb(cloth, 0.060, 0.075, 0.050, 0.045, 1.828, 0.045, -0.2, 0, -0.35);
    // 长枪：横向压过肩宽，枪身与枪管走甲色，只有枪口是点缀
    hb(armor, 0.52, 0.115, 0.080, 0.085, 1.030, -0.275, 0, 0, -0.10);
    armor.push({ geo: new THREE.CylinderGeometry(0.028, 0.028, 0.44, 8), pos: [0.560, 1.000, -0.292], rot: [0, 0, Math.PI / 2 + 0.10] });    hb(cloth, 0.190, 0.118, 0.064, -0.250, 1.028, -0.252, 0, 0, -0.10);
    accent.push({ geo: new THREE.SphereGeometry(0.038, 8, 6), pos: [0.780, 0.978, -0.300], rot: [0, 0, 0] });
    hb(armor, 0.120, 0.028, 0.028, 0.240, 1.062, -0.318, 0, 0, -0.10);
  } else {
    /* 术士：银灰肩甲 + 紫袍 + 发光符线 */
    // 兜帽：贴头的软帽，圆顶 + 前沿压到眉骨，不外扩
    hc(cloth, 0.105, 0.150, 0.230, 0, 1.700, 0.012, 8);
    cloth.push({ geo: new THREE.SphereGeometry(0.112, 8, 6), pos: [0, 1.790, 0.015], rot: [0, 0, 0], scale: [1, 0.62, 1] });
    hb(cloth, 0.205, 0.062, 0.105, 0, 1.762, -0.075, 0.42);
    hb(cloth, 0.215, 0.078, 0.190, 0, 1.540, 0.018);
    // 帽檐下压出的眼部暗区
    hb(cloth, 0.155, 0.050, 0.020, 0, 1.672, -0.088);
    // 肩甲与颈甲
    [-1, 1].forEach(function (s) {
      hb(armor, 0.200, 0.070, 0.235, 0.232 * s, 1.438, 0, 0, 0, -0.18 * s);
      hb(armor, 0.170, 0.058, 0.200, 0.252 * s, 1.352, 0, 0, 0, -0.28 * s);
      // 宽袖，垂到手腕
      hb(cloth, 0.150, 0.300, 0.165, 0.238 * s, 0.985, -0.01);
    });
    hb(armor, 0.255, 0.062, 0.195, 0, 1.488, 0);
    hb(accent, 0.014, 0.085, 0.014, 0.045, 1.430, -0.108, 0, 0, 0.4);
    // 长袍：上窄下宽，及地
    hc(cloth, 0.175, 0.335, 1.00, 0, 0.52, 0.01, 8);
    // 束腰
    hb(cloth, 0.295, 0.070, 0.205, 0, 1.005, 0);
    hb(cloth, 0.115, 0.190, 0.030, -0.02, 0.905, -0.105, 0, 0, 0.16);
    // 袍面符线
    hb(accent, 0.012, 0.520, 0.010, -0.075, 0.700, -0.215, 0.10, 0, 0.05);
    hb(accent, 0.012, 0.430, 0.010, 0.070, 0.640, -0.225, 0.10, 0, -0.05);
    hb(accent, 0.012, 0.075, 0.010, -0.03, 1.235, -0.118, 0, 0, 0.5);
    // 法杖 + 法球 + 细光环
    hc(cloth, 0.020, 0.017, 1.40, 0.305, 0.790, -0.085, 8);
    hb(armor, 0.045, 0.115, 0.030, 0.305, 1.520, -0.085, 0, 0, 0.15);
    hb(armor, 0.030, 0.090, 0.026, 0.352, 1.560, -0.085, 0, 0, -0.5);
    accent.push({ geo: new THREE.SphereGeometry(0.072, 10, 8), pos: [0.305, 1.545, -0.085], rot: [0, 0, 0] });
    accent.push({ geo: new THREE.TorusGeometry(0.118, 0.010, 4, 16), pos: [0.305, 1.545, -0.085], rot: [1.30, 0.30, 0] });
  }

  /* ---------- 合并成 4 个 mesh ---------- */
  const grp = new THREE.Group();
  const sets = [[cloth, M.cloth], [armor, M.armor], [accent, M.accent], [skin, M.skin]];
  for (let i = 0; i < sets.length; i++) {
    if (!sets[i][0].length) continue;
    const mesh = new THREE.Mesh(mergeParts(sets[i][0]), sets[i][1]);
    mesh.userData.part = ['cloth', 'armor', 'accent', 'skin'][i];
    grp.add(mesh);
  }

  let tris = 0, meshes = 0;
  grp.traverse(function (o) {
    if (!o.isMesh) return;
    meshes++;
    const c = o.geometry.attributes.position.count;
    tris += c / 3;
  });
  grp.userData.kit = type;
  grp.userData.tris = tris;
  grp.userData.meshes = meshes;
  return grp;
}

/* ============================================================
   V3：圆截面人形（建模：Joe）
   四肢与躯干改带锥度的圆柱，肩、肘、膝用球接，头为球体；
   甲片仍是硬边盒子——硬软对比是人形的读法，不靠加面数。
   ============================================================ */
function cyl(list, rt, rb, h, x, y, z, seg, rx, sz) {
  list.push({
    geo: new THREE.CylinderGeometry(rt, rb, h, seg || 8),
    pos: [x, y, z],
    rot: [rx || 0, 0, 0],
    scale: [1, 1, sz || 1]
  });
}
function ball(list, r, x, y, z, sy) {
  list.push({
    geo: new THREE.SphereGeometry(r, 8, 6),
    pos: [x, y, z],
    rot: [0, 0, 0],
    scale: [1, sy || 1, 1]
  });
}

function buildHeroV3(type) {
  const M = heroMatsV2(type);
  const H = M.H;
  const cloth = [], armor = [], accent = [], skin = [];
  const slim = H.kind === 'slim';
  const broad = H.kind === 'broad';
  const robe = H.kind === 'robe';

  /* ---- 骨架：总高 1.80，头高 0.24，7.5 头身 ---- */
  ball(skin, 0.105, 0, 1.655, 0, 1.14);
  // 下颌：把头收成有下巴的卵形，不是纯球
  hb(skin, 0.115, 0.075, 0.135, 0, 1.598, -0.012);
  cyl(skin, 0.044, 0.050, 0.105, 0, 1.512, 0, 6);

  // 胸、腰、胯：上宽下窄，腰收进去
  cyl(cloth, 0.148, 0.112, 0.300, 0, 1.330, 0, 8, 0, 0.74);
  cyl(cloth, 0.112, 0.104, 0.140, 0, 1.108, 0, 8, 0, 0.72);
  cyl(cloth, 0.104, 0.128, 0.170, 0, 0.955, 0, 8, 0, 0.76);

  // 腿（长袍档做在袍子里，不外露）
  if (!robe) {
    [-0.086, 0.086].forEach(function (x) {
      cyl(cloth, 0.078, 0.060, 0.420, x, 0.700, 0, 8, 0, 0.92);
      ball(cloth, 0.056, x, 0.492, 0, 0.86);
      cyl(cloth, 0.058, 0.042, 0.400, x, 0.292, 0, 8, 0, 0.92);
      hb(cloth, 0.108, 0.085, 0.245, x, 0.045, -0.048);
    });
  }

  // 手臂：肩、肘用球接，前臂略向前
  [-1, 1].forEach(function (s) {
    ball(cloth, 0.058, 0.172 * s, 1.418, 0, 0.9);
    cyl(cloth, 0.044, 0.038, 0.300, 0.182 * s, 1.258, 0, 6);
    ball(cloth, 0.040, 0.190 * s, 1.108, -0.01);
    cyl(cloth, 0.037, 0.031, 0.280, 0.198 * s, 0.962, -0.02, 6);
    hb(skin, 0.068, 0.100, 0.058, 0.206 * s, 0.800, -0.028);
  });

  /* ---- 职业差异 ---- */
  if (slim) {
    // 肩甲：外沿上翘的两层硬片
    [-1, 1].forEach(function (s) {
      hb(armor, 0.170, 0.058, 0.230, 0.196 * s, 1.432, 0, 0, 0, -0.26 * s);
      hb(armor, 0.140, 0.050, 0.196, 0.216 * s, 1.352, 0, 0, 0, -0.40 * s);
      // 护腕、胫甲、靴口
      cyl(armor, 0.048, 0.044, 0.150, 0.198 * s, 0.960, -0.02, 6);
      cyl(armor, 0.062, 0.056, 0.250, 0.086 * s, 0.300, 0, 6);
      hb(armor, 0.112, 0.085, 0.230, 0.086 * s, 0.050, -0.045);
    });
    // 胸甲 + 胸线点缀（唯一的高俏度）
    hb(armor, 0.268, 0.190, 0.042, 0, 1.345, -0.098);
    hb(accent, 0.214, 0.010, 0.014, 0, 1.378, -0.122);
    hb(armor, 0.212, 0.052, 0.036, 0, 1.212, -0.092);
    hb(armor, 0.194, 0.050, 0.034, 0, 1.140, -0.086);
    // 腰甲三片
    hb(armor, 0.092, 0.155, 0.030, -0.084, 0.902, -0.094);
    hb(armor, 0.092, 0.175, 0.030, 0, 0.892, -0.100);
    hb(armor, 0.092, 0.155, 0.030, 0.084, 0.902, -0.094);
    // 长披：剪影里最长的一条软边
    hb(cloth, 0.230, 0.720, 0.020, 0.015, 0.700, 0.132, 0.10);
    // 束发 + 连贯长马尾
    hb(cloth, 0.168, 0.070, 0.180, 0, 1.756, 0.008);
    hb(cloth, 0.060, 0.058, 0.055, 0, 1.798, 0.062);
    hb(cloth, 0.062, 0.560, 0.052, 0, 1.690, 0.300, 1.74);
    // 长刀：右手向前下方
    var KX = 0.206, KY = 0.400, KZ = -0.430, KR = -2.28;
    hb(armor, 0.040, 1.040, 0.022, KX, KY, KZ, KR, 0, 0.05);
    hb(accent, 0.010, 1.000, 0.009, KX + 0.018, KY, KZ - 0.006, KR, 0, 0.05);
    hb(armor, 0.136, 0.020, 0.052, 0.206, 0.796, -0.028, KR, 0, 0);
    cyl(cloth, 0.018, 0.018, 0.140, 0.206, 0.878, -0.028, 6, KR);
  } else if (broad) {
    [-1, 1].forEach(function (s) {
      hb(armor, 0.178, 0.072, 0.242, 0.198 * s, 1.428, 0, 0, 0, -0.22 * s);
      hb(armor, 0.150, 0.058, 0.206, 0.220 * s, 1.338, 0, 0, 0, -0.34 * s);
      // 机械护臂 + 灯条
      cyl(armor, 0.052, 0.046, 0.170, 0.198 * s, 0.958, -0.02, 6);
      hb(accent, 0.026, 0.040, 0.012, 0.198 * s, 0.968, -0.074);
      // 膝甲、胫甲、靴
      hb(armor, 0.120, 0.140, 0.130, 0.086 * s, 0.470, -0.012);
      hb(accent, 0.058, 0.010, 0.010, 0.086 * s, 0.414, -0.078);
      cyl(armor, 0.062, 0.058, 0.270, 0.086 * s, 0.262, 0, 6);
      hb(armor, 0.122, 0.095, 0.240, 0.086 * s, 0.052, -0.048);
    });
    hb(armor, 0.222, 0.062, 0.170, 0, 1.478, 0);
    hb(armor, 0.272, 0.220, 0.046, 0, 1.338, -0.096);
    hb(accent, 0.024, 0.024, 0.012, 0, 1.338, -0.122);
    hb(accent, 0.038, 0.330, 0.014, 0.030, 1.310, -0.108, 0, 0, 0.55);
    hb(cloth, 0.088, 0.100, 0.052, -0.140, 0.925, -0.080);
    hb(cloth, 0.088, 0.100, 0.052, 0.140, 0.925, -0.080);
    // 护目镜 + 短碎发
    hb(accent, 0.172, 0.044, 0.020, 0, 1.670, -0.092);
    hb(cloth, 0.172, 0.065, 0.182, 0, 1.762, 0.004);
    hb(cloth, 0.062, 0.078, 0.050, -0.052, 1.806, 0.028, 0.22, 0, 0.28);
    hb(cloth, 0.056, 0.070, 0.046, 0.046, 1.812, 0.040, -0.18, 0, -0.32);
    // 长枪：沿 x 横跨，正面读长度
    hb(armor, 0.500, 0.110, 0.076, 0.070, 1.028, -0.268, 0, 0, -0.10);
    armor.push({ geo: new THREE.CylinderGeometry(0.026, 0.026, 0.420, 8), pos: [0.520, 1.000, -0.284], rot: [0, 0, Math.PI / 2 + 0.10] });
    hb(cloth, 0.180, 0.112, 0.060, -0.268, 1.026, -0.248, 0, 0, -0.10);
    accent.push({ geo: new THREE.SphereGeometry(0.036, 8, 6), pos: [0.730, 0.978, -0.292], rot: [0, 0, 0] });
    hb(armor, 0.110, 0.026, 0.026, 0.208, 1.060, -0.310, 0, 0, -0.10);
  } else {
    // 兜帽：贴头的软帽，圆顶覆盖后脑，前沿自然垂到眉骨，不做帽檐横板
    cyl(cloth, 0.104, 0.146, 0.230, 0, 1.696, 0.010, 8);
    cloth.push({ geo: new THREE.SphereGeometry(0.115, 8, 6), pos: [0, 1.780, 0.010], rot: [0, 0, 0], scale: [1, 0.72, 1] });
    hb(cloth, 0.212, 0.090, 0.088, 0, 1.742, -0.078, 0.55);
    hb(cloth, 0.208, 0.074, 0.184, 0, 1.534, 0.016);
    // 银灰肩甲 + 颈甲
    [-1, 1].forEach(function (s) {
      hb(armor, 0.188, 0.064, 0.226, 0.196 * s, 1.432, 0, 0, 0, -0.20 * s);
      hb(armor, 0.158, 0.054, 0.192, 0.218 * s, 1.344, 0, 0, 0, -0.32 * s);
      // 宽袖
      cyl(cloth, 0.070, 0.096, 0.300, 0.196 * s, 0.980, -0.008, 6);
    });
    hb(armor, 0.236, 0.058, 0.180, 0, 1.484, 0);
    hb(accent, 0.012, 0.080, 0.012, 0.042, 1.428, -0.102, 0, 0, 0.4);
    // 及地长袍
    cyl(cloth, 0.168, 0.320, 1.00, 0, 0.520, 0.008, 8);
    hb(cloth, 0.278, 0.066, 0.196, 0, 1.004, 0);
    hb(cloth, 0.108, 0.180, 0.028, -0.018, 0.902, -0.098, 0, 0, 0.16);
    // 袍面符线
    hb(accent, 0.011, 0.500, 0.009, -0.070, 0.700, -0.206, 0.10, 0, 0.05);
    hb(accent, 0.011, 0.410, 0.009, 0.066, 0.640, -0.214, 0.10, 0, -0.05);
    hb(accent, 0.011, 0.070, 0.009, -0.028, 1.228, -0.112, 0, 0, 0.5);
    // 法杖 + 法球 + 细光环
    cyl(cloth, 0.019, 0.016, 1.38, 0.292, 0.790, -0.080, 6);
    hb(armor, 0.042, 0.108, 0.028, 0.292, 1.516, -0.080, 0, 0, 0.15);
    hb(armor, 0.028, 0.084, 0.024, 0.336, 1.552, -0.080, 0, 0, -0.5);
    accent.push({ geo: new THREE.SphereGeometry(0.068, 10, 8), pos: [0.292, 1.540, -0.080], rot: [0, 0, 0] });
    accent.push({ geo: new THREE.TorusGeometry(0.112, 0.009, 4, 16), pos: [0.292, 1.540, -0.080], rot: [1.30, 0.30, 0] });
  }

  const grp = new THREE.Group();
  const sets = [[cloth, M.cloth], [armor, M.armor], [accent, M.accent], [skin, M.skin]];
  for (let i = 0; i < sets.length; i++) {
    if (!sets[i][0].length) continue;
    const mesh = new THREE.Mesh(mergeParts(sets[i][0]), sets[i][1]);
    mesh.userData.part = ['cloth', 'armor', 'accent', 'skin'][i];
    grp.add(mesh);
  }

  let tris = 0, meshes = 0;
  grp.traverse(function (o) {
    if (!o.isMesh) return;
    meshes++;
    tris += o.geometry.attributes.position.count / 3;
  });
  grp.userData.kit = type;
  grp.userData.tris = tris;
  grp.userData.meshes = meshes;
  return grp;
}

/* ============================================================
   敌人：同一套人形骨架，按 TYPES 配色与武器分型
   目标：剪影先认人（1 秒认出职能），再谈细节；
   合批后每只 3 个 mesh（armor / cloth / accent），drawcall 压到 24 以内。
   ============================================================ */
function buildFighterHero(type) {
  const K = KITS[type] || KITS.grunt;
  const armorMat = m('e2Armor_' + type, () => std(K.armor, 0x0a1018, 0.42, 0.55)).clone();
  const clothMat = m('e2Cloth_' + type, () => std(K.cloth, 0x000000, 0.86, 0.06)).clone();
  const accentMat = m('e2Accent_' + type, () => glow(K.accent)).clone();
  armorMat.userData = { shared: false };
  clothMat.userData = { shared: false };
  accentMat.userData = { shared: false };

  const armor = [], cloth = [], accent = [];
  const broad = type === 'shooter' || type === 'elite' || type === 'boss';
  const big = type === 'boss';

  /* 骨架：总高 1.80（实际身高由 scaleOf 缩放） */
  ball(cloth, 0.108, 0, 1.652, 0, 1.12);                 // 头盔本体
  hb(armor, 0.128, 0.070, 0.150, 0, 1.596, -0.010);      // 面甲
  hb(accent, 0.118, 0.024, 0.014, 0, 1.646, -0.088);     // 目镜/U 形视口
  hb(armor, 0.176, 0.052, 0.190, 0, 1.756, 0.006);       // 盔顶
  if (K.crest) {
    hb(armor, 0.028, 0.140, 0.052, 0, 1.860, -0.012, -0.28);
    hb(accent, 0.014, 0.120, 0.010, 0, 1.862, -0.040, -0.28);
  }
  cyl(cloth, 0.046, 0.052, 0.110, 0, 1.508, 0, 6);

  const chestR = broad ? 0.162 : 0.142;
  cyl(cloth, chestR, chestR * 0.76, 0.300, 0, 1.330, 0, 8, 0, 0.74);
  cyl(cloth, chestR * 0.76, chestR * 0.70, 0.140, 0, 1.108, 0, 8, 0, 0.72);
  cyl(cloth, chestR * 0.70, chestR * 0.86, 0.170, 0, 0.955, 0, 8, 0, 0.76);

  // 胸甲块 + 胸口核心
  hb(armor, chestR * 1.90, 0.200, 0.052, 0, 1.340, -(chestR * 0.60));
  hb(accent, 0.040, 0.040, 0.014, 0, 1.318, -(chestR * 0.72));

  // 腿
  [-0.086, 0.086].forEach(function (x) {
    cyl(cloth, 0.078, 0.060, 0.420, x, 0.700, 0, 8, 0, 0.92);
    ball(cloth, 0.056, x, 0.492, 0, 0.86);
    cyl(cloth, 0.058, 0.042, 0.400, x, 0.292, 0, 8, 0, 0.92);
    hb(armor, 0.112, 0.088, 0.250, x, 0.048, -0.050);
    hb(accent, 0.070, 0.010, 0.010, x, 0.148, -0.148);
  });

  // 臂：肩球 + 上臂 + 肘 + 前臂 + 拳套
  const armR = broad ? 0.050 : 0.043;
  [-1, 1].forEach(function (s) {
    ball(cloth, broad ? 0.064 : 0.056, 0.174 * s, 1.416, 0, 0.9);
    cyl(cloth, armR, armR * 0.86, 0.300, 0.184 * s, 1.256, 0, 6);
    ball(cloth, armR * 0.90, 0.192 * s, 1.106, -0.010);
    cyl(armor, armR * 0.86, armR * 0.74, 0.280, 0.200 * s, 0.960, -0.020, 6);
    hb(armor, 0.086, 0.104, 0.078, 0.208 * s, 0.796, -0.026);
  });

  // 肩甲：层叠两片，外沿上翘
  [-1, 1].forEach(function (s) {
    hb(armor, broad ? 0.176 : 0.152, 0.062, 0.226, 0.196 * s, 1.428, 0, 0, 0, -0.22 * s);
    hb(armor, broad ? 0.150 : 0.128, 0.052, 0.196, 0.216 * s, 1.348, 0, 0, 0, -0.34 * s);
  });

  // 腰甲
  hb(armor, 0.086, 0.150, 0.028, -0.080, 0.906, -0.094);
  hb(armor, 0.086, 0.170, 0.028, 0, 0.896, -0.100);
  hb(armor, 0.086, 0.150, 0.028, 0.080, 0.906, -0.094);

  // 披风：剪影最长的一条软边
  if (K.cloak) {
    hb(cloth, big ? 0.290 : 0.230, 0.760, 0.022, 0.010, 0.690, 0.140, 0.10);
    hb(cloth, big ? 0.320 : 0.250, 0.100, 0.030, 0.010, 1.010, 0.120);
  }

  /* 武器 */
  if (K.weapon === 'sword') {
    hb(armor, 0.040, 1.000, 0.022, 0.208, 0.400, -0.420, -2.28, 0, 0.05);
    hb(accent, 0.010, 0.960, 0.009, 0.226, 0.400, -0.426, -2.28, 0, 0.05);
    hb(armor, 0.132, 0.020, 0.050, 0.208, 0.796, -0.026, -2.28, 0, 0);
  } else if (K.weapon === 'greatsword') {
    const len = big ? 1.34 : 1.10;
    hb(armor, 0.070, len, 0.032, 0.232, 0.390, -0.520, -2.34, 0, 0.05);
    hb(accent, 0.016, len * 0.94, 0.012, 0.262, 0.390, -0.530, -2.34, 0, 0.05);
    hb(armor, 0.180, 0.026, 0.060, 0.208, 0.796, -0.026, -2.34, 0, 0);
  } else {
    // 步枪：横压肩宽，枪口只留一点发光
    hb(armor, 0.470, 0.104, 0.072, 0.070, 1.026, -0.262, 0, 0, -0.10);
    armor.push({ geo: new THREE.CylinderGeometry(0.024, 0.024, 0.400, 8), pos: [0.500, 0.998, -0.278], rot: [0, 0, Math.PI / 2 + 0.10] });
    hb(cloth, 0.170, 0.106, 0.058, -0.260, 1.024, -0.242, 0, 0, -0.10);
    accent.push({ geo: new THREE.SphereGeometry(0.032, 8, 6), pos: [0.700, 0.976, -0.286], rot: [0, 0, 0] });
    hb(accent, 0.030, 0.030, 0.012, 0.070, 1.026, -0.300);
    // 弹带
    hb(accent, 0.034, 0.300, 0.012, 0.026, 1.300, -0.100, 0, 0, 0.42);
  }

  const grp = new THREE.Group();
  const sets = [[cloth, clothMat], [armor, armorMat], [accent, accentMat]];
  for (let i = 0; i < sets.length; i++) {
    if (!sets[i][0].length) continue;
    const mesh = new THREE.Mesh(mergeParts(sets[i][0]), sets[i][1]);
    mesh.userData.part = ['cloth', 'armor', 'accent'][i];
    grp.add(mesh);
  }

  let tris = 0, meshes = 0;
  grp.traverse(function (o) {
    if (!o.isMesh) return;
    meshes++;
    tris += o.geometry.attributes.position.count / 3;
  });
  grp.userData.kit = type;
  grp.userData.tris = tris;
  grp.userData.meshes = meshes;
  return grp;
}

window.ArenaArt = {
  buildFighter: buildFighterHero,
  buildFighterLegacy: buildFighter,
  buildHero: buildHeroV3,
  buildHeroLegacy: buildHero,
  buildHeroV2: buildHeroV2,
  scaleOf: scaleOf,
  KITS: KITS,
  HEROES: HEROES_V2,
  HEROES_V1: HEROES
};

})();
