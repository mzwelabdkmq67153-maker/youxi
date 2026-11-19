/* ============================================================
   第七竞技场 · 第一人称 PVP / PVE 原型
   依赖：vendor/three.min.js (r128)
   纯前端，双击 index.html 即可运行
   ============================================================ */
(function () {
'use strict';

/* ---------------- 常量 ---------------- */
const HALF = 22;
const WALL_H = 9;
const PLAYER_H = 1.68;

const CLASSES = {
  blade: {
    name: '剑客', hp: 130, en: 100, speed: 6.4, color: 0x6fe3ff,
    attackType: 'melee',
    attack: { range: 3.7, arcDeg: 66, dmg: 26, interval: 0.38 },
    skills: [
      { key: 'Q', name: '突进斩', cd: 6, cost: 0, id: 'dashSlash' },
      { key: 'E', name: '旋风斩', cd: 9, cost: 25, id: 'whirl' },
      { key: 'R', name: '剑域', cd: 30, cost: 60, id: 'swordDomain' }
    ]
  },
  gunner: {
    name: '枪手', hp: 110, en: 100, speed: 6.6, color: 0x8fd4ff,
    attackType: 'hitscan',
    attack: { dmg: 15, interval: 0.12, spread: 0.006, headMul: 1.8 },
    skills: [
      { key: 'Q', name: '战术翻滚', cd: 5, cost: 0, id: 'roll' },
      { key: 'E', name: '爆裂弹', cd: 10, cost: 30, id: 'grenade' },
      { key: 'R', name: '火力全开', cd: 32, cost: 65, id: 'overdrive' }
    ]
  },
  mage: {
    name: '术士', hp: 105, en: 120, speed: 6.0, color: 0xb98cff,
    attackType: 'projectile',
    attack: { dmg: 24, interval: 0.46, speed: 24, splash: 2.4 },
    skills: [
      { key: 'Q', name: '冰霜环', cd: 8, cost: 25, id: 'frostRing' },
      { key: 'E', name: '相位闪现', cd: 9, cost: 0, id: 'blink' },
      { key: 'R', name: '陨星', cd: 30, cost: 70, id: 'meteor' }
    ]
  }
};

const TYPES = {
  grunt:   { hp: 58,  speed: 3.1, dmg: 8,  radius: 0.52, color: 0xff5c72, score: 1 },
  shooter: { hp: 44,  speed: 2.7, dmg: 9,  radius: 0.50, color: 0xffa23c, score: 1 },
  elite:   { hp: 150, speed: 2.9, dmg: 17, radius: 0.78, color: 0xff9a6b, score: 2 },
  boss:    { hp: 900, speed: 2.3, dmg: 22, radius: 1.50, color: 0xff3860, score: 5 },
  duelist: { hp: 150, speed: 5.2, dmg: 13, radius: 0.50, color: 0xff7a45, score: 1 }
};

/* ---------------- 工具 ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hyp = (x, y) => Math.sqrt(x * x + y * y);

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

/* ---------------- 音频 ---------------- */
let actx = null;
function initAudio() {
  if (actx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  } catch (e) { actx = null; }
}
function tone(freq, dur, type, gain, slideTo) {
  if (!actx) return;
  try {
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch (e) { /* ignore */ }
}
const SFX = {
  shot: () => tone(760, 0.06, 'square', 0.03, 240),
  hit: () => tone(430, 0.05, 'triangle', 0.045, 150),
  kill: () => tone(190, 0.18, 'sawtooth', 0.06, 60),
  slash: () => tone(320, 0.09, 'sine', 0.04, 110),
  hurt: () => tone(130, 0.16, 'sawtooth', 0.08, 50),
  skill: () => tone(540, 0.22, 'sine', 0.06, 1080),
  dash: () => tone(880, 0.1, 'sine', 0.035, 420),
  enemyShot: () => tone(520, 0.05, 'square', 0.022, 200),
  start: () => tone(300, 0.3, 'sine', 0.055, 900),
  cast: () => tone(660, 0.14, 'triangle', 0.045, 300)
};
function sfx(name) { if (SFX[name]) SFX[name](); }

/* ---------------- 运行时 ---------------- */
let canvas, renderer, scene, camera, clock;
let yawObj, pitchObj, weaponObj, weaponBase;
let hudEl, overlayEl, menuPanel, pausePanel, resultPanel;
let resultTitleEl, resultSubEl, resultStatsEl;
let hpFill, hpText, enFill, enText, stFill, stText, skillsEl, objectiveEl, timerEl, modeLabelEl;
let toastEl, flashEl, hitmarkerEl, dmgLayerEl;

const state = {
  mode: 'pve', cls: 'blade', phase: 'menu',
  time: 0, elapsed: 0,
  wave: 1, kills: 0, scoreP: 0, scoreE: 0,
  spawnQueue: [], spawnTimer: 0, waveRest: null,
  enemyResp: 0, clsName: '剑客',
  sandbox: /sandbox/i.test(location.search),
  tapTest: /tap/i.test(location.search)
};

const player = {};
const input = { keys: {}, attacking: false };
const enemies = [];
const projectiles = [];
const effects = [];
const obstacles = [];

let lockActive = false;
let shake = 0;
let hitStop = 0;
let hitTimer = null;

const sparkGeo = new THREE.SphereGeometry(0.07, 6, 6);
sparkGeo.userData.shared = true;

/* ---------------- 初始化 ---------------- */
function init() {
  canvas = document.getElementById('gl');
  hudEl = document.getElementById('hud');
  overlayEl = document.getElementById('overlay');
  menuPanel = document.getElementById('menuPanel');
  pausePanel = document.getElementById('pausePanel');
  resultPanel = document.getElementById('resultPanel');
  resultTitleEl = document.getElementById('resultTitle');
  resultSubEl = document.getElementById('resultSub');
  resultStatsEl = document.getElementById('resultStats');
  hpFill = document.getElementById('hpFill');
  hpText = document.getElementById('hpText');
  enFill = document.getElementById('enFill');
  enText = document.getElementById('enText');
  stFill = document.getElementById('stFill');
  stText = document.getElementById('stText');
  skillsEl = document.getElementById('skills');
  objectiveEl = document.getElementById('objective');
  timerEl = document.getElementById('timer');
  modeLabelEl = document.getElementById('modeLabel');
  toastEl = document.getElementById('toast');
  flashEl = document.getElementById('flash');
  hitmarkerEl = document.getElementById('hitmarker');
  dmgLayerEl = document.getElementById('dmgLayer');

  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  if (window.ArenaFX) ArenaFX.init(scene);
  scene.background = new THREE.Color(0x060a12);
  scene.fog = new THREE.Fog(0x060a12, 30, 78);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 200);
  pitchObj = new THREE.Object3D();
  yawObj = new THREE.Object3D();
  yawObj.position.set(0, PLAYER_H, 14);
  yawObj.add(pitchObj);
  pitchObj.add(camera);
  scene.add(yawObj);

  clock = new THREE.Clock();

  buildArena();
  buildLights();
  resetPlayer();
  bindUI();
  bindInput();

  window.addEventListener('resize', onResize);
  animate();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ---------------- 场景 ---------------- */
function makeGridTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#0a1120';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(96, 196, 255, 0.20)';
  g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const p = i * 64;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(512, p); g.stroke();
  }
  g.strokeStyle = 'rgba(140, 230, 255, 0.38)';
  g.lineWidth = 3;
  g.strokeRect(1, 1, 510, 510);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.anisotropy = 4;
  return tex;
}

function wantScene() {
  return state.mode === 'pve' ? 'dungeon' : 'arena';
}

/* 换场：先清障碍再重建，障碍由场景模块重新登记 */
function syncScene() {
  if (!window.ArenaScene) return;
  if (ArenaScene.kind === wantScene()) return;
  obstacles.length = 0;
  ArenaScene.build(wantScene(), scene, obstacles);
  ArenaScene.tuneLights(scene);
}

function buildArena() {
  if (window.ArenaScene) ArenaScene.build(wantScene(), scene, obstacles);
  if (window.ArenaScene) return;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2, HALF * 2),
    new THREE.MeshStandardMaterial({ map: makeGridTexture(), color: 0x2a3d55, roughness: 0.82, metalness: 0.22 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0e1828, roughness: 0.65, metalness: 0.4, emissive: 0x08131f });
  const geoZ = new THREE.BoxGeometry(HALF * 2, WALL_H, 0.5);
  const geoX = new THREE.BoxGeometry(0.5, WALL_H, HALF * 2);
  const wallSpecs = [
    [geoZ, 0, WALL_H / 2, -HALF], [geoZ, 0, WALL_H / 2, HALF],
    [geoX, -HALF, WALL_H / 2, 0], [geoX, HALF, WALL_H / 2, 0]
  ];
  wallSpecs.forEach(([geo, x, y, z]) => {
    const m = new THREE.Mesh(geo, wallMat);
    m.position.set(x, y, z);
    scene.add(m);
  });

  // 墙顶霓虹带
  const neonMat = new THREE.MeshBasicMaterial({ color: 0x2f9ccc });
  const neonZ = new THREE.BoxGeometry(HALF * 2, 0.1, 0.12);
  const neonX = new THREE.BoxGeometry(0.12, 0.1, HALF * 2);
  [[0, WALL_H, -HALF + 0.28, neonZ], [0, WALL_H, HALF - 0.28, neonZ],
   [-HALF + 0.28, WALL_H, 0, neonX], [HALF - 0.28, WALL_H, 0, neonX]].forEach(([x, y, z, geo]) => {
    const m = new THREE.Mesh(geo, neonMat);
    m.position.set(x, y, z);
    scene.add(m);
  });

  // 中心圆
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(5.4, 5.7, 64),
    new THREE.MeshBasicMaterial({ color: 0x2a7fa8, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  // 立柱
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1a2c42, roughness: 0.5, metalness: 0.55, emissive: 0x0a1c2b });
  const pillarPos = [
    [-13, -13], [13, -13], [-13, 13], [13, 13],
    [0, -17], [0, 17], [-18, 0], [18, 0]
  ];
  pillarPos.forEach(([x, z]) => {
    const h = 4.4;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.72, h, 10), pillarMat);
    p.position.set(x, h / 2, z);
    scene.add(p);
    obstacles.push({ x: x, z: z, r: 0.78 });

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.045, 8, 26),
      new THREE.MeshBasicMaterial({ color: 0x3ec8f0 })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.set(x, h + 0.12, z);
    scene.add(halo);
  });
}

function buildLights() {
  scene.add(new THREE.HemisphereLight(0x7fb4ff, 0x0a1018, 0.62));
  const key = new THREE.DirectionalLight(0xaee4ff, 0.85);
  key.position.set(24, 34, 16);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x2a6cff, 0.35);
  fill.position.set(-22, 14, -20);
  scene.add(fill);

  [[-18, 0], [18, 0], [0, -18], [0, 18]].forEach(([x, z], i) => {
    const c = [0x2ee6c0, 0x2e8cff, 0xb98cff, 0xff9a6b][i];
    const pl = new THREE.PointLight(c, 0.6, 26);
    pl.position.set(x, 6, z);
    scene.add(pl);
  });

  if (window.ArenaScene) ArenaScene.tuneLights(scene);
}

/* ---------------- 武器 ---------------- */
function buildWeapon() {
  if (weaponObj) {
    camera.remove(weaponObj);
    disposeGroup(weaponObj);
    weaponObj = null;
  }
  const cls = state.cls;
  const g = new THREE.Group();

  if (cls === 'gunner') {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b3a4e, roughness: 0.35, metalness: 0.8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.55), metal);
    body.position.set(0, 0, -0.12);
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.44, 8), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.012, -0.5);
    g.add(barrel);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffcf6b }));
    dot.position.set(0, 0.012, -0.72);
    g.add(dot);
    g.scale.setScalar(0.62);
    weaponBase = { x: 0.36, y: -0.32, z: -0.5, rx: -0.02, ry: -0.05, rz: 0 };
  } else if (cls === 'blade') {
    const metal = new THREE.MeshStandardMaterial({ color: 0x8fd9ff, roughness: 0.25, metalness: 0.9, emissive: 0x2b7fa8 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.072, 0.78), metal);
    blade.position.set(0, 0, -0.5);
    g.add(blade);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.034, 0.045), metal);
    guard.position.set(0, 0, -0.11);
    g.add(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.17, 8),
      new THREE.MeshStandardMaterial({ color: 0x14202e, roughness: 0.8 }));
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0, 0, 0.02);
    g.add(grip);
    g.scale.setScalar(0.55);
    weaponBase = { x: 0.42, y: -0.4, z: -0.48, rx: -0.3, ry: 0.52, rz: 0.2 };
  } else {
    const wood = new THREE.MeshStandardMaterial({ color: 0x1d2436, roughness: 0.5, metalness: 0.5 });
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.95, 8), wood);
    staff.rotation.x = Math.PI / 2;
    staff.position.set(0, 0, -0.42);
    g.add(staff);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.062, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xb98cff, emissive: 0x6a3fd0, roughness: 0.2, metalness: 0.3 })
    );
    core.position.set(0, 0.02, -0.9);
    g.add(core);
    g.scale.setScalar(0.6);
    weaponBase = { x: 0.38, y: -0.36, z: -0.5, rx: -0.15, ry: -0.25, rz: 0.1 };
  }

  weaponObj = g;
  weaponObj.position.set(weaponBase.x, weaponBase.y, weaponBase.z);
  weaponObj.rotation.set(weaponBase.rx, weaponBase.ry, weaponBase.rz);
  camera.add(weaponObj);
}

/* ---------------- 玩家 ---------------- */
function resetPlayer() {
  const C = CLASSES[state.cls];
  player.hp = C.hp;
  player.maxHp = C.hp;
  player.en = C.en;
  player.maxEn = C.en;
  player.speed = C.speed;
  player.attackCd = 0;
  player.attackAnim = 0;
  player.sprintT = 0;
  player.sprintCd = 0;
  player.invul = 0;
  player.skillCd = [0, 0, 0];
  player.domain = 0;
  player.domainTick = 0;
  player.overdrive = 0;
  player.alive = true;
  player.respawn = 0;
  player.hurtT = 0;

  // 竖直方向与疾跑状态
  player.y = PLAYER_H;
  player.vy = 0;
  player.grounded = true;
  player.jumpCd = 0;
  player.stamina = 100;
  player.maxStamina = 100;
  player.runT = 0;
  player.trailT = 0;

  yawObj.position.set(0, PLAYER_H, 14);
  yawObj.rotation.y = 0;
  pitchObj.rotation.x = 0;
  camera.position.set(0, 0, 0);
}

function updatePlayer(dt) {
  if (!player.alive) {
    // 联机对战：复活时机由服务器决定，客户端不做本地复活
    if (state.mode === 'online') return;
    player.respawn -= dt;
    if (player.respawn <= 0) {
      player.alive = true;
      player.hp = player.maxHp;
      player.en = player.maxEn;
      player.invul = 1.2;
      yawObj.position.set(rand(-8, 8), PLAYER_H, 16);
      toast('重生', 900);
    }
    return;
  }

  let fwd = ((input.keys['w'] || input.keys['arrowup']) ? 1 : 0) - ((input.keys['s'] || input.keys['arrowdown']) ? 1 : 0);
  let rgt = ((input.keys['d'] || input.keys['arrowright']) ? 1 : 0) - ((input.keys['a'] || input.keys['arrowleft']) ? 1 : 0);
  const mag = hyp(fwd, rgt);
  if (mag > 0) { fwd /= mag; rgt /= mag; }

  player.sprintT = Math.max(0, player.sprintT - dt);
  player.sprintCd = Math.max(0, player.sprintCd - dt);
  player.jumpCd = Math.max(0, player.jumpCd - dt);

  // 疾跑：Shift 按住，持续消耗耐力
  const wantsRun = !!input.keys['shift'] && mag > 0 && player.stamina > 0;
  if (wantsRun) {
    player.stamina = Math.max(0, player.stamina - 24 * dt);
    player.runT += dt;
  } else {
    player.stamina = Math.min(player.maxStamina, player.stamina + 14 * dt);
    player.runT = 0;
  }
  const runMul = wantsRun ? 1.45 : 1;
  const speed = player.speed * (player.sprintT > 0 ? 1.7 : 1) * runMul;

  // 疾跑拉 FOV：+6°，冲刺再叠 +4°；插值过渡，不跳变
  const targetFov = 72 + (wantsRun ? 6 : 0) + (player.sprintT > 0 ? 4 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
  camera.updateProjectionMatrix();

  const yaw = yawObj.rotation.y;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);

  yawObj.position.x += (fx * fwd + rx * rgt) * speed * dt;
  yawObj.position.z += (fz * fwd + rz * rgt) * speed * dt;
  clampPos(yawObj.position, 0.55);

  // 跳跃：竖直速度 + 重力，落地重置视角高度
  if (!player.grounded) {
    player.vy -= 42 * dt;
    player.y += player.vy * dt;
    if (player.y <= PLAYER_H) {
      player.y = PLAYER_H;
      player.vy = 0;
      player.grounded = true;
      landEffect();
    }
  }
  yawObj.position.y = player.y;

  // 疾跑残影
  if (wantsRun) {
    player.trailT += dt;
    if (player.trailT > 0.1) {
      player.trailT = 0;
      spawnTrailGhost();
    }
  } else {
    player.trailT = 0;
  }

  player.attackCd = Math.max(0, player.attackCd - dt);
  player.attackAnim = Math.max(0, player.attackAnim - dt);
  player.invul = Math.max(0, player.invul - dt);
  player.hurtT = Math.max(0, player.hurtT - dt);

  if (input.attacking && player.attackCd <= 0) tryAttack();

  player.en = Math.min(player.maxEn, player.en + 11 * dt);
}

function clampPos(p, pad) {
  p.x = clamp(p.x, -HALF + pad, HALF - pad);
  p.z = clamp(p.z, -HALF + pad, HALF - pad);
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const dx = p.x - o.x;
    const dz = p.z - o.z;
    const d = hyp(dx, dz);
    const min = o.r + 0.45;
    if (d < min && d > 0.0001) {
      p.x = o.x + (dx / d) * min;
      p.z = o.z + (dz / d) * min;
    }
  }
}

/* 两点之间的水平视线是否被柱子挡住 */
function losBlocked(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-6) return false;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    let t = ((o.x - ax) * dx + (o.z - az) * dz) / len2;
    t = clamp(t, 0, 1);
    const px = ax + dx * t;
    const pz = az + dz * t;
    if (hyp(px - o.x, pz - o.z) < o.r * 0.95) return true;
  }
  return false;
}

function doSprint() {
  if (player.sprintCd > 0 || !player.alive) return;
  player.sprintT = 0.32;
  player.sprintCd = 2.8;
  sfx('dash');
  spawnRing(yawObj.position.x, 0.35, yawObj.position.z, 0x6fe3ff, 1.6);
}

function doJump() {
  if (state.phase !== 'playing' || !player.alive) return;
  if (!player.grounded || player.jumpCd > 0) return;
  player.vy = 11.6;
  player.grounded = false;
  player.jumpCd = 0.22;
  spawnRing(yawObj.position.x, 0.14, yawObj.position.z, 0x9fe8ff, 1.1);
  for (let i = 0; i < 3; i++) {
    spawnParticle(yawObj.position.x + rand(-0.3, 0.3), 0.25, yawObj.position.z + rand(-0.3, 0.3), 0xbfd4e2);
  }
  sfx('dash');
}

function landEffect() {
  const x = yawObj.position.x;
  const z = yawObj.position.z;
  if (window.ArenaFX) {
    ArenaFX.land(new THREE.Vector3(x, 0.02, z));
    sfx('hit');
    return;
  }
  spawnRing(x, 0.1, z, 0x9fb8c8, 1.9);
  // 落地扬尘：一笔横铺的墨迹 + 两笔短的
  spawnBrush(x, 0.18, z, 0xb6c6d2, 0, 1.6, true);
  spawnBrush(x + 0.5, 0.16, z + 0.3, 0x9fb0bd, 0.9, 1.0, true);
  spawnBrush(x - 0.45, 0.16, z - 0.2, 0x9fb0bd, -1.2, 1.0, true);
  for (let i = 0; i < 3; i++) {
    spawnParticle(x + rand(-0.5, 0.5), 0.2, z + rand(-0.5, 0.5), 0xb6c6d2);
  }
  sfx('hit');
}

/* 疾跑残影：脚下一圈快速淡出的青色痕迹 */
function spawnTrailGhost() {
  spawnRing(yawObj.position.x, 0.06, yawObj.position.z, CLASSES[state.cls].color, 0.9);
}

/* ---------------- 攻击 ---------------- */
function tryAttack() {
  const A = CLASSES[state.cls].attack;
  const mul = player.overdrive > 0 ? 1.35 : 1;
  const interval = A.interval * (player.overdrive > 0 ? 0.5 : 1);
  player.attackCd = interval;
  player.attackAnim = 0.22;

  if (CLASSES[state.cls].attackType === 'melee') meleeAttack(A.dmg * mul);
  else if (CLASSES[state.cls].attackType === 'hitscan') hitscanAttack(A.dmg * mul, A);
  else projectileAttack(A.dmg * mul, A);
}

function meleeAttack(dmg) {
  const A = CLASSES[state.cls].attack;
  const ox = yawObj.position.x;
  const oz = yawObj.position.z;
  const fx = -Math.sin(yawObj.rotation.y);
  const fz = -Math.cos(yawObj.rotation.y);
  let hits = 0;

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead) continue;
    const dx = e.pos.x - ox;
    const dz = e.pos.z - oz;
    const d = hyp(dx, dz);
    if (d > A.range + e.radius) continue;
    const dot = d > 0.0001 ? (dx / d) * fx + (dz / d) * fz : 1;
    const ang = Math.acos(clamp(dot, -1, 1));
    // arcDeg 按"半角"解释：66 表示左右各 66°，总张角 132°
    if (ang > A.arcDeg * Math.PI / 180) continue;
    damageEnemy(e, dmg);
    hits++;
  }

  // 联机对手也吃这一刀
  if (state.mode === 'online') {
    const rm = netRemoteAlive();
    if (rm) {
      const dx = rm.x - ox;
      const dz = rm.z - oz;
      const d = hyp(dx, dz);
      const dot = d > 0.0001 ? (dx / d) * fx + (dz / d) * fz : 1;
      const ang = Math.acos(clamp(dot, -1, 1));
      if (d <= A.range + 0.55 && ang <= A.arcDeg * Math.PI / 180) {
        if (netApplyLocalHit(rm, dmg, false)) hits++;
      }
    }
  }

  spawnSlashArc(0x9fe8ff);
  spawnRing(ox + fx * 1.6, 1.1, oz + fz * 1.6, 0x9fe8ff, 1.3);
  if (hits > 0) {
    flashHit();
    sfx('hit');
    yawObj.position.x += fx * 0.22;
    yawObj.position.z += fz * 0.22;
    clampPos(yawObj.position, 0.55);
  } else {
    sfx('slash');
  }
}

function hitscanAttack(dmg, A) {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camera.getWorldDirection(new THREE.Vector3());
  dir.x += rand(-A.spread, A.spread);
  dir.y += rand(-A.spread, A.spread);
  dir.z += rand(-A.spread, A.spread);
  dir.normalize();

  let best = null;
  let bestRemote = null;
  let bestT = Infinity;

  // 联机对手先参与射线判定
  if (state.mode === 'online') {
    const rm = netRemoteAlive();
    if (rm) {
      const c = new THREE.Vector3(rm.x, 1.05, rm.z);
      const t = raySphere(origin, dir, c, 0.62);
      if (t !== null && t < bestT) { bestT = t; bestRemote = rm; }
    }
  }

  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead) continue;
    const c = new THREE.Vector3(e.pos.x, 1.05, e.pos.z);
    const t = raySphere(origin, dir, c, e.radius * 1.3);
    if (t !== null && t < bestT) { bestT = t; best = e; }
  }

  if (best || bestRemote) {
    // 柱体按整根圆柱判定，避免用包围球导致"柱后目标"被打中
    let blockedT = Infinity;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const t = rayCylinder(origin, dir, o.x, o.z, o.r * 1.05, 0, WALL_H);
      if (t !== null && t < blockedT) blockedT = t;
    }
    if (blockedT < bestT) { best = null; bestRemote = null; }
  }

  const len = (best || bestRemote) ? bestT : 70;
  spawnMuzzleFlash();
  spawnTracer(origin, dir, len, CLASSES[state.cls].color);

  if (best) {
    const crit = Math.random() < 0.16;
    damageEnemy(best, dmg * (crit ? A.headMul : 1), crit);
    flashHit();
    sfx('hit');
  } else if (bestRemote) {
    const crit = Math.random() < 0.16;
    if (netApplyLocalHit(bestRemote, dmg * (crit ? A.headMul : 1), crit)) {
      flashHit();
      sfx('hit');
    }
  } else {
    sfx('shot');
  }
}

function projectileAttack(dmg, A) {
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const dir = camera.getWorldDirection(new THREE.Vector3());
  spawnProjectile(origin, dir, A.speed, dmg, 'player', A.splash, CLASSES[state.cls].color);
  sfx('cast');
}

function raySphere(origin, dir, center, radius) {
  const oc = center.clone().sub(origin);
  const t = oc.dot(dir);
  if (t < 0) return null;
  const d2 = oc.lengthSq() - t * t;
  if (d2 > radius * radius) return null;
  const thc = Math.sqrt(radius * radius - d2);
  return Math.max(0, t - thc);
}

/* 射线与竖直圆柱求交（柱子遮挡判定）
   返回最近命中距离，未命中返回 null */
function rayCylinder(origin, dir, cx, cz, radius, yMin, yMax) {
  const ox = origin.x - cx;
  const oz = origin.z - cz;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-8) return null;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0) return null;
  const y = origin.y + dir.y * t;
  if (y < yMin || y > yMax) return null;
  return t;
}

/* ---------------- 技能 ---------------- */
function castSkill(idx) {
  if (!player.alive) return;
  const C = CLASSES[state.cls];
  const S = C.skills[idx];
  if (!S) return;
  if (player.skillCd[idx] > 0) return;
  if (player.en < S.cost) {
    toast('能量不足', 700);
    return;
  }
  player.en -= S.cost;
  player.skillCd[idx] = S.cd;
  runSkill(S.id);
}

/* 范围/锥形技能对远端对手的判定：联机下技能不能只打 PVE 敌人 */
function aoeHitRemote(px, pz, radius, dmg, crit, fx, fz) {
  const rm = netRemoteAlive();
  if (!rm) return false;
  const dx = (rm.x || 0) - px;
  const dz = (rm.z || 0) - pz;
  const d = hyp(dx, dz);
  if (d > radius) return false;
  if (fx !== undefined) {
    const dot = d > 0.0001 ? (dx / d) * fx + (dz / d) * fz : 1;
    if (dot <= 0.55) return false;
  }
  netApplyLocalHit(rm, dmg, !!crit);
  return true;
}

function runSkill(id) {
  const yaw = yawObj.rotation.y;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const px = yawObj.position.x;
  const pz = yawObj.position.z;

  switch (id) {
    case 'dashSlash': {
      let hit = 0;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead) continue;
        const dx = e.pos.x - px;
        const dz = e.pos.z - pz;
        const d = hyp(dx, dz);
        const dot = d > 0.0001 ? (dx / d) * fx + (dz / d) * fz : 1;
        if (d < 6.5 && dot > 0.55) { damageEnemy(e, 55, true); hit++; }
      }
      if (aoeHitRemote(px, pz, 6.5, 55, true, fx, fz)) hit++;
      yawObj.position.x = clamp(px + fx * 5.6, -HALF + 1, HALF - 1);
      yawObj.position.z = clamp(pz + fz * 5.6, -HALF + 1, HALF - 1);
      clampPos(yawObj.position, 0.55);
      player.invul = Math.max(player.invul, 0.3);
      spawnSlashArc(0x6fe3ff);
      spawnRing(yawObj.position.x, 0.9, yawObj.position.z, 0x6fe3ff, 2.2);
      shake = 0.3;
      sfx(hit ? 'hit' : 'skill');
      break;
    }
    case 'whirl': {
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead) continue;
        const d = hyp(e.pos.x - px, e.pos.z - pz);
        if (d < 4.4) damageEnemy(e, 42);
      }
      aoeHitRemote(px, pz, 4.4, 42, false);
      spawnSlashArc(0x8ff0ff);
      spawnCastCircle(px, pz, 0x8ff0ff);
      spawnRing(px, 0.9, pz, 0x8ff0ff, 4.4);
      svfxRing(px, pz);
      shake = 0.22;
      sfx('skill');
      break;
    }
    case 'swordDomain': {
      player.domain = 6;
      player.domainTick = 0;
      toast('剑域展开', 900);
      spawnCastCircle(px, pz, 0x8ff0ff);
      spawnRing(px, 0.5, pz, 0x8ff0ff, 5);
      sfx('skill');
      break;
    }
    case 'roll': {
      const fwd = (input.keys['w'] ? 1 : 0) - (input.keys['s'] ? 1 : 0);
      const rgt = (input.keys['d'] ? 1 : 0) - (input.keys['a'] ? 1 : 0);
      let rx = fx * fwd + Math.cos(yaw) * rgt;
      let rz = fz * fwd - Math.sin(yaw) * rgt;
      if (hyp(rx, rz) < 0.1) { rx = fx; rz = fz; }
      const m = hyp(rx, rz);
      yawObj.position.x = clamp(px + (rx / m) * 6.2, -HALF + 1, HALF - 1);
      yawObj.position.z = clamp(pz + (rz / m) * 6.2, -HALF + 1, HALF - 1);
      clampPos(yawObj.position, 0.55);
      player.invul = 0.5;
      spawnRing(px, 0.5, pz, 0xffcf6b, 1.8);
      sfx('dash');
      break;
    }
    case 'grenade': {
      const origin = camera.getWorldPosition(new THREE.Vector3());
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const gx = clamp(origin.x + dir.x * 16, -HALF + 1.5, HALF - 1.5);
      const gz = clamp(origin.z + dir.z * 16, -HALF + 1.5, HALF - 1.5);
      spawnDelayedBlast(gx, gz, 0.9, 4.2, 62, 0xff9a6b);
      spawnCastCircle(gx, gz, 0xff9a6b);
      sfx('cast');
      break;
    }
    case 'overdrive': {
      player.overdrive = 8;
      toast('火力全开', 1000);
      spawnRing(px, 0.6, pz, 0xffcf6b, 3);
      sfx('skill');
      break;
    }
    case 'frostRing': {
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead) continue;
        const d = hyp(e.pos.x - px, e.pos.z - pz);
        if (d < 6.5) { damageEnemy(e, 14); e.slow = 3.2; }
      }
      aoeHitRemote(px, pz, 6.5, 14, false);
      spawnCastCircle(px, pz, 0x8fc9ff);
      spawnRing(px, 0.4, pz, 0x8fc9ff, 6.5);
      sfx('skill');
      break;
    }
    case 'blink': {
      const nx = clamp(px + fx * 8, -HALF + 1.2, HALF - 1.2);
      const nz = clamp(pz + fz * 8, -HALF + 1.2, HALF - 1.2);
      spawnCastCircle(px, pz, 0xb98cff);
      spawnRing(px, 0.5, pz, 0xb98cff, 1.6);
      yawObj.position.x = nx;
      yawObj.position.z = nz;
      clampPos(yawObj.position, 0.55);
      player.invul = 0.45;
      spawnCastCircle(nx, nz, 0xb98cff);
      spawnRing(nx, 0.5, nz, 0xb98cff, 1.6);
      sfx('dash');
      break;
    }
    case 'meteor': {
      const mx = clamp(px + fx * 13, -HALF + 2, HALF - 2);
      const mz = clamp(pz + fz * 13, -HALF + 2, HALF - 2);
      spawnDelayedBlast(mx, mz, 1.1, 6.2, 100, 0xb98cff);
      spawnCastCircle(mx, mz, 0xb98cff);
      sfx('cast');
      break;
    }
  }
}

function svfxRing(x, z) {
  spawnRing(x, 1.6, z, 0xffffff, 4.4);
}

/* ---------------- 敌人 ---------------- */
function buildEnemyMesh(type) {
  // 形象由 art.js（白露的资产模块）接管；下面保留旧几何体实现作为低配回退
  if (window.ArenaArt && ArenaArt.buildFighter) {
    return ArenaArt.buildFighter(type);
  }
  const g = new THREE.Group();
  const color = TYPES[type].color;

  const mat = (c, e) => new THREE.MeshStandardMaterial({
    color: c, emissive: e === undefined ? 0x000000 : e, roughness: 0.42, metalness: 0.3
  });

  if (type === 'grunt') {
    const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), mat(0x7a1e2c, 0x5a0f1c));
    body.position.y = 0.95;
    g.add(body);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), new THREE.MeshBasicMaterial({ color: color }));
    core.position.y = 0.95;
    g.add(core);
    const base = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 6, 18), new THREE.MeshBasicMaterial({ color: 0x8a2233 }));
    base.rotation.x = Math.PI / 2;
    base.position.y = 0.14;
    g.add(base);
  } else if (type === 'shooter') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 12), mat(0x4b2a6b, 0x2c1450));
    body.position.y = 1.15;
    g.add(body);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), new THREE.MeshBasicMaterial({ color: color }));
    core.position.y = 1.15;
    g.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 6, 22), new THREE.MeshBasicMaterial({ color: 0x9c74ff }));
    ring.position.y = 1.15;
    g.add(ring);
    g.userData.ring = ring;
  } else if (type === 'elite') {
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.82, 0), mat(0x7a3a1c, 0x54200f));
    body.position.y = 1.3;
    g.add(body);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), new THREE.MeshBasicMaterial({ color: color }));
    core.position.y = 1.3;
    g.add(core);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95 + i * 0.16, 0.04, 6, 24), new THREE.MeshBasicMaterial({ color: 0xff9a6b }));
      ring.rotation.x = Math.PI / 2 + i * 0.5;
      ring.position.y = 1.3;
      g.add(ring);
    }
  } else if (type === 'boss') {
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), mat(0x5a0f1c, 0x3a0710));
    body.position.y = 1.9;
    g.add(body);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 14), new THREE.MeshBasicMaterial({ color: 0xff3860 }));
    core.position.y = 1.9;
    g.add(core);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.8 + i * 0.28, 0.06, 8, 28),
        new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffcf6b : 0xff5c72 })
      );
      ring.position.y = 1.9;
      ring.rotation.x = Math.PI / 2 + i * 0.6;
      g.add(ring);
    }
    g.userData.rings = g.children.filter(c => c.geometry && c.geometry.type === 'TorusGeometry');
  } else {
    // duelist 人形对手
    const skin = new THREE.MeshStandardMaterial({ color: 0x24384a, roughness: 0.5, metalness: 0.4, emissive: 0x0d2230 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.0, 8), mat(0x1d3d40, 0x0b2a2a));
    torso.position.y = 0.86;
    g.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), skin);
    head.position.y = 1.52;
    g.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0x2ee6c0 }));
    visor.position.set(0, 1.53, -0.18);
    g.add(visor);
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 6), skin);
    legL.position.set(-0.13, 0.35, 0);
    g.add(legL);
    const legR = legL.clone();
    legR.position.x = 0.13;
    g.add(legR);
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.62, 6), skin);
    armL.position.set(-0.3, 0.98, 0);
    armL.rotation.z = 0.18;
    g.add(armL);
    const armR = armL.clone();
    armR.position.x = 0.3;
    armR.rotation.z = -0.18;
    g.add(armR);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.5), new THREE.MeshStandardMaterial({ color: 0x33475c, metalness: 0.7, roughness: 0.4 }));
    gun.position.set(0.34, 1.0, -0.36);
    g.add(gun);
  }

  return g;
}

function spawnEnemy(type, pos) {
  if (enemies.length > 26) return;
  const T = TYPES[type];
  const waveScale = 1 + (state.wave - 1) * (type === 'boss' ? 0.1 : 0.16);
  const e = {
    type: type,
    pos: pos.clone(),
    hp: T.hp * waveScale,
    maxHp: T.hp * waveScale,
    speed: T.speed,
    radius: T.radius,
    dmg: T.dmg,
    attackCd: rand(0.2, 0.8),
    flash: 0,
    slow: 0,
    dead: false,
    spawn: 0.55,
    strafe: Math.random() < 0.5 ? 1 : -1,
    strafeT: rand(1, 2.6),
    summonT: 9,
    wind: 0,
    baseScale: window.ArenaArt ? ArenaArt.scaleOf(type) : 1,
    mesh: buildEnemyMesh(type)
  };
  e.mesh.position.copy(e.pos);
  e.mesh.scale.setScalar(e.baseScale * 0.08);
  scene.add(e.mesh);
  enemies.push(e);
  return e;
}

function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dead) { enemies.splice(i, 1); continue; }

    if (e.spawn > 0) {
      e.spawn -= dt;
      const k = clamp(1 - e.spawn / 0.55, 0, 1);
      e.mesh.scale.setScalar(e.baseScale * (0.08 + 0.92 * k));
    }
    if (e.flash > 0) e.flash -= dt;
    if (e.slow > 0) e.slow -= dt;
    e.attackCd -= dt;
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafeT = rand(1.2, 2.6); e.strafe *= -1; }

    const dx = yawObj.position.x - e.pos.x;
    const dz = yawObj.position.z - e.pos.z;
    const d = hyp(dx, dz) || 1;
    const nx = dx / d;
    const nz = dz / d;
    const spd = e.speed * (e.slow > 0 ? 0.5 : 1);

    if (e.type === 'grunt' || e.type === 'elite') {
      const reach = e.radius + 2.2; // 停在两米半左右出手，避免糊满镜头
      if (d > reach) {
        e.pos.x += nx * spd * dt;
        e.pos.z += nz * spd * dt;
      } else if (e.wind > 0) {
        // 出手前摇：脚下亮一圈红环，给玩家闪避或起跳的窗口
        e.wind -= dt;
        if (e.wind <= 0) {
          const onGround = (player.y - PLAYER_H) < 0.85;
          if (onGround && !losBlocked(e.pos.x, e.pos.z, yawObj.position.x, yawObj.position.z)) {
            damagePlayer(e.dmg);
            spawnRing(e.pos.x, 0.9, e.pos.z, 0xff5c72, 1.2);
          }
        }
      } else if (e.attackCd <= 0) {
        e.wind = e.type === 'elite' ? 0.52 : 0.42;
        e.attackCd = (e.type === 'elite' ? 1.3 : 1.05) + e.wind;
        spawnRing(e.pos.x, 0.07, e.pos.z, 0xff5c72, e.radius + 2.4);
      }
    } else if (e.type === 'shooter') {
      if (d > 15) {
        e.pos.x += nx * spd * dt;
        e.pos.z += nz * spd * dt;
      } else if (d < 9) {
        e.pos.x -= nx * spd * dt;
        e.pos.z -= nz * spd * dt;
      } else {
        e.pos.x += -nz * spd * 0.7 * e.strafe * dt;
        e.pos.z += nx * spd * 0.7 * e.strafe * dt;
      }
      if (e.attackCd <= 0 && d < 36) {
        e.attackCd = 1.7;
        fireEnemyShot(e, 0.05);
      }
    } else if (e.type === 'boss') {
      if (d > 13) {
        e.pos.x += nx * spd * dt;
        e.pos.z += nz * spd * dt;
      } else if (d < 7) {
        e.pos.x -= nx * spd * dt;
        e.pos.z -= nz * spd * dt;
      }
      if (e.attackCd <= 0) {
        e.attackCd = 2.3;
        bossBurst(e);
      }
      e.summonT -= dt;
      if (e.summonT <= 0) {
        e.summonT = 9;
        for (let k = 0; k < 2; k++) {
          spawnEnemy('grunt', new THREE.Vector3(e.pos.x + rand(-2, 2), 0, e.pos.z + rand(-2, 2)));
        }
        toast('BOSS 召唤援军', 900);
      }
    } else if (e.type === 'duelist') {
      if (d > 14) {
        e.pos.x += nx * spd * dt;
        e.pos.z += nz * spd * dt;
      } else if (d < 7) {
        e.pos.x -= nx * spd * dt;
        e.pos.z -= nz * spd * dt;
      } else {
        e.pos.x += -nz * spd * 0.8 * e.strafe * dt;
        e.pos.z += nx * spd * 0.8 * e.strafe * dt;
      }
      if (e.attackCd <= 0 && d < 30) {
        e.attackCd = 0.62;
        fireEnemyShot(e, 0.09);
      }
    }

    // 边界与柱体
    clampPos(e.pos, e.radius + 0.4);

    // 敌人之间推离
    for (let j = 0; j < enemies.length; j++) {
      if (j === i) continue;
      const other = enemies[j];
      const ddx = e.pos.x - other.pos.x;
      const ddz = e.pos.z - other.pos.z;
      const dd = hyp(ddx, ddz);
      const minD = e.radius + other.radius;
      if (dd < minD && dd > 0.0001) {
        e.pos.x = other.pos.x + (ddx / dd) * minD;
        e.pos.z = other.pos.z + (ddz / dd) * minD;
      }
    }

    // 与玩家保持最小间距，避免贴脸挡住视线（放在推离之后，防止被同伴挤到脸上）
    if (player.alive) {
      const pdx = e.pos.x - yawObj.position.x;
      const pdz = e.pos.z - yawObj.position.z;
      const pd = hyp(pdx, pdz);
      const minPD = e.radius + 2.0;
      if (pd < minPD && pd > 0.0001) {
        e.pos.x = yawObj.position.x + (pdx / pd) * minPD;
        e.pos.z = yawObj.position.z + (pdz / pd) * minPD;
        clampPos(e.pos, e.radius + 0.4);
      }
    }

    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = Math.atan2(nx, nz);

    if (e.mesh.userData.ring) e.mesh.userData.ring.rotation.z += dt * 1.6;
    if (e.mesh.userData.rings) {
      e.mesh.userData.rings.forEach((r, idx) => { r.rotation.z += dt * (0.6 + idx * 0.3); });
    }

    setEmissiveFlash(e.mesh, e.flash > 0);
  }
}

function setEmissiveFlash(group, on) {
  group.traverse((o) => {
    if (o.isMesh && o.material && o.material.emissive) {
      if (on) {
        if (o.userData.baseEmissive === undefined) o.userData.baseEmissive = o.material.emissive.getHex();
        o.material.emissive.setHex(0xff2244);
      } else if (o.userData.baseEmissive !== undefined) {
        o.material.emissive.setHex(o.userData.baseEmissive);
        o.userData.baseEmissive = undefined;
      }
    }
  });
}

function fireEnemyShot(e, spread) {
  const origin = new THREE.Vector3(e.pos.x, 1.25, e.pos.z);
  const target = new THREE.Vector3(yawObj.position.x, 1.3, yawObj.position.z);
  const dir = target.sub(origin).normalize();
  dir.x += rand(-spread, spread);
  dir.z += rand(-spread, spread);
  dir.y += rand(-spread * 0.4, spread * 0.4);
  dir.normalize();
  spawnProjectile(origin, dir, 15, e.dmg, 'enemy', 0, 0xff5c72);
  sfx('enemyShot');
}

function bossBurst(e) {
  const base = Math.atan2(yawObj.position.x - e.pos.x, yawObj.position.z - e.pos.z);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 3 + (i / (n - 1)) * (Math.PI * 2 / 3);
    const dir = new THREE.Vector3(
      Math.sin(base + a),
      rand(-0.05, 0.05),
      Math.cos(base + a)
    ).normalize();
    spawnProjectile(new THREE.Vector3(e.pos.x, 1.8, e.pos.z), dir, 13, e.dmg, 'enemy', 0, 0xff3860);
  }
  sfx('enemyShot');
}

/* ---------------- 弹丸与特效 ---------------- */
function spawnProjectile(origin, dir, speed, dmg, owner, splash, color) {
  const mesh = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: color }));
  mesh.scale.setScalar(splash > 0 ? 2.2 : 1.6);
  mesh.position.copy(origin);
  scene.add(mesh);
  projectiles.push({
    mesh: mesh,
    pos: origin.clone(),
    vel: dir.clone().multiplyScalar(speed),
    dmg: dmg,
    owner: owner,
    splash: splash || 0,
    life: 5
  });
}

function removeProjectile(i) {
  const pr = projectiles[i];
  scene.remove(pr.mesh);
  if (pr.mesh.material) pr.mesh.material.dispose();
  projectiles.splice(i, 1);
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.pos.addScaledVector(pr.vel, dt);
    pr.mesh.position.copy(pr.pos);
    pr.life -= dt;

    if (pr.life <= 0 || Math.abs(pr.pos.x) > HALF - 0.3 || Math.abs(pr.pos.z) > HALF - 0.3) {
      removeProjectile(i);
      continue;
    }

    let blocked = false;
    for (let k = 0; k < obstacles.length; k++) {
      const o = obstacles[k];
      if (hyp(pr.pos.x - o.x, pr.pos.z - o.z) < o.r) { blocked = true; break; }
    }
    if (blocked) { removeProjectile(i); continue; }

    if (pr.owner === 'enemy') {
      const dx = pr.pos.x - yawObj.position.x;
      const dz = pr.pos.z - yawObj.position.z;
      // 以玩家当前高度为基准，跳起来能躲低飞弹丸
      const bodyY = player.y - 0.45;
      if (dx * dx + dz * dz < 0.36 && pr.pos.y > bodyY - 0.85 && pr.pos.y < bodyY + 0.9) {
        damagePlayer(pr.dmg);
        removeProjectile(i);
      }
      continue;
    }

    let hitAny = false;
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (e.dead) continue;
      const dx = pr.pos.x - e.pos.x;
      const dz = pr.pos.z - e.pos.z;
      const r = e.radius + 0.22;
      // 判定加高度带，避免朝天上打的弹丸命中地面上的敌人
      if (dx * dx + dz * dz < r * r && pr.pos.y > 0.1 && pr.pos.y < 2.4) {
        if (pr.splash > 0) splashDamage(pr.pos, pr.splash, pr.dmg);
        else damageEnemy(e, pr.dmg);
        removeProjectile(i);
        hitAny = true;
        break;
      }
    }
    if (hitAny) continue;

    // 联机：法球也要能砸到对面的真人
    const rm = netRemoteAlive();
    if (rm) {
      const dx = pr.pos.x - (rm.x || 0);
      const dz = pr.pos.z - (rm.z || 0);
      const r = 0.62 + 0.22;
      if (dx * dx + dz * dz < r * r && pr.pos.y > 0.1 && pr.pos.y < 2.4) {
        if (pr.splash > 0) splashDamage(pr.pos, pr.splash, pr.dmg);
        else netApplyLocalHit(rm, pr.dmg, false);
        removeProjectile(i);
      }
    }
  }
}

function splashDamage(center, radius, dmg) {
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead) continue;
    const d = hyp(e.pos.x - center.x, e.pos.z - center.z);
    if (d < radius + e.radius) {
      const falloff = 1 - Math.min(0.45, d / (radius * 2.4));
      damageEnemy(e, dmg * falloff);
    }
  }

  // 联机：法球与技能的范围伤害同样需要打到对手
  if (state.mode === 'online') {
    const rm = netRemoteAlive();
    if (rm) {
      const d = hyp(rm.x - center.x, rm.z - center.z);
      if (d < radius + 0.6) {
        const falloff = 1 - Math.min(0.45, d / (radius * 2.4));
        netApplyLocalHit(rm, dmg * falloff, false);
      }
    }
  }
}

/* 笔触：一片带收锋的墨痕，加法混合；命中、扬尘、冲刺共用一套语言 */
function spawnBrush(x, y, z, color, angle, scale, flat) {
  const s = scale || 1;
  const shape = new THREE.Shape();
  shape.moveTo(-0.2 * s, 0);
  shape.quadraticCurveTo(0.0, 0.1 * s, 0.46 * s, 0.01 * s);
  shape.quadraticCurveTo(0.0, -0.08 * s, -0.2 * s, 0);

  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 10),
    new THREE.MeshBasicMaterial({
      color: color || 0xffffff, transparent: true, opacity: 0.38,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
    })
  );

  if (flat) {
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = angle || 0;
  } else {
    mesh.rotation.y = yawObj.rotation.y + Math.PI + (angle || 0);
  }

  mesh.position.set(x, y, z);
  scene.add(mesh);
  effects.push({ mesh: mesh, kind: 'brush', life: 0.22, maxLife: 0.22 });
}

function spawnRing(x, y, z, color, radius) {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.55, radius, 36),
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  scene.add(mesh);
  effects.push({ mesh: mesh, kind: 'ring', life: 0.42, maxLife: 0.42, r: radius });
}

function spawnExplosion(x, y, z, r) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff9a6b, transparent: true, opacity: 0.9 })
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
  effects.push({ mesh: mesh, kind: 'explode', life: 0.5, maxLife: 0.5, r: r });
  for (let i = 0; i < 9; i++) spawnParticle(x, y, z);
  shake = Math.min(0.6, shake + 0.25);
}

function spawnParticle(x, y, z, color) {
  const mesh = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: color || 0xffcf6b, transparent: true }));
  mesh.scale.setScalar(rand(0.6, 1.4));
  mesh.position.set(x, y, z);
  scene.add(mesh);
  effects.push({
    mesh: mesh, kind: 'particle', life: 0.6, maxLife: 0.6,
    vel: new THREE.Vector3(rand(-3, 3), rand(1, 5), rand(-3, 3))
  });
}

function spawnTracer(origin, dir, len, color) {
  const end = origin.clone().addScaledVector(dir, len);
  const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color || 0xffe9a8, transparent: true, opacity: 0.9 }));
  scene.add(line);
  effects.push({ mesh: line, kind: 'tracer', life: 0.09, maxLife: 0.09 });
}

function spawnDelayedBlast(x, z, delay, radius, dmg, color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.92, radius, 40),
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.06, z);
  scene.add(ring);
  effects.push({
    mesh: ring, kind: 'delayed', life: delay, maxLife: delay,
    radius: radius, dmg: dmg, blastColor: color, cx: x, cz: z
  });
}

/* 斩击弧：贴在地面的一道扇形刀光，跟着玩家朝向走 */
function spawnSlashArc(color) {
  // fx.js 的墨斩：三段式（前摇 / 刃线 / 飞白），不再铺地面扇形
  if (window.ArenaFX) {
    const p = camera.getWorldPosition(new THREE.Vector3());
    const d = camera.getWorldDirection(new THREE.Vector3());
    p.addScaledVector(d, 0.95);
    // 整组推到右下，让准心保持干净
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    p.addScaledVector(right, 0.26);
    p.y -= 0.22;
    ArenaFX.slash(p, camera.rotation.y);
    return;
  }
  const geo = new THREE.RingGeometry(0.85, 3.05, 24, 1, -0.95, 1.9);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: color || 0x9fe8ff, transparent: true, opacity: 0.7,
    side: THREE.DoubleSide, depthWrite: false
  }));
  mesh.position.set(yawObj.position.x, yawObj.position.y - 1.35, yawObj.position.z);
  mesh.rotation.set(-Math.PI / 2, yawObj.rotation.y + Math.PI / 2, 0);
  scene.add(mesh);
  effects.push({ mesh: mesh, kind: 'arc', life: 0.16, maxLife: 0.16 });
}

/* 枪口火光：打在枪管口，不再盖在准心上 */
function spawnMuzzleFlash() {
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const muzzle = new THREE.Vector3(0.31, 1.03, -0.96);
  if (weaponObj) {
    weaponObj.localToWorld(muzzle);
  } else {
    muzzle.copy(camera.getWorldPosition(new THREE.Vector3())).addScaledVector(dir, 0.9);
  }
  // fx.js 的击发：墨花 + 弹道，枪口之外不占准心
  if (window.ArenaFX) {
    ArenaFX.muzzle(muzzle, camera.rotation.y);
    return;
  }
  const mesh = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({
    color: CLASSES[state.cls].color, transparent: true, opacity: 0.9
  }));
  mesh.scale.setScalar(1.15);
  mesh.position.copy(muzzle);
  scene.add(mesh);
  effects.push({ mesh: mesh, kind: 'flash', life: 0.07, maxLife: 0.07 });
}

/* 施法法阵：内外两层反向旋转的圆环 */
function spawnCastCircle(x, z, color) {
  const inner = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.74, 24),
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(x, 0.05, z);
  scene.add(inner);

  const outer = new THREE.Mesh(
    new THREE.RingGeometry(1.42, 1.58, 30, 1, 0, Math.PI * 1.4),
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(x, 0.05, z);
  scene.add(outer);

  effects.push({ mesh: inner, kind: 'castIn', life: 0.55, maxLife: 0.55, spin: 2.2 });
  effects.push({ mesh: outer, kind: 'castOut', life: 0.55, maxLife: 0.55, spin: -1.1 });
}

/* 击杀碎片：向四周迸开的八面体 */
function spawnShards(pos, count, color) {
  for (let i = 0; i < count; i++) {
    const geo = new THREE.OctahedronGeometry(rand(0.06, 0.11), 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color, transparent: true }));
    mesh.position.set(pos.x + rand(-0.35, 0.35), rand(0.7, 1.5), pos.z + rand(-0.35, 0.35));
    scene.add(mesh);
    effects.push({
      mesh: mesh, kind: 'shard', life: 0.55, maxLife: 0.55,
      vel: new THREE.Vector3(rand(-3.4, 3.4), rand(2, 5.4), rand(-3.4, 3.4))
    });
  }
}

function updateEffects(dt) {
  // 同屏特效上限 48：超了先清最老的；陨星的预警圈（delayed）不参与清理
  if (effects.length > 48) {
    for (let j = 0; j < effects.length && effects.length > 48; j++) {
      if (effects[j].kind === 'delayed') continue;
      const old = effects.splice(j, 1)[0];
      scene.remove(old.mesh);
      if (old.mesh.geometry && !old.mesh.geometry.userData.shared) old.mesh.geometry.dispose();
      if (old.mesh.material) old.mesh.material.dispose();
      j--;
    }
  }
  for (let i = effects.length - 1; i >= 0; i--) {
    const f = effects[i];
    f.life -= dt;
    const k = clamp(1 - f.life / f.maxLife, 0, 1);

    if (f.kind === 'delayed') {
      f.mesh.material.opacity = 0.25 + Math.abs(Math.sin(f.life * 14)) * 0.45;
      if (f.life <= 0) {
        splashDamage(new THREE.Vector3(f.cx, 0.4, f.cz), f.radius, f.dmg);
        spawnExplosion(f.cx, 1.0, f.cz, f.radius * 0.65);
        f.mesh.material.color.setHex(f.blastColor);
        f.mesh.scale.setScalar(1.6);
        f.mesh.material.opacity = 0.8;
        f.kind = 'ring';
        f.life = 0.28;
        f.maxLife = 0.28;
        f.r = f.radius;
        sfx('cast');
        continue;
      }
    } else if (f.kind === 'ring') {
      f.mesh.scale.setScalar(0.35 + k * 1.5);
      f.mesh.material.opacity = (1 - k) * 0.85;
    } else if (f.kind === 'explode') {
      f.mesh.scale.setScalar(0.35 + k * f.r * 1.7);
      f.mesh.material.opacity = (1 - k) * 0.9;
    } else if (f.kind === 'particle') {
      f.vel.y -= 9 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.material.opacity = 1 - k;
    } else if (f.kind === 'arc') {
      f.mesh.material.opacity = (1 - k) * 0.7;
      f.mesh.rotation.y = yawObj.rotation.y + Math.PI / 2;
    } else if (f.kind === 'brush') {
      f.mesh.material.opacity = (1 - k) * 0.38;
      f.mesh.scale.setScalar(1 + k * 0.85);
    } else if (f.kind === 'flash') {
      f.mesh.material.opacity = (1 - k) * 0.9;
      f.mesh.scale.setScalar(1.15 * (1 + k * 0.7));
    } else if (f.kind === 'castIn' || f.kind === 'castOut') {
      f.mesh.rotation.z += f.spin * dt;
      f.mesh.material.opacity = (1 - k) * (f.kind === 'castIn' ? 0.85 : 0.5);
    } else if (f.kind === 'shard') {
      f.vel.y -= 11 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += dt * 5;
      f.mesh.rotation.y += dt * 3.4;
      f.mesh.material.opacity = 1 - k;
    } else if (f.kind === 'tracer') {
      f.mesh.material.opacity = (1 - k) * 0.9;
    }

    if (f.life <= 0) {
      scene.remove(f.mesh);
      if (f.mesh.geometry && !f.mesh.geometry.userData.shared) f.mesh.geometry.dispose();
      if (f.mesh.material) f.mesh.material.dispose();
      effects.splice(i, 1);
    }
  }
}

/* ---------------- 伤害与死亡 ---------------- */
function damageEnemy(e, dmg, crit) {
  if (e.dead) return;
  e.hp -= dmg;
  e.flash = 0.12;
  hitStop = 0.05;
  spawnDamageText(e.pos, dmg, !!crit);
  if (window.ArenaFX) ArenaFX.hit(new THREE.Vector3(e.pos.x, 1.15, e.pos.z), yawObj.rotation.y + Math.PI);
  spawnBrush(e.pos.x, 1.15, e.pos.z, CLASSES[state.cls].color, rand(-0.5, 0.5), crit ? 1.35 : 1.0);
  for (let i = 0; i < (crit ? 3 : 2); i++) spawnParticle(e.pos.x, 1.1, e.pos.z, CLASSES[state.cls].color);
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  state.kills++;
  player.en = Math.min(player.maxEn, player.en + 9);
  scene.remove(e.mesh);
  disposeGroup(e.mesh);

  if (e.type === 'boss') {
    spawnExplosion(e.pos.x, 1.6, e.pos.z, 2.6);
    spawnShards(e.pos, 16, 0xff3860);
    toast('BOSS 击破', 1300);
  } else {
    spawnExplosion(e.pos.x, 1.1, e.pos.z, 1.1);
    spawnShards(e.pos, 7, TYPES[e.type].color);
  }
  sfx('kill');

  if (state.mode === 'pvp') {
    if (e.type === 'duelist') {
      state.scoreP++;
      state.enemyResp = 2.6;
      toast('击败对手 +1', 900);
      checkPvpEnd();
    } else {
      state.scoreP += 1;
      checkPvpEnd();
    }
  }
}

function damagePlayer(dmg) {
  if (player.invul > 0 || state.phase !== 'playing' || !player.alive) return;
  // 联机对战的血量由服务器仲裁，本地挨打只走 onNetHurt
  if (state.mode === 'online') return;
  // 调试沙盒：地址带 ?sandbox 时不掉血，用于检查动作与特效
  if (state.sandbox) return;
  player.hp -= dmg;
  player.invul = 0.55;
  player.hurtT = 0.2;
  if (window.ArenaFX) ArenaFX.vignette();
  else flashEl.classList.add('show');
  if (!window.ArenaFX) window.setTimeout(() => flashEl.classList.remove('show'), 200);
  shake = Math.min(0.5, shake + 0.2);
  sfx('hurt');

  if (player.hp <= 0) {
    player.hp = 0;
    player.alive = false;
    spawnExplosion(yawObj.position.x, 1.1, yawObj.position.z, 1.5);
    if (state.mode === 'pve') {
      endGame(false);
    } else {
      state.scoreE++;
      if (state.scoreE >= 3) { endGame(false); return; }
      player.respawn = 3;
      toast('重生倒计时 3', 1200);
      checkPvpEnd();
    }
  }
}

function checkPvpEnd() {
  if (state.mode !== 'pvp') return;
  if (state.scoreP >= 3) endGame(true);
  else if (state.scoreE >= 3) endGame(false);
}

/* ---------------- 伤害飘字 ---------------- */
function spawnDamageText(pos, amount, crit) {
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(pos.x, 1.95, pos.z).project(camera);
  if (v.z > 1) return;
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
  if (x < -60 || x > window.innerWidth + 60) return;

  const el = document.createElement('div');
  el.className = 'dmg' + (crit ? ' crit' : '');
  el.textContent = Math.round(amount);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  dmgLayerEl.appendChild(el);
  window.setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 720);
}

/* ---------------- 波次与对局 ---------------- */
function startWave() {
  // 首波只放 3 只，留出熟悉跳跃与疾跑的时间；之后按波次递增
  const count = state.wave === 1 ? 3 : 3 + state.wave * 2;
  const q = [];
  for (let i = 0; i < count; i++) {
    let t = 'grunt';
    const r = Math.random();
    if (state.wave >= 6 && r < 0.22) t = 'elite';
    else if (state.wave >= 3 && r < 0.42) t = 'shooter';
    q.push(t);
  }
  if (state.wave % 5 === 0) q.push('boss');
  state.spawnQueue = q;
  state.spawnTimer = 0;
  if (state.wave % 5 === 0) toast('BOSS 来袭', 1500);
}

function randomSpawnPos() {
  for (let i = 0; i < 40; i++) {
    const x = rand(-HALF + 3, HALF - 3);
    const z = rand(-HALF + 3, HALF - 3);
    const d = hyp(x - yawObj.position.x, z - yawObj.position.z);
    if (d > 11 && d < 30) return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, -HALF + 5);
}

function updateWave(dt) {
  if (state.mode !== 'pve') return;

  if (state.spawnQueue.length > 0) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnEnemy(state.spawnQueue.shift(), randomSpawnPos());
      state.spawnTimer = Math.max(0.32, 0.95 - state.wave * 0.045);
    }
  } else if (enemies.length === 0) {
    if (state.waveRest === null) state.waveRest = 2.4;
    state.waveRest -= dt;
    if (state.waveRest <= 0) {
      state.wave++;
      state.waveRest = null;
      startWave();
      toast('WAVE ' + state.wave, 1200);
      player.en = Math.min(player.maxEn, player.en + 22);
      player.hp = Math.min(player.maxHp, player.hp + 18);
    }
  }
}

function updatePvpRespawn(dt) {
  if (state.mode !== 'pvp') return;
  if (state.enemyResp > 0) {
    state.enemyResp -= dt;
    if (state.enemyResp <= 0) {
      state.enemyResp = 0;
      spawnEnemy('duelist', randomSpawnPos());
      toast('对手入场', 900);
    }
  }
}

function updateSkills(dt) {
  for (let i = 0; i < 3; i++) player.skillCd[i] = Math.max(0, player.skillCd[i] - dt);
  if (player.overdrive > 0) player.overdrive -= dt;
  if (player.domain > 0) {
    player.domain -= dt;
    player.domainTick -= dt;
    if (player.domainTick <= 0) {
      player.domainTick = 0.5;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead) continue;
        const d = hyp(e.pos.x - yawObj.position.x, e.pos.z - yawObj.position.z);
        if (d < 5.2) damageEnemy(e, 16);
      }
      aoeHitRemote(yawObj.position.x, yawObj.position.z, 5.2, 16, false);
    }
    if (player.domain <= 0) toast('剑域结束', 700);
  }
}

/* ---------------- 对局流程 ---------------- */
function startGame() {
  // PVE 进首领厅、PVP 留在竞技场：换场只换视觉与障碍，玩法占地仍是 ±HALF
  syncScene();
  resetWorld();
  state.phase = 'playing';
  state.elapsed = 0;
  state.kills = 0;
  state.wave = 1;
  state.scoreP = 0;
  state.scoreE = 0;
  state.spawnQueue = [];
  state.spawnTimer = 0;
  state.waveRest = null;
  state.enemyResp = 0;
  state.clsName = CLASSES[state.cls].name;

  input.keys = {};
  input.attacking = false;

  resetPlayer();
  buildWeapon();
  updateSkillUI();

  hudEl.classList.remove('hidden');
  overlayEl.classList.add('hidden');
  menuPanel.classList.add('hidden');
  pausePanel.classList.add('hidden');
  resultPanel.classList.add('hidden');

  modeLabelEl.textContent = state.mode === 'pve' ? 'PVE 副本'
    : state.mode === 'online' ? '局域网对战' : 'PVP 对决';

  if (state.mode === 'pve') {
    startWave();
    toast('WAVE 1', 1200);
  } else if (state.mode === 'online') {
    // 出生点由服务端分配，双方各占一侧，避免两人叠在同一格
    const n = netRef();
    if (n && n.spawn) {
      yawObj.position.set(n.spawn.x, player.y, n.spawn.z);
      yawObj.rotation.y = n.spawn.yaw || 0;
      pitchObj.rotation.x = 0;
    }
    ensureRemoteMesh();
    toast('对战开始', 1200);
  } else {
    spawnEnemy('duelist', new THREE.Vector3(0, 0, -14));
    toast('对决开始', 1200);
  }

  requestLock();
  sfx('start');
  updateHUD();
}

function endGame(win) {
  if (state.phase === 'over') return;
  state.phase = 'over';
  if (document.exitPointerLock) document.exitPointerLock();

  hudEl.classList.add('hidden');
  overlayEl.classList.remove('hidden');
  menuPanel.classList.add('hidden');
  pausePanel.classList.add('hidden');
  resultPanel.classList.remove('hidden');

  resultTitleEl.textContent = win ? '胜利' : '行动终止';
  resultSubEl.textContent = (state.mode === 'pve' ? 'PVE 副本'
    : state.mode === 'online' ? '局域网对战' : 'PVP 对决') + ' · ' + state.clsName;

  let rows;
  if (state.mode === 'pve') {
    rows = [
      ['抵达波次', state.wave],
      ['击杀数', state.kills],
      ['存活时间', fmtTime(state.elapsed)],
      ['职业', state.clsName]
    ];
  } else {
    rows = [
      ['比分（你 : 对手）', state.scoreP + ' : ' + state.scoreE],
      ['击杀数', state.kills],
      ['对局时长', fmtTime(state.elapsed)],
      ['职业', state.clsName]
    ];
  }
  resultStatsEl.innerHTML = rows.map(r => '<div class="line"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
}

function resetWorld() {
  while (enemies.length) {
    const e = enemies.pop();
    scene.remove(e.mesh);
    disposeGroup(e.mesh);
  }
  while (projectiles.length) {
    const p = projectiles.pop();
    scene.remove(p.mesh);
    if (p.mesh.material) p.mesh.material.dispose();
  }
  while (effects.length) {
    const f = effects.pop();
    scene.remove(f.mesh);
    if (f.mesh.geometry && !f.mesh.geometry.userData.shared) f.mesh.geometry.dispose();
    if (f.mesh.material) f.mesh.material.dispose();
  }
  dmgLayerEl.innerHTML = '';
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (!o.isMesh && !o.isLine) return;
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material && !o.material.userData.shared) o.material.dispose();
  });
}

function pauseGame() {
  if (state.phase !== 'playing') return;
  state.phase = 'paused';
  input.attacking = false;
  overlayEl.classList.remove('hidden');
  menuPanel.classList.add('hidden');
  resultPanel.classList.add('hidden');
  pausePanel.classList.remove('hidden');
}

function resumeGame() {
  overlayEl.classList.add('hidden');
  pausePanel.classList.add('hidden');
  state.phase = 'playing';
  requestLock();
}

function backToMenu() {
  state.phase = 'menu';
  resetWorld();
  hudEl.classList.add('hidden');
  overlayEl.classList.remove('hidden');
  pausePanel.classList.add('hidden');
  resultPanel.classList.add('hidden');
  menuPanel.classList.remove('hidden');
  if (document.exitPointerLock) document.exitPointerLock();
}

function requestLock() {
  if (canvas.requestPointerLock) {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }
}

/* ---------------- UI ---------------- */
function updateSkillUI() {
  const C = CLASSES[state.cls];
  skillsEl.innerHTML = '';
  C.skills.forEach((S) => {
    const d = document.createElement('div');
    d.className = 'skill';
    d.innerHTML = '<span class="k">' + S.key + '</span><span class="n">' + S.name + '</span><span class="cd"></span>';
    skillsEl.appendChild(d);
  });
}

function updateHUD() {
  if (!hudEl || hudEl.classList.contains('hidden')) return;
  const hpPct = clamp(player.hp / player.maxHp, 0, 1);
  hpFill.style.width = (hpPct * 100) + '%';
  hpText.textContent = Math.max(0, Math.ceil(player.hp)) + ' / ' + player.maxHp;

  const enPct = clamp(player.en / player.maxEn, 0, 1);
  enFill.style.width = (enPct * 100) + '%';
  enText.textContent = Math.ceil(player.en);

  if (stFill) {
    const stPct = clamp(player.stamina / player.maxStamina, 0, 1);
    stFill.style.width = (stPct * 100) + '%';
    stText.textContent = Math.ceil(player.stamina);
  }

  const C = CLASSES[state.cls];
  const nodes = skillsEl.children;
  for (let i = 0; i < 3; i++) {
    const el = nodes[i];
    if (!el) continue;
    const S = C.skills[i];
    const cd = player.skillCd[i];
    const pct = cd > 0 ? (cd / S.cd) * 100 : 0;
    const bar = el.querySelector('.cd');
    if (bar) bar.style.height = pct + '%';
    el.classList.toggle('cooling', cd > 0);
  }

  if (state.mode === 'pve') {
    let alive = 0;
    for (let i = 0; i < enemies.length; i++) if (!enemies[i].dead) alive++;
    objectiveEl.textContent = 'WAVE ' + state.wave + ' · 剩余 ' + (alive + state.spawnQueue.length);
  } else {
    objectiveEl.textContent = state.scoreP + ' : ' + state.scoreE + ' · 先到 3 杀';
  }
  timerEl.textContent = fmtTime(state.elapsed);
}

function toast(text, ms) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  if (toast._t) window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => toastEl.classList.remove('show'), ms || 1000);
}

function flashHit() {
  hitmarkerEl.classList.add('show');
  if (hitTimer) window.clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => hitmarkerEl.classList.remove('show'), 170);
}

function bindUI() {
  const modeBtns = document.querySelectorAll('#modeToggle button');
  modeBtns.forEach((b) => {
    b.addEventListener('click', () => {
      modeBtns.forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      state.mode = b.dataset.mode;
      // 联机模式要先填房间号，房间行展开
      const row = document.getElementById('onlineRow');
      if (row) row.classList.toggle('hidden', state.mode !== 'online');
      if (state.mode === 'online') {
        const roomEl = document.getElementById('roomInput');
        if (roomEl && !roomEl.value) roomEl.value = randomRoomCode();
      }
    });
  });

  const onlineQuit = document.getElementById('onlineQuit');
  if (onlineQuit) {
    onlineQuit.addEventListener('click', () => {
      const n = netRef();
      if (n) n.close();
      removeRemoteMesh();
      document.getElementById('onlinePanel').classList.add('hidden');
      menuPanel.classList.remove('hidden');
      state.phase = 'menu';
      if (state.mode === 'online') state.mode = 'pve';
      modeBtns.forEach(x => x.classList.toggle('on', x.dataset.mode === 'pve'));
      const row = document.getElementById('onlineRow');
      if (row) row.classList.add('hidden');
    });
  }

  const clsBtns = document.querySelectorAll('#classToggle button');
  clsBtns.forEach((b) => {
    b.addEventListener('click', () => {
      clsBtns.forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      state.cls = b.dataset.cls;
    });
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    initAudio();
    if (state.mode === 'online') startOnlineConnect();
    else startGame();
  });
  document.getElementById('resumeBtn').addEventListener('click', resumeGame);
  document.getElementById('quitBtn').addEventListener('click', backToMenu);
  document.getElementById('againBtn').addEventListener('click', () => {
    initAudio();
    // 联机：请服务器把房间重置成新一局，双方一起回到出生点
    if (state.mode === 'online') {
      const n = netRef();
      if (n && n.connected) { n.sendRestart(); toast('等待重开…', 900); return; }
      toast('连接已断开，请重新进入房间', 1600);
      return;
    }
    startGame();
  });
  document.getElementById('backBtn').addEventListener('click', backToMenu);
}

function bindInput() {
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', ' ', 'q', 'e', 'r', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0) {
      e.preventDefault();
    }
    initAudio();
    input.keys[k] = true;
    if (state.phase !== 'playing') return;
    if (k === ' ') doJump();
    if (k === 'shift') doSprint();
    if (k === 'q') castSkill(0);
    if (k === 'e') castSkill(1);
    if (k === 'r') castSkill(2);
  });

  document.addEventListener('keyup', (e) => {
    input.keys[e.key.toLowerCase()] = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (state.phase !== 'playing' || !lockActive) return;
    yawObj.rotation.y -= (e.movementX || 0) * 0.0022;
    pitchObj.rotation.x -= (e.movementY || 0) * 0.0022;
    pitchObj.rotation.x = clamp(pitchObj.rotation.x, -1.45, 1.45);
  });

  canvas.addEventListener('mousedown', (e) => {
    initAudio();
    if (state.phase !== 'playing') return;
    // 正常流程：第一次点击只用于锁定鼠标，不误触攻击
    if (!lockActive) { requestLock(); if (!state.tapTest) return; }
    if (e.button === 0) {
      input.attacking = true;
      // 调试模式（?tap）：单击即出一次手，方便自动化/无指针锁环境验证命中
      if (state.tapTest) tryAttack();
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.attacking = false;
  });

  document.addEventListener('pointerlockchange', () => {
    lockActive = document.pointerLockElement === canvas;
    if (!lockActive && state.phase === 'playing') pauseGame();
  });

  document.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('blur', () => {
    input.attacking = false;
    input.keys = {};
  });

  // 切到后台时自动暂停，避免"人不在还被怪打"
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.phase === 'playing') pauseGame();
  });
}

/* ---------------- 主循环 ---------------- */
function updateWeaponVisual(dt) {
  if (!weaponObj || !weaponBase) return;
  const k = player.attackAnim > 0 ? Math.sin((1 - player.attackAnim / 0.22) * Math.PI) : 0;
  const bobX = Math.sin(state.time * 2.1) * 0.006;
  const bobY = Math.sin(state.time * 4.2) * 0.005;
  // 疾跑摆动：横向 ±2cm 的节律，配合 FOV 给速度感
  const runK = Math.min(1, player.runT * 4);
  const sway = Math.sin(state.time * 9.5) * 0.02 * runK;
  weaponObj.position.set(
    weaponBase.x + bobX + sway,
    weaponBase.y + bobY - k * 0.05 + Math.abs(sway) * 0.35,
    weaponBase.z + k * 0.1
  );
  weaponObj.rotation.set(
    weaponBase.rx - k * 0.85,
    weaponBase.ry + k * 0.2,
    weaponBase.rz + k * 1.0 + sway * 2.2
  );
}

function applyShake(dt) {
  if (shake > 0) shake = Math.max(0, shake - dt * 1.6);
  const s = shake * 0.018;
  camera.position.x = rand(-s, s);
  camera.position.y = rand(-s, s);
  camera.position.z = rand(-s, s) * 0.4;
}

function animate() {
  requestAnimationFrame(animate);
  const raw = Math.min(clock.getDelta(), 0.05);
  let dt = raw;
  // 顿帧：命中后 50ms 内时间压到 12%，其余系统照常
  if (hitStop > 0) { hitStop -= raw; dt = raw * 0.12; }
  state.time += raw;

  if (state.phase === 'playing') {
    state.elapsed += dt;
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateSkills(dt);
    updateWave(dt);
    updatePvpRespawn(dt);
    updateWeaponVisual(dt);
    updateHUD();
    if (state.mode === 'online') {
      updateOnlineTimers(dt);
      netPump();
    }
  }

  updateEffects(dt);
  if (state.mode === 'online') updateRemote(dt);
  if (window.ArenaFX) ArenaFX.update(dt);
  if (window.ArenaScene) ArenaScene.update(dt);
  applyShake(dt);

  renderer.render(scene, camera);
}

/* ---------------- 联机（局域网对战） ---------------- */

const HERO_KEY = { blade: 'swordsman', gunner: 'gunner', mage: 'warlock' };
const CLS_LABEL = { blade: '剑客', gunner: '枪手', mage: '术士' };

let remoteGroup = null;
const remoteSmooth = { x: 0, y: 0, z: 0, yaw: 0, inited: false };
let onlineResp = 0;
let onlineStreak = 0;

/* 击杀播报：大字横幅 + 连杀后缀，1.5 秒自动收 */
const STREAK_LABEL = { 2: '双杀', 3: '三杀', 4: '四杀' };
function streakLabel(k) {
  if (k >= 5) return '超 神';
  return STREAK_LABEL[k] || '';
}

function showKillBanner(text, sub, mine) {
  const el = document.getElementById('killBanner');
  if (!el) return;
  el.className = mine ? 'mine' : '';
  el.innerHTML = '<div class="line">' + text + '</div>' + (sub ? '<div class="streak">' + sub + '</div>' : '');
  void el.offsetWidth; // 强制回流，让动画每次都能重播
  el.classList.add('show');
}

function netRef() { return window.ArenaNet || null; }

/* 只在对手活着时才是可命中目标 */
function netRemoteAlive() {
  const n = netRef();
  if (!n || !n.remote) return null;
  if (n.remote.hp !== undefined && n.remote.hp <= 0) return null;
  return n.remote;
}

function randomRoomCode() {
  const A = 'ABCDEFGJKLMNPQRSTUVWXY23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

function setRoomStatus(text) {
  const el = document.getElementById('onlineStatus');
  if (el) el.textContent = text;
}

function renderRoomPlayers() {
  const box = document.getElementById('onlinePlayers');
  const n = netRef();
  if (!box) return;
  const rows = [];
  const me = n && n.myId ? { name: n.myName, cls: n.myCls, id: n.myId } : { name: '你', cls: state.cls };
  rows.push('<div class="p"><span>' + me.name + '（你）</span><span class="tag">' + (CLS_LABEL[me.cls] || '剑客') + '</span></div>');
  if (n && n.remote) {
    rows.push('<div class="p"><span>' + n.remote.name + '</span><span class="tag">' + (CLS_LABEL[n.remote.cls] || '剑客') + '</span></div>');
  } else {
    rows.push('<div class="p waiting"><span>等待对手加入…</span><span class="tag">空位</span></div>');
  }
  box.innerHTML = rows.join('');
}

function startOnlineConnect() {
  const n = netRef();
  if (!n) {
    toast('联机模块未加载，检查 net.js', 1800);
    return;
  }
  const roomEl = document.getElementById('roomInput');
  const code = ((roomEl && roomEl.value.trim()) || '').toUpperCase() || randomRoomCode();
  if (roomEl) roomEl.value = code;

  menuPanel.classList.add('hidden');
  resultPanel.classList.add('hidden');
  pausePanel.classList.add('hidden');
  overlayEl.classList.remove('hidden');
  const panel = document.getElementById('onlinePanel');
  if (panel) panel.classList.remove('hidden');
  document.getElementById('roomCode').textContent = code;
  setRoomStatus('正在连接服务器…');
  renderRoomPlayers();

  n.connect({
    room: code,
    name: onlineName(),
    cls: state.cls,
    welcome: onNetWelcome,
    opponent: onNetOpponent,
    hurt: onNetHurt,
    hitOk: onNetHitOk,
    kill: onNetKill,
    respawn: onNetRespawn,
    shield: onNetShield,
    end: onNetEnd,
    restart: onNetRestart,
    leave: onNetLeave,
    close: onNetClose,
    error: onNetError
  });
}

function onlineName() {
  const el = document.getElementById('nameInput');
  return (el && el.value.trim()) || '玩家';
}

function onNetWelcome(m) {
  setRoomStatus(m.opponent ? '对手已在房间，准备开始' : '房间已创建，等待对手…');
  document.getElementById('roomCode').textContent = m.room || '';
  renderRoomPlayers();
  if (m.opponent) beginOnlineMatch();
}

function onNetOpponent(m) {
  setRoomStatus(m.name + ' 加入了房间');
  renderRoomPlayers();
  toast(m.name + ' 进入战场', 1400);
  beginOnlineMatch();
}

function beginOnlineMatch() {
  if (state.mode !== 'online') return;
  if (state.phase === 'playing') return;
  const panel = document.getElementById('onlinePanel');
  if (panel) panel.classList.add('hidden');
  onlineStreak = 0;
  const banner = document.getElementById('killBanner');
  if (banner) banner.classList.remove('show');
  startGame();
}

function onNetHitOk(m) {
  flashHit();
  sfx('hit');
}

/* 对手还在出生保护：这一下不算伤害，给个明确反馈 */
function onNetShield(m) {
  toast('对手的出生护盾还在，稍等半秒', 900);
  if (remoteGroup) remoteGroup.userData.flashT = 0.4;
}

function onNetHurt(m) {
  if (state.phase !== 'playing') return;
  player.hp = m.hp;
  player.invul = 0.45;
  player.hurtT = 0.2;
  flashEl.classList.add('show');
  window.setTimeout(() => flashEl.classList.remove('show'), 200);
  shake = Math.min(0.5, shake + 0.2);
  sfx('hurt');
  spawnDamageText(new THREE.Vector3(yawObj.position.x, 1.5, yawObj.position.z), m.dmg, false);
  if (player.hp <= 0) onlineKnockdown();
}

function onlineKnockdown() {
  if (!player.alive) return;
  player.alive = false;
  input.attacking = false;
  onlineResp = 3.2;
  toast('你被击倒，3 秒后回到战场', 1600);
}

function onNetRespawn(m) {
  player.alive = true;
  player.hp = m.hp;
  player.dead = false;
  yawObj.position.set(m.x, player.y, m.z);
  yawObj.rotation.y = m.yaw || 0;
  spawnRing(m.x, 0.5, m.z, 0x6ee3ff, 1.6);
  toast('已回到战场', 900);
}

function onNetKill(m) {
  const n = netRef();
  const mine = n && m.by === n.myId;
  state.scoreP = m.score ? (m.score[n.myId] || 0) : state.scoreP;
  state.scoreE = m.score ? (m.score[n.myId === 1 ? 2 : 1] || 0) : state.scoreE;

  const name = n && n.remote ? n.remote.name : '对手';
  if (mine) onlineStreak = Math.min(9, onlineStreak + 1);
  else onlineStreak = 0;
  showKillBanner(mine ? '击 倒  ' + name : '被 ' + name + ' 击倒', streakLabel(onlineStreak), !!mine);
  // 击杀点上开一圈金色冲击，读作"拿下"
  if (mine && n && n.remote) spawnRing(n.remote.x, 0.72, n.remote.z, 0xffd27a, 1.9);
}

function onNetEnd(m) {
  const n = netRef();
  const win = n && m.winner === n.myId;
  state.scoreP = m.score ? (m.score[n.myId] || 0) : state.scoreP;
  state.scoreE = m.score ? (m.score[n.myId === 1 ? 2 : 1] || 0) : state.scoreE;
  endGame(win);
}

/* 服务器重置了房间：双方满血、比分清零，直接开新一局 */
function onNetRestart(m) {
  const n = netRef();
  const me = ((m && m.players) || []).find((x) => x.id === (n && n.myId));
  onlineStreak = 0;
  onlineResp = 0;
  const banner = document.getElementById('killBanner');
  if (banner) banner.classList.remove('show');
  if (state.phase === 'playing') {
    if (me) {
      player.alive = true;
      player.hp = me.hp;
      player.dead = false;
      yawObj.position.set(me.x, 0, me.z);
      yawObj.rotation.y = me.yaw || 0;
    }
    toast('新一局开始', 900);
    return;
  }
  const over = document.getElementById('overlay');
  if (over) over.classList.add('hidden');
  startGame();
  toast('新一局开始', 900);
}

function onNetLeave(m) {
  toast('对手离开了房间', 1600);
  setRoomStatus('对手已离开，等待新的挑战者…');
  renderRoomPlayers();
  removeRemoteMesh();
  if (state.phase === 'playing') {
    state.phase = 'over';
    endGame(false);
  }
}

function onNetClose(info) {
  // 从未连上就断开（房间满/号错/服务没开）：只更新面板文案，不打成"掉线"
  if (info && info.wasConnected === false) {
    setRoomStatus('没能进入房间：检查房间号，或确认 server.js 是否在运行');
    return;
  }
  toast('与服务器断开', 1600);
  setRoomStatus('连接已断开，检查 server.js 是否在运行');
  const panel = document.getElementById('onlinePanel');
  if (panel) panel.classList.remove('hidden');
}

function onNetError(msg) {
  setRoomStatus(typeof msg === 'string' ? msg : '连接出错');
}

/* 远端玩家形象：用白露的玩家职业资产，按对手职业取 */
function removeRemoteMesh() {
  if (remoteGroup) {
    scene.remove(remoteGroup);
    disposeGroup(remoteGroup);
    remoteGroup = null;
  }
  remoteSmooth.inited = false;
}

function ensureRemoteMesh() {
  const n = netRef();
  if (!n || !n.remote) {
    removeRemoteMesh();
    return null;
  }
  const cls = n.remote.cls || 'blade';
  if (remoteGroup && remoteGroup.userData.cls === cls) return remoteGroup;
  removeRemoteMesh();

  const key = HERO_KEY[cls] || 'swordsman';
  const grp = window.ArenaArt && ArenaArt.buildHero
    ? ArenaArt.buildHero(key)
    : new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1.7, 8), new THREE.MeshStandardMaterial({ color: 0x6fe3ff }));
  grp.userData.cls = cls;
  // 头顶挂一个职业色标识环，远处也能认出对手
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.26, 0.022, 6, 20),
    new THREE.MeshBasicMaterial({ color: CLASSES[cls] ? CLASSES[cls].color : 0x6fe3ff })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 2.02;
  grp.add(ring);
  grp.userData.ring = ring;
  buildRemoteBar(grp);

  scene.add(grp);
  remoteGroup = grp;
  remoteSmooth.inited = false;
  return grp;
}

/* 对手头顶的名牌 + 血条：远处也能看清谁是谁、还剩多少血 */
function makeNameSprite(name) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  const txt = String(name || '对手').slice(0, 10);
  g.font = '700 40px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0, 0, 0, 0.9)';
  g.shadowBlur = 12;
  g.fillStyle = '#e6f5ff';
  g.fillText(txt, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.24, 0.31, 1);
  return sp;
}

function buildRemoteBar(grp) {
  const n = netRef();
  const holder = new THREE.Group();
  holder.position.y = 2.3;
  grp.add(holder);

  // 血条走 Canvas 贴图 + Sprite：永远正对镜头，也不吃深度排序的亏
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 40;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const barSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  barSprite.scale.set(0.98, 0.153, 1);
  holder.add(barSprite);

  const name = makeNameSprite(n && n.remote ? n.remote.name : '对手');
  name.position.y = 0.26;
  holder.add(name);

  const bar = { sprite: barSprite, canvas: canvas, ctx: ctx, tex: tex, lastRatio: -1 };
  paintRemoteBar(bar, 1);
  grp.userData.bar = bar;
  grp.userData.flashT = 0;

  // 受击闪光罩：只在本端打中对手时亮一下，不改共享材质
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.66, 14, 10),
    new THREE.MeshBasicMaterial({
      color: 0xff6478, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
    })
  );
  flash.position.y = 0.95;
  grp.add(flash);
  grp.userData.flash = flash;
}

/* 重绘对手血条：满血青、过半琥珀、残血红 */
function paintRemoteBar(bar, ratio) {
  const w = bar.canvas.width;
  const h = bar.canvas.height;
  const g = bar.ctx;
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(2, 8, 14, 0.93)';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(126, 210, 246, 0.55)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
  const col = ratio > 0.6 ? '#8ef0ff' : ratio > 0.32 ? '#ffc65c' : '#ff5060';
  const fw = Math.max(2, (w - 8) * ratio);
  g.fillStyle = col;
  g.fillRect(4, 4, fw, h - 8);
  g.fillStyle = 'rgba(255, 255, 255, 0.34)';
  g.fillRect(4, 4, fw, 3);
  bar.tex.needsUpdate = true;
}

/* 插值跟随：20Hz 上行 + 平滑，避免对手抖成幻灯片 */
function updateRemote(dt) {
  const n = netRef();
  if (!n || !n.remote) {
    if (remoteGroup) removeRemoteMesh();
    return;
  }
  const grp = ensureRemoteMesh();
  if (!grp) return;
  const r = n.remote;

  if (!remoteSmooth.inited) {
    remoteSmooth.x = r.x || 0;
    remoteSmooth.z = r.z || 0;
    remoteSmooth.y = r.y || 0;
    remoteSmooth.yaw = r.yaw || 0;
    remoteSmooth.inited = true;
  }
  const k = 1 - Math.pow(0.0018, dt);
  remoteSmooth.x += ((r.x || 0) - remoteSmooth.x) * k;
  remoteSmooth.z += ((r.z || 0) - remoteSmooth.z) * k;
  remoteSmooth.y += ((r.y || 0) - remoteSmooth.y) * k;

  // 角度走最短弧，避免过 ±π 时转一圈
  let dy = (r.yaw || 0) - remoteSmooth.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  remoteSmooth.yaw += dy * k;

  grp.position.set(remoteSmooth.x, remoteSmooth.y, remoteSmooth.z);
  grp.rotation.y = remoteSmooth.yaw;

  // 动作表现：跑动上下摆、攻击前倾、跳跃抬升
  const anim = r.anim || 'idle';
  const t = state.time;
  let bob = 0;
  let lean = 0;
  if (anim === 'run') bob = Math.sin(t * 11) * 0.045;
  else if (anim === 'attack') lean = 0.22;
  else if (anim === 'jump') bob = 0.06;
  grp.position.y += bob;
  grp.rotation.x = lean * 0.5;

  if (grp.userData.ring) grp.userData.ring.rotation.z += dt * 1.4;

  // 头顶血条：比例变了才重绘，省开销
  const bar = grp.userData.bar;
  if (bar) {
    const maxHp = r.maxHp || (CLASSES[r.cls] ? CLASSES[r.cls].hp : 110);
    const ratio = Math.max(0, Math.min(1, (typeof r.hp === 'number' ? r.hp : maxHp) / maxHp));
    if (Math.abs(ratio - bar.lastRatio) > 0.01 || bar.lastRatio < 0) {
      bar.lastRatio = ratio;
      paintRemoteBar(bar, ratio);
    }
  }

  // 被本端打中时闪一下红光，读作"打实了"
  if (grp.userData.flash) {
    grp.userData.flashT = Math.max(0, (grp.userData.flashT || 0) - dt * 3.4);
    grp.userData.flash.material.opacity = grp.userData.flashT * 0.62;
  }

  // 被击倒期间先消失，复活消息到了再回来
  const dead = typeof r.hp === 'number' && r.hp <= 0;
  if (grp.visible === dead) grp.visible = !dead;
}

function localAnimState() {
  if (!player.alive) return 'idle';
  if (!player.grounded) return 'jump';
  if (player.attackAnim > 0) return 'attack';
  if (player.runT > 0.25) return 'run';
  return 'idle';
}

function netPump() {
  const n = netRef();
  if (!n || state.mode !== 'online' || state.phase !== 'playing' || !n.connected) return;
  n.sendState({
    x: yawObj.position.x,
    y: player.y,
    z: yawObj.position.z,
    yaw: yawObj.rotation.y,
    anim: localAnimState()
  });
}

/* 被击倒后的复活倒计时：到点向服务器申请重生 */
function updateOnlineTimers(dt) {
  if (onlineResp <= 0) return;
  onlineResp -= dt;
  if (onlineResp <= 0) {
    onlineResp = 0;
    const n = netRef();
    if (n && n.connected) n.sendRespawn();
  }
}

/* 联机受伤只认服务器，本地挨打走这条 */
function netApplyLocalHit(target, dmg, crit) {
  const n = netRef();
  if (!n || !target) return false;
  n.sendHit(target.id, dmg);
  spawnDamageText(new THREE.Vector3(target.x, 1.45, target.z), Math.round(dmg), !!crit);
  hitStop = Math.max(hitStop, 0.045);
  if (remoteGroup) remoteGroup.userData.flashT = 1;
  return true;
}

/* 自测钩子：QA 用，不参与游戏逻辑 */
window.__arenaDebug = {
  state: state,
  player: player,
  enemies: enemies,
  spawn: spawnEnemy,
  jump: doJump,
  art: window.ArenaArt || null,
  camera: function () { return camera; },
  effects: function () { return effects; },
  input: function () { return input; },
  hitStop: function () { return hitStop; },
  attack: function () { tryAttack(); },
  net: function () { return window.ArenaNet || null; },
  remoteMesh: function () { return remoteGroup; },
  damage: damageEnemy,
  brush: spawnBrush,
  muzzle: spawnMuzzleFlash,
  render: function () { renderer.render(scene, camera); },
  fx: function () { return window.ArenaFX ? ArenaFX.stats() : null; },
  slash: function () { spawnSlashArc(CLASSES[state.cls].color); },
  orb: function (x, y, z) { if (window.ArenaFX) ArenaFX.orbBurst(new THREE.Vector3(x, y, z), 0); },
  // 手动推进一帧，供无 rAF 的环境（远程/无头）做确定性验证
  step: function (dt) {
    updatePlayer(dt);
    updateEffects(dt);
    if (window.ArenaFX) ArenaFX.update(dt);
    if (window.ArenaScene) ArenaScene.update(dt);
  }
};

/* ---------------- 启动 ---------------- */
init();

})();
