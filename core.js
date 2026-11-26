/* ============================================================================
   core.js — 《第七世界》规则层（GDD v1.0 的数值与数据唯一来源）
   ----------------------------------------------------------------------------
   职责边界：
   1) 只做"数据 + 纯函数"，不碰 three.js、不碰 DOM、不碰玩家状态对象；
   2) game.js / loot.js 通过 window.Rules 读取，任何数值不在业务代码里硬编码；
   3) 与《第七世界 · 游戏策划案 v1.0》第 4 / 5 / 6 / 7 / 8 / 14 章一一对应，
      公式改动只改这里，改完用 ?dump=1 打印自检表。

   对外接口：
     Rules.LEVEL   等级曲线与属性推导
     Rules.SKILL   技能点、技能等级效果
     Rules.CLASSES 六职业（P0：六系各一）
     Rules.MOBS    怪物血量/伤害/经验基准
     Rules.WORLDS  世界六段
     Rules.DUNGEONS 副本四档
     Rules.RARITY  稀有度五档 + 银武
     Rules.TUNE    PVE / PVP 分轨
     Rules.ECON    金币流入流出与强化费用
     Rules.playerStats() / Rules.mobHp() / Rules.mobDmg() / Rules.xpOf()
   ============================================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 等级
     GDD 4.2 / 14.1：need(L) = 5L² + 180L，上限 75，累计 1 230 250。 */
  var CAP = 75;

  function need(L) {
    L = Math.max(1, Math.round(L));
    return 5 * L * L + 180 * L;
  }

  /* 闭式求和 Σ(5k²+180k), k=1..L = 5L(L+1)(2L+1)/6 + 90L(L+1) */
  function cum(L) {
    L = Math.max(0, Math.round(L));
    return (5 * L * (L + 1) * (2 * L + 1)) / 6 + 90 * L * (L + 1);
  }

  /* 等级主属性：14 + 3.1L（L75 = 246.5） */
  function attr(L) { return 14 + 3.1 * L; }

  /* 装备主属性：8 + 2.6 × ilvl（ilvl80 = 216） */
  function itemMain(ilvl) { return 8 + 2.6 * Math.max(1, Math.round(ilvl)); }

  /* 基础攻击：60 + 等级主属性 × 1.4 + 武器主属性（L75 / ilvl75 = 608） */
  function attack(L, weaponMain) {
    return 60 + attr(L) * 1.4 + (weaponMain || 0);
  }

  /* 目标秒伤：攻击 × 2.2 ÷ 1.6（L75 = 836） */
  function secDps(atk) { return atk * 2.2 / 1.6; }

  /* 生命随等级：base × (1 + 2.85%/级)，L75 = base × 3.11 */
  function hpScale(L) { return 1 + 0.0285 * (L - 1); }

  /* 低等级内容经验衰减：每差 10 级 −20%，最低 0.2（GDD 14.4 防刷本） */
  function xpDecay(contentLv, playerLv) {
    var d = Math.floor((playerLv - contentLv) / 10);
    return Math.max(0.2, 1 - 0.2 * Math.max(0, d));
  }

  var LEVEL = {
    cap: CAP, need: need, cum: cum, attr: attr, itemMain: itemMain,
    attack: attack, secDps: secDps, hpScale: hpScale, xpDecay: xpDecay,
    /* 阶段目标（GDD 14.3），用于自检 */
    stages: [
      { lv: 10, cum: 11825, hours: 1.5 },
      { lv: 20, cum: 52150, hours: 4 },
      { lv: 30, cum: 130975, hours: 6.6 },
      { lv: 40, cum: 258300, hours: 12.5 },
      { lv: 50, cum: 444125, hours: 18.5 },
      { lv: 60, cum: 698450, hours: 25 },
      { lv: 75, cum: 1230250, hours: 38 }
    ]
  };

  /* ---------------------------------------------------------------- 技能点
     GDD 5.3：每级 1 点（75）+ 成就 10 = 85；单技能上限 5 级；
     每级伤害 +8%；第 3、5 级各 −1 秒 CD；第 4 级解锁附加效果。 */
  var SKILL = {
    maxLv: 5,
    /* 1 级起每级 1 点（75 级 = 75 点），30 级起并入 10 点成就 → 75 级合计 85 点 */
    pointsAt: function (lv, achv) {
      return Math.max(0, lv) + (achv == null ? (lv >= 30 ? 10 : 0) : achv);
    },
    dmgMul: function (lv) { return 1 + 0.08 * (Math.max(1, lv) - 1); },
    cdCut: function (lv) { return (lv >= 3 ? 1 : 0) + (lv >= 5 ? 1 : 0); },
    rangeMul: function (lv) { return lv >= 4 ? 1.2 : 1; },
    respecCost: function (lv) { return lv * 200; }
  };

  /* ---------------------------------------------------------------- 六职业
     GDD 5.1 / 5.2。资源：mana 法力 / rage 怒气 / stam 耐力。
     atk.mul 是"普攻单次倍率"，与 attack.interval 一起决定 DPS：
       规划中 dps ≈ atk × 1.375，六职业的实际值见 ?dump=1 的自检表。 */
  var CLASSES = {
    blade: {
      name: '剑客', family: '剑士', hp: 1000, en: 120, res: 'mana',
      speed: 6.4, color: 0x6fe3ff, kind: 'blade',
      attackType: 'melee',
      attack: { range: 3.7, arcDeg: 66, mul: 0.52, interval: 0.38, crit: 0.10, critMul: 1.6 },
      skills: [
        { key: 'Q', name: '突进斩', cd: 12, cost: 0, id: 'dashSlash', mul: 2.1, desc: '位移 5.6 米并斩击，命中硬直 0.35 秒' },
        { key: 'E', name: '旋风斩', cd: 9, cost: 25, id: 'whirl', mul: 1.6, desc: '周围 4.4 米全体伤害' },
        { key: 'R', name: '剑域', cd: 30, cost: 60, id: 'swordDomain', mul: 0.9, desc: '6 秒领域，每 0.6 秒对范围内敌人造成伤害' }
      ]
    },
    boxer: {
      name: '拳师', family: '格斗', hp: 1150, en: 100, res: 'rage',
      speed: 6.2, color: 0xffb04a, kind: 'boxer',
      attackType: 'melee',
      attack: { range: 2.3, arcDeg: 55, mul: 0.38, interval: 0.28, crit: 0.12, critMul: 1.6 },
      skills: [
        { key: 'Q', name: '直拳三连', cd: 7, cost: 20, id: 'comboPunch', mul: 0.8, desc: '三段直拳，每段 0.8 倍，第三段击退 1 米' },
        { key: 'E', name: '投技', cd: 10, cost: 25, id: 'throwGrab', mul: 2.2, desc: '抓取 3 米内最近目标，命中定身 1.2 秒；落空自身 1.5 秒硬直' },
        { key: 'R', name: '铁山靠', cd: 16, cost: 30, id: 'shoulderRam', mul: 3.0, desc: '前冲撞击，锥形范围，击退 3 米' }
      ]
    },
    gunner: {
      name: '枪炮师', family: '枪手', hp: 820, en: 140, res: 'mana',
      speed: 6.0, color: 0x8fd4ff, kind: 'gunner',
      attackType: 'hitscan',
      attack: { mul: 0.24, interval: 0.18, spread: 0.006, headMul: 1.8, crit: 0.14, critMul: 1.6 },
      skills: [
        { key: 'Q', name: '散弹', cd: 6, cost: 25, id: 'scatterShot', mul: 1.1, desc: '前方 3 米扇形，同时对多个目标结算' },
        { key: 'E', name: '炮台', cd: 16, cost: 35, id: 'turret', mul: 0, desc: '8 秒内射速 +45%，每 3 发补一发 1.5 倍的穿透弹' },
        { key: 'R', name: '轰击', cd: 20, cost: 50, id: 'bombard', mul: 4.0, desc: '1.2 秒咏唱，落点 6 米范围爆炸；咏唱被打断则 CD 不返还' }
      ]
    },
    mage: {
      name: '元素法师', family: '法师', hp: 760, en: 160, res: 'mana',
      speed: 5.8, color: 0xb98cff, kind: 'mage',
      attackType: 'projectile',
      attack: { mul: 1.03, interval: 0.75, speed: 26, splash: 2.4, crit: 0.08, critMul: 1.6 },
      skills: [
        { key: 'Q', name: '火球', cd: 8, cost: 30, id: 'fireLance', mul: 2.6, desc: '1.0 秒咏唱，直线穿透，命中点燃 3 秒' },
        { key: 'E', name: '冰环', cd: 11, cost: 25, id: 'frostRing', mul: 0.6, desc: '周围 6.5 米冻结 1.4 秒' },
        { key: 'R', name: '雷落', cd: 18, cost: 55, id: 'thunderfall', mul: 4.4, desc: '指定区域 0.8 秒延迟，半径 5 米' }
      ]
    },
    assassin: {
      name: '刺客', family: '暗夜', hp: 900, en: 120, res: 'stam',
      speed: 7.0, color: 0x7ef0b8, kind: 'assassin',
      attackType: 'melee',
      attack: { range: 2.6, arcDeg: 50, mul: 0.33, interval: 0.24, crit: 0.20, critMul: 1.8 },
      skills: [
        { key: 'Q', name: '背刺', cd: 9, cost: 30, id: 'backstab', mul: 2.4, desc: '背后命中 2.2 倍加成；正面命中只有 1 倍，且自身暴露 1 秒' },
        { key: 'E', name: '影步', cd: 8, cost: 20, id: 'shadowStep', mul: 1.2, desc: '位移 7 米，0.3 秒无敌，穿身而过时附带一次伤害' },
        { key: 'R', name: '毒刃', cd: 12, cost: 25, id: 'poisonBlade', mul: 0.9, desc: '命中叠 3 层毒，每层每 0.5 秒造成 0.25 倍伤害，持续 6 秒' }
      ]
    },
    priest: {
      name: '牧师', family: '圣职', hp: 880, en: 170, res: 'mana',
      speed: 5.9, color: 0xffe39a, kind: 'priest',
      attackType: 'projectile',
      attack: { mul: 0.58, interval: 0.62, speed: 22, splash: 1.2, crit: 0.06, critMul: 1.5 },
      skills: [
        { key: 'Q', name: '治疗链', cd: 8, cost: 30, id: 'healChain', mul: 0, desc: '三段治疗，每段 22% 最大生命；单机时全部落在自己身上' },
        { key: 'E', name: '驱散', cd: 10, cost: 25, id: 'dispel', mul: 1.0, desc: '清除自身全部减益，并对 4 米内敌人造成伤害并打断咏唱' },
        { key: 'R', name: '圣言', cd: 24, cost: 60, id: 'holyWord', mul: 3.2, desc: '2.5 秒咏唱（原型压缩为 0.9 秒），5 米圣光伤害并回复 30% 生命' }
      ]
    },

    /* ---- P1 · S1 赛季开放（ARCH 里 season:1 的两个，2026 版先做可玩骨架） ---- */
    greatsword: {
      name: '重剑士', family: '剑士', hp: 1120, en: 145, res: 'mana',
      speed: 6.0, color: 0xffd28a, kind: 'greatsword',
      attackType: 'melee',
      attack: { range: 4.2, arcDeg: 92, mul: 0.62, interval: 0.52, crit: 0.10, critMul: 1.7 },
      skills: [
        { key: 'Q', name: '破甲斩', cd: 10, cost: 25, id: 'sunderSlash', mul: 2.3, desc: '直线穿透 6.5 米，命中破甲 6 秒（受到的伤害 +18%）' },
        { key: 'E', name: '震地', cd: 9, cost: 25, id: 'groundSlam', mul: 1.5, desc: '半径 4.6 米击倒 0.6 秒，减速 40% 持续 2.6 秒' },
        { key: 'R', name: '巨剑回旋', cd: 26, cost: 50, id: 'greatWhirl', mul: 1.2, desc: '3 秒持续回旋，每 0.5 秒对 5 米内全体结算，自身移速 −40%' }
      ]
    },
    monk: {
      name: '武僧', family: '格斗', hp: 1080, en: 120, res: 'rage',
      speed: 6.6, color: 0xffe0a3, kind: 'monk',
      attackType: 'melee',
      attack: { range: 2.4, arcDeg: 52, mul: 0.40, interval: 0.26, crit: 0.12, critMul: 1.6 },
      skills: [
        { key: 'Q', name: '崩拳', cd: 6, cost: 20, id: 'shockFist', mul: 1.9, desc: '3.2 米正面，击退 1.6 米并硬直 0.4 秒' },
        { key: 'E', name: '借力打力', cd: 8, cost: 25, id: 'counterStance', mul: 2.4, desc: '1.6 秒招架：受伤 −65%，被击中的瞬间反击 2.4 倍' },
        { key: 'R', name: '气爆', cd: 20, cost: 45, id: 'kiBurst', mul: 2.6, desc: '5.5 米气浪推开并伤害，自身回复 12% 生命' }
      ]
    },

    /* ---- P1 · S2 赛季开放 ---- */
    sniper: {
      name: '狙击手', family: '枪手', hp: 780, en: 120, res: 'mana',
      speed: 5.7, color: 0x9fe8ff, kind: 'sniper',
      attackType: 'hitscan',
      attack: { mul: 0.52, interval: 0.62, spread: 0.002, headMul: 2.2, crit: 0.18, critMul: 1.9 },
      skills: [
        { key: 'Q', name: '瞄准射击', cd: 12, cost: 30, id: 'aimShot', mul: 4.2, desc: '0.9 秒屏息，直线 26 米单体 4.2 倍；出手后后坐 0.4 秒不能移动' },
        { key: 'E', name: '绊线雷', cd: 10, cost: 25, id: 'tripMine', mul: 1.8, desc: '身前 4 米布雷，0.8 秒后引爆：4 米内 1.8 倍并减速 3 秒' },
        { key: 'R', name: '穿甲弹', cd: 22, cost: 55, id: 'apRound', mul: 3.4, desc: '沿视线贯穿 24 米内所有敌人，每个 3.4 倍并破甲 4 秒' }
      ]
    },
    frost: {
      name: '冰霜法师', family: '法师', hp: 790, en: 165, res: 'mana',
      speed: 6.0, color: 0x8fd0ff, kind: 'frost',
      attackType: 'projectile',
      attack: { mul: 0.95, interval: 0.72, speed: 24, splash: 1.8, crit: 0.08, critMul: 1.6 },
      skills: [
        { key: 'Q', name: '寒冰锥', cd: 8, cost: 30, id: 'frostSpike', mul: 1.6, desc: '直线 10 米冰锥，命中叠 1 层冰霜（最多 3 层，每层更慢）' },
        { key: 'E', name: '霜环', cd: 11, cost: 28, id: 'frostNova', mul: 1.2, desc: '5.5 米霜环，冻结 1 秒并叠 2 层冰霜' },
        { key: 'R', name: '冰封领域', cd: 26, cost: 60, id: 'frostField', mul: 0.8, desc: '4 秒领域，每 0.6 秒 0.8 倍并叠冰霜；范围内移速再降 30%' }
      ]
    }
  };

  var CLASS_ORDER = ['blade', 'boxer', 'gunner', 'mage', 'assassin', 'priest'];
  /* 已经可以上手的 P1 职业：菜单会多出一行，rules 层跟着 ARCH 的赛季标注走 */
  var CLASS_P1_OPEN = ['greatsword', 'monk', 'sniper', 'frost'];
  function classMenu() {
    var out = [];
    for (var i = 0; i < CLASS_ORDER.length; i++) out.push({ key: CLASS_ORDER[i], tier: 'P0', arch: archOf(CLASS_ORDER[i]) });
    for (var j = 0; j < CLASS_P1_OPEN.length; j++) {
      var k = CLASS_P1_OPEN[j];
      if (CLASSES[k]) out.push({ key: k, tier: 'P1', arch: archOf(k) });
    }
    return out;
  }

  /* 职业克制（GDD 5.4）：只影响 AI 行为与提示，不直接改数字 */
  var COUNTER = {
    blade:    { strong: ['mage', 'gunner'], weak: ['boxer', 'assassin'] },
    boxer:    { strong: ['blade', 'assassin'], weak: ['gunner', 'mage'] },
    gunner:   { strong: ['boxer', 'priest'], weak: ['assassin', 'blade'] },
    mage:     { strong: ['boxer', 'priest'], weak: ['assassin', 'gunner'] },
    assassin: { strong: ['mage', 'priest'], weak: ['boxer', 'blade'] },
    priest:   { strong: ['blade'], weak: ['assassin', 'gunner'] }
  };

  /* ---------------------------------------------------------------- 24 职业架构
     GDD 5.1 / 12.2：六系 × 4 = 24 个架构。P0 每系先出 1 个（本原型实现的 6 个），
     P1 起每季开 2 个（跨系配对，保证每次都补齐"缺一个定位"的短板），共 9 季 = 18 个。
     hp / atk 是"该架构建档时的基准"，P0 六职业直接沿用 CLASSES 的真实值。 */
  var ARCH = [
    { family: '剑士', res: 'mana', classes: [
      { key: 'blade',      name: '剑客',   role: '持续输出', hp: 1000, atk: 120, p0: true },
      { key: 'greatsword', name: '重剑士', role: '破甲爆发', hp: 1120, atk: 135, season: 1 },
      { key: 'dancer',     name: '剑舞者', role: '多目标位移', hp: 940, atk: 125, season: 4 },
      { key: 'warlord',    name: '破军',   role: '前排压制', hp: 1180, atk: 128, season: 7 }
    ] },
    { family: '格斗', res: 'rage', classes: [
      { key: 'boxer',    name: '拳师',     role: '贴身连段', hp: 1150, atk: 100, p0: true },
      { key: 'monk',     name: '武僧',     role: '控场反击', hp: 1080, atk: 118, season: 1 },
      { key: 'wrestler', name: '摔跤手',   role: '抓取投掷', hp: 1200, atk: 112, season: 4 },
      { key: 'bulwark',  name: '铁卫',     role: '主坦护盾', hp: 1320, atk: 96,  season: 7 }
    ] },
    { family: '枪手', res: 'mana', classes: [
      { key: 'gunner',    name: '枪炮师',   role: '中距压制', hp: 820,  atk: 140, p0: true },
      { key: 'sniper',    name: '狙击手',   role: '单点爆发', hp: 780,  atk: 165, season: 2 },
      { key: 'chaingun',  name: '机炮手',   role: '弹幕覆盖', hp: 860,  atk: 132, season: 5 },
      { key: 'grenadier', name: '掷弹兵',   role: '区域封锁', hp: 840,  atk: 138, season: 8 }
    ] },
    { family: '法师', res: 'mana', classes: [
      { key: 'mage',     name: '元素法师', role: '范围爆发', hp: 760,  atk: 160, p0: true },
      { key: 'frost',    name: '冰霜法师', role: '减速控制', hp: 790,  atk: 152, season: 2 },
      { key: 'blood',    name: '血术士',   role: '吸血持续', hp: 810,  atk: 158, season: 5 },
      { key: 'occult',   name: '秘术师',   role: '召唤增益', hp: 770,  atk: 164, season: 8 }
    ] },
    { family: '暗夜', res: 'stam', classes: [
      { key: 'assassin',   name: '刺客',   role: '背刺处决', hp: 900,  atk: 120, p0: true },
      { key: 'nightrunner', name: '夜行者', role: '游击追杀', hp: 910,  atk: 126, season: 3 },
      { key: 'poisoner',   name: '毒术士', role: '持续腐化', hp: 880,  atk: 130, season: 6 },
      { key: 'shadowdance', name: '影舞',  role: '分身扰乱', hp: 920,  atk: 122, season: 9 }
    ] },
    { family: '圣职', res: 'mana', classes: [
      { key: 'priest',  name: '牧师',   role: '治疗净化', hp: 880,  atk: 170, p0: true },
      { key: 'paladin', name: '圣骑士', role: '增益主坦', hp: 1200, atk: 134, season: 3 },
      { key: 'seer',    name: '先知',   role: '预判辅助', hp: 850,  atk: 168, season: 6 },
      { key: 'ascetic', name: '苦修者', role: '自伤换强', hp: 1000, atk: 150, season: 9 }
    ] }
  ];

  /* 24 条扁平表：菜单、排期表与自检都从这里取 */
  var ARCH_LIST = [];
  for (var ai = 0; ai < ARCH.length; ai++) {
    var grp = ARCH[ai];
    for (var aj = 0; aj < grp.classes.length; aj++) {
      var ac = grp.classes[aj];
      ARCH_LIST.push({
        key: ac.key, name: ac.name, role: ac.role,
        family: grp.family, res: grp.res,
        hp: ac.hp, atk: ac.atk, p0: !!ac.p0, season: ac.season || 0
      });
    }
  }
  function archOf(key) {
    for (var i = 0; i < ARCH_LIST.length; i++) if (ARCH_LIST[i].key === key) return ARCH_LIST[i];
    return null;
  }
  /* P1 排期：按季聚合，每季 2 个 */
  function archPlan() {
    var bySeason = {};
    for (var i = 0; i < ARCH_LIST.length; i++) {
      var a = ARCH_LIST[i];
      if (a.p0 || !a.season) continue;
      (bySeason[a.season] = bySeason[a.season] || []).push(a);
    }
    var out = [];
    for (var s in bySeason) if (bySeason.hasOwnProperty(s)) out.push({ season: Number(s), classes: bySeason[s] });
    out.sort(function (x, y) { return x.season - y.season; });
    return out;
  }
  function p0Count() {
    var n = 0;
    for (var i = 0; i < ARCH_LIST.length; i++) if (ARCH_LIST[i].p0) n++;
    return n;
  }


  /* ---------------------------------------------------------------- 怪物
     GDD 14.1：普通怪血 300 + 40L；倍率 1 / 6 / 150 / 1900。
     hpMul 以"普通怪"为 1；boss 的 150 是"设计 5 人"的倍率，
     单机 / 2 人联机按实际人数占设计人数的比例缩放（见 mobHp）。
     dmgMul 以"当前等级基础攻击"为基准，保证玩家血量涨、怪伤害同比例涨。 */
  var MOBS = {
    grunt:   { name: '地宫守卫', hpMul: 1.00, dmgMul: 0.18, speed: 3.1, radius: 0.52, color: 0xff5c72, score: 1, xp: 'normal' },
    shooter: { name: '弩手',     hpMul: 0.85, dmgMul: 0.16, speed: 2.7, radius: 0.50, color: 0xffa23c, score: 1, xp: 'normal' },
    swarm:   { name: '蚀虫',     hpMul: 0.55, dmgMul: 0.09, speed: 3.7, radius: 0.36, color: 0xa4ff6b, score: 1, xp: 'normal' },
    golem:   { name: '石傀',     hpMul: 3.20, dmgMul: 0.50, speed: 1.9, radius: 0.86, color: 0x9aa7b4, score: 2, xp: 'elite' },
    hexer:   { name: '咒术师',   hpMul: 1.50, dmgMul: 0.26, speed: 2.5, radius: 0.52, color: 0xb98cff, score: 2, xp: 'elite' },
    elite:   { name: '精英卫',   hpMul: 6.00, dmgMul: 0.42, speed: 2.9, radius: 0.78, color: 0xff9a6b, score: 2, xp: 'elite' },
    boss:    { name: '地宫主宰', hpMul: 150,  dmgMul: 0.75, speed: 2.3, radius: 1.50, color: 0xff3860, score: 5, xp: 'boss', designParty: 5 },
    warden:  { name: '守卫长',   hpMul: 170,  dmgMul: 0.85, speed: 2.5, radius: 1.35, color: 0xffcf6b, score: 6, xp: 'boss', designParty: 5 },
    oracle:  { name: '咒缚主祭', hpMul: 160,  dmgMul: 0.70, speed: 2.2, radius: 1.30, color: 0xc98cff, score: 6, xp: 'boss', designParty: 5 },
    duelist: { name: '对手',     hpMul: 0,    dmgMul: 0.50, speed: 5.2, radius: 0.50, color: 0xff7a45, score: 1, xp: 'none' }
  };

  function baseMobHp(L) { return 300 + 40 * L; }

  /* 人数缩放：设计 5 人的 BOSS 由 1 人打时血量降到 1/5，保证单人 TTK 仍落在 90–150 秒 */
  function mobHp(type, L, opts) {
    opts = opts || {};
    var M = MOBS[type];
    if (!M) return 1;
    var party = Math.max(1, opts.party || 1);
    var design = M.designParty || 1;
    var partyScale = design > 1 ? Math.min(1, party / design) : 1;
    var worldMul = opts.worldMul == null ? 1 : opts.worldMul;
    var waveMul = opts.waveMul == null ? 1 : opts.waveMul;
    return Math.round(baseMobHp(L) * M.hpMul * partyScale * worldMul * waveMul);
  }

  function mobDmg(type, L) {
    var M = MOBS[type];
    if (!M) return 1;
    return Math.round(attack(L, 0) * M.dmgMul);
  }

  /* ---------------------------------------------------------------- 经验
     GDD 4.3。返回经验值；低等级内容按 xpDecay 衰减。 */
  var XP_KIND = {
    normal: function (L) { return L * 10; },
    elite:  function (L) { return L * 50; },
    boss:   function (L) { return L * 120; }
  };

  function xpOf(type, L, playerLv) {
    var M = MOBS[type];
    if (!M || M.xp === 'none') return 0;
    var f = XP_KIND[M.xp];
    if (!f) return 0;
    var base = f(L);
    return Math.round(base * xpDecay(L, playerLv == null ? L : playerLv));
  }

  var XP_RULES = {
    waveClear: function (wave) { return 60 + wave * 20; },
    quest: function (L) { return L * 400; },
    daily: function (L) { return L * 120; },
    arena: function (L, win) { return L * (win ? 120 : 40); },
    event: function (L) { return L * 200; }
  };

  /* ---------------------------------------------------------------- 世界六段
     GDD 4.1。场景复用三份 GLB（village / city / peak），差异落在光照、难度与掉落。 */
  var WORLDS = [
    { key: 'village', name: '新手村', min: 1,  max: 10, scene: 'village', hpMul: 0.90, ilvlBonus: 0, desc: '石村回廊 · 教学任务与第一个普通副本',
      lore: '石村回廊是第一道门，石板上还留着上一届挑战者的刻痕' },
    { key: 'city',    name: '主城',   min: 10, max: 30, scene: 'city',    hpMul: 1.00, ilvlBonus: 1, desc: '中央广场 · 拍卖行 / 公会 / 竞技场入口',
      lore: '白石主城每年重砌城墙，垛口上刻着历届冠军的名字' },
    { key: 'wild',    name: '边境野外', min: 30, max: 50, scene: 'wild',   hpMul: 1.15, ilvlBonus: 2, desc: '开放野外 · 精英点与世界事件',
      lore: '灰野边境没有路，只有辙痕和没烧完的篝火' },
    { key: 'cliff',   name: '断崖战场', min: 50, max: 65, scene: 'cliff',  hpMul: 1.25, ilvlBonus: 3, desc: '团队副本前置 · 公会战战场',
      lore: '裂潮断崖的岩层一层就是一届，坠海者的名字刻在最下面' },
    { key: 'throne',  name: '王座回廊', min: 65, max: 75, scene: 'throne', hpMul: 1.35, ilvlBonus: 4, desc: '主线终章 · 最高装等掉落',
      lore: '紫帷神坛的台阶越往上越窄，只容一个人走到最后' },
    { key: 'peak',    name: '神之领域', min: 75, max: 99, scene: 'peak',  hpMul: 1.50, ilvlBonus: 5, desc: '隐藏地图 · 需集齐三枚徽记，只放顶尖装备与称号',
      lore: '云脊孤峰终年积雪，守望的哨塔只点一盏灯' }
  ];

  function worldFor(key) {
    for (var i = 0; i < WORLDS.length; i++) if (WORLDS[i].key === key) return WORLDS[i];
    return WORLDS[0];
  }
  function worldIndex(key) {
    for (var i = 0; i < WORLDS.length; i++) if (WORLDS[i].key === key) return i;
    return 0;
  }

  /* ---------------------------------------------------------------- 副本四档
     GDD 8.1。party = 设计人数；bossMul 为 BOSS 血倍率（团队档 1900 是 25 人）。 */
  var DUNGEONS = [
    { key: 'normal', name: '普通', party: 5, cd: '每日 1 次', minutes: '5–8', ilvlOffset: -2, waves: 5, bossMul: 150,
      drop: { white: 0, green: 100, blue: 18, purple: 2, orange: 0 }, desc: '日常练手与经验，绿装必掉' },
    { key: 'elite', name: '精英', party: 5, cd: '每周 3 次', minutes: '12–20', ilvlOffset: 0, waves: 8, bossMul: 150,
      drop: { white: 0, green: 0, blue: 100, purple: 12, orange: 1.2 }, desc: '装备主产地，要求配合' },
    { key: 'raid', name: '团队', party: 25, cd: '每周 1 次', minutes: '40–60', ilvlOffset: 2, waves: 12, bossMul: 1900,
      drop: { white: 0, green: 0, blue: 0, purple: 70, orange: 4, silver: 1.5 }, desc: '10 / 25 人，公会与社交核心' },
    { key: 'abyss', name: '深渊', party: 5, cd: '每月 1 次', minutes: '25', ilvlOffset: 4, waves: 10, bossMul: 150,
      drop: { white: 0, green: 0, blue: 0, purple: 30, orange: 12, silver: 8 }, desc: '只给顶尖玩家，验证极限构筑' }
  ];

  function dungeonFor(key) {
    for (var i = 0; i < DUNGEONS.length; i++) if (DUNGEONS[i].key === key) return DUNGEONS[i];
    return DUNGEONS[0];
  }

  /* ---------------------------------------------------------------- 稀有度
     GDD 7.2：白 / 绿 / 蓝 / 紫 / 橙 / 银武。
     affix = 词条条数；main = 主属性系数（相对 itemMain）。 */
  var RARITY = {
    white:  { key: 'white',  name: '普通', color: '#d8dee6', hex: 0xd8dee6, affix: 0, mainMul: 1.00, order: 0 },
    green:  { key: 'green',  name: '优秀', color: '#6fe08a', hex: 0x6fe08a, affix: 1, mainMul: 1.05, order: 1 },
    blue:   { key: 'blue',   name: '精良', color: '#63b3ff', hex: 0x63b3ff, affix: 2, mainMul: 1.12, order: 2 },
    purple: { key: 'purple', name: '史诗', color: '#b98cff', hex: 0xb98cff, affix: 2, mainMul: 1.20, order: 3, skillBonus: 1 },
    orange: { key: 'orange', name: '传说', color: '#ff9a3c', hex: 0xff9a3c, affix: 3, mainMul: 1.28, order: 4, unique: true },
    silver: { key: 'silver', name: '银武', color: '#dfe9f5', hex: 0xdfe9f5, affix: 3, mainMul: 1.24, order: 5, selfPick: true }
  };
  var RARITY_ORDER = ['white', 'green', 'blue', 'purple', 'orange', 'silver'];

  /* 槽位：P0 六槽，另六槽 P1 补齐（数据先占位，避免以后改存档结构） */
  var SLOTS = [
    { key: 'weapon', name: '武器', p0: true },
    { key: 'chest',  name: '胸甲', p0: true },
    { key: 'legs',   name: '护腿', p0: true },
    { key: 'boots',  name: '战靴', p0: true },
    { key: 'amulet', name: '项链', p0: true },
    { key: 'ring',   name: '戒指', p0: true },
    { key: 'head',   name: '头盔', p0: false },
    { key: 'shoulder', name: '肩甲', p0: false },
    { key: 'hands',  name: '护手', p0: false },
    { key: 'waist',  name: '腰带', p0: false },
    { key: 'offhand', name: '副手', p0: false },
    { key: 'ring2',  name: '第二戒指', p0: false }
  ];

  /* ---------------------------------------------------------------- 分轨
     GDD 6.4 */
  var TUNE = {
    pve: { dmg: 1.00, ctrl: 1.00, stiff: 1.00, heal: 1.00, affix: 1.00 },
    pvp: { dmg: 0.55, ctrl: 0.60, stiff: 0.75, heal: 0.80, affix: 0.70 },
    online: { dmg: 0.55, ctrl: 0.60, stiff: 0.75, heal: 0.80, affix: 0.70 }
  };
  function tuneOf(mode) { return TUNE[mode] || TUNE.pve; }

  /* ---------------------------------------------------------------- 经济
     GDD 7.4 / 7.5 / 8.1 */
  var ECON = {
    gold: {
      quest: [300, 1200], normal: 800, elite: 2500, raid: 8000,
      sell: [200, 2000], arenaWin: 400
    },
    repairPerPiece: 300,
    enhanceCost: function (ilvl) { return Math.round(ilvl * 35); },
    enhanceRate: [1, 1, 1, 1, 1, 0.75, 0.65, 0.55, 0.45, 0.35],  // +1..+10，下标 0 = +1
    enhanceMainPct: 3,   // 每级主属性 +3%
    silverCost: function (ilvl) { return ilvl * 800; },
    auctionTax: 0.05,
    potionCost: [200, 600],
    bagMax: 24
  };

  /* ---------------------------------------------------------------- 玩家属性
     gear: {mainWeapon, hpFlat, drPct, speedPct, stamPct, enFlat, critPct, dmgPct, ...}
     mode = 'pve' | 'pvp' | 'online'
     PVP：不吃等级成长，按满级基准 + 装备 70% 折算，双方对等（GDD 6.4 支柱）。 */
  var PVP_REF = 75;

  function playerStats(clsKey, L, gear, mode) {
    var C = CLASSES[clsKey] || CLASSES.blade;
    gear = gear || {};
    var pvp = mode && mode !== 'pve';
    var lvForStats = pvp ? PVP_REF : L;

    var weaponMain = gear.mainWeapon || itemMain(Math.min(80, Math.round(lvForStats)));
    var mainAttr = attr(lvForStats);
    var atk = attack(lvForStats, weaponMain);

    var maxHp = Math.round(C.hp * hpScale(lvForStats) + (gear.hpFlat || 0) * (pvp ? 0.7 : 1));
    var maxEn = Math.round(C.en + (gear.enFlat || 0) * (pvp ? 0.7 : 1));
    var dps = atk * C.attack.mul / C.attack.interval;

    return {
      maxHp: maxHp, maxEn: maxEn, atk: Math.round(atk), dps: Math.round(dps),
      mainAttr: Math.round(mainAttr * 10) / 10, weaponMain: Math.round(weaponMain),
      dr: gear.drPct || 0, speedPct: gear.speedPct || 0,
      crit: (C.attack.crit || 0) + (gear.critPct || 0) / 100 * (pvp ? 0.7 : 1),
      speed: C.speed * (1 + (gear.speedPct || 0) / 100),
      stam: Math.round(100 * (1 + (gear.stamPct || 0) / 100)),
      pvp: !!pvp
    };
  }

  /* 装备等级（ilvl）：按等级与世界的装等推荐推算，掉落与显示共用 */
  function ilvlFor(L, world) {
    var base = Math.min(80, Math.round(L / 75 * 80));
    var bonus = world && world.ilvlBonus ? world.ilvlBonus : 0;
    return Math.max(1, Math.min(80, base + bonus));
  }

  /* 自检表：?dump=1 时打印，改公式后先看这张表 */
  function selfCheck() {
    var rows = [];
    var lvs = [1, 10, 30, 50, 75];
    for (var i = 0; i < lvs.length; i++) {
      var L = lvs[i];
      var ilvl = Math.min(80, Math.round(L / 75 * 80));
      var st = playerStats('blade', L, { mainWeapon: itemMain(ilvl) }, 'pve');
      rows.push({
        lv: L, need: need(L), cum: cum(L), hp: st.maxHp, atk: st.atk, dps: st.dps,
        mobHp: mobHp('grunt', L), ttk: Math.round(mobHp('grunt', L) / st.dps * 10) / 10,
        eliteHp: mobHp('elite', L), bossHp: mobHp('boss', L, { party: 1 })
      });
    }
    return rows;
  }

  /* 架构自检：24 条总表、6 个 P0、9 季排期且每季 2 个 */
  function archCheck() {
    var plan = archPlan();
    var perSeason = [];
    for (var i = 0; i < plan.length; i++) perSeason.push(plan[i].classes.length);
    return {
      total: ARCH_LIST.length,
      p0: p0Count(),
      seasons: plan.length,
      perSeason: perSeason,
      ok: ARCH_LIST.length === 24 && p0Count() === 6 && plan.length === 9 &&
          perSeason.every(function (n) { return n === 2; })
    };
  }

  window.Rules = {
    LEVEL: LEVEL,
    SKILL: SKILL,
    CLASSES: CLASSES,
    CLASS_ORDER: CLASS_ORDER,
    CLASS_P1_OPEN: CLASS_P1_OPEN,
    classMenu: classMenu,
    COUNTER: COUNTER,
    ARCH: ARCH,
    ARCH_LIST: ARCH_LIST,
    archOf: archOf,
    archPlan: archPlan,
    archCheck: archCheck,
    MOBS: MOBS,
    XP: { of: xpOf, rules: XP_RULES, decay: xpDecay },
    WORLDS: WORLDS,
    worldFor: worldFor,
    worldIndex: worldIndex,
    DUNGEONS: DUNGEONS,
    dungeonFor: dungeonFor,
    RARITY: RARITY,
    RARITY_ORDER: RARITY_ORDER,
    SLOTS: SLOTS,
    TUNE: TUNE,
    tuneOf: tuneOf,
    ECON: ECON,
    playerStats: playerStats,
    ilvlFor: ilvlFor,
    mobHp: mobHp,
    mobDmg: mobDmg,
    baseMobHp: baseMobHp,
    selfCheck: selfCheck
  };
})();
