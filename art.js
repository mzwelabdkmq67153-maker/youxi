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

window.ArenaArt = { buildFighter: buildFighter, buildHero: buildHero, scaleOf: scaleOf, KITS: KITS, HEROES: HEROES };

})();
