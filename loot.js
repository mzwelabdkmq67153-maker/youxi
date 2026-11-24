/* ============================================================================
   loot.js — 掉落与装备（GDD 第 7 章：六槽 / 五档稀有度 + 银武 / 强化）
   ----------------------------------------------------------------------------
   职责边界：
   1) 只负责"物品数据"：稀有度、主属性、词条、评分、命名、强化、背包与槽位；
   2) 不碰 three.js、不碰游戏循环、不碰网络 —— 场景里的掉落物与拾取在 game.js；
   3) 数值全部来自 window.Rules（core.js），本文件不重复定义等级/装等公式。

   与旧版的差异（v1 → v2）：
   - 稀有度由四档改为五档：白 / 绿 / 蓝 / 紫 / 橙，另加"银武"（自制）第六类；
   - 每件物品带主属性 main（GDD 7.2：8 + 2.6 × ilvl），武器进攻击、防具进生命；
   - 紫装带"技能等级 +1"、橙装带一条唯一被动、银武带一条自选词条；
   - 强化 +1–+10（+1–+5 必成），主属性每级 +3%；
   - 槽位由 6 个扩到 12 个，P0 只开放前 6 个（后 6 个先占位，避免存档结构变化）。

   对外接口（game.js 只允许用这些）：
     Loot.SLOTS / RARITY / STATS / DUNGEON_DROP
     Loot.roll({ilvl, slot, rarity, cls, forceAffix})
     Loot.dropFor(enemyType, opts)
     Loot.tryEnhance(item) → {ok, from, to, cost}
     Loot.score(item) / Loot.lines(item) / Loot.slotOf(key)
     Gear.equip / take / totals / better / clear / 背包操作
   ============================================================================ */
(function () {
  'use strict';

  var R = window.Rules || {};
  var LEVEL = R.LEVEL || { itemMain: function (v) { return 8 + 2.6 * v; } };
  var RARITY_DEF = R.RARITY || {};
  var RARITY_ORDER_DEF = R.RARITY_ORDER || ['white', 'green', 'blue', 'purple', 'orange', 'silver'];

  /* ---------------------------------------------------------------- 稀有度 */
  var RARITY = {};
  RARITY_ORDER_DEF.forEach(function (k) {
    var d = RARITY_DEF[k] || { key: k, name: k, color: '#c9d3dc', hex: 0xc9d3dc, affix: 0, mainMul: 1, order: 0 };
    RARITY[k] = {
      key: k, name: d.name, color: d.color, hex: d.hex,
      count: d.affix, mainMul: d.mainMul, order: d.order,
      skillBonus: d.skillBonus || 0, unique: !!d.unique, selfPick: !!d.selfPick
    };
  });
  var RARITY_ORDER = RARITY_ORDER_DEF;

  /* ---------------------------------------------------------------- 槽位
     main 字段说明：atk = 主属性进攻击；halfAtk = 半额进攻击；hp = 主属性转生命（×3） */
  var SLOTS = [
    { key: 'weapon', name: '武器', main: 'atk', p0: true },
    { key: 'chest',  name: '胸甲', main: 'hp', p0: true },
    { key: 'legs',   name: '护腿', main: 'hp', p0: true },
    { key: 'boots',  name: '战靴', main: 'hp', p0: true },
    { key: 'amulet', name: '项链', main: 'halfAtk', p0: true },
    { key: 'ring',   name: '戒指', main: 'halfAtk', p0: true },
    { key: 'head',   name: '头盔', main: 'hp', p0: false },
    { key: 'shoulder', name: '肩甲', main: 'hp', p0: false },
    { key: 'hands',  name: '护手', main: 'hp', p0: false },
    { key: 'waist',  name: '腰带', main: 'hp', p0: false },
    { key: 'offhand', name: '副手', main: 'halfAtk', p0: false },
    { key: 'ring2',  name: '第二戒指', main: 'halfAtk', p0: false }
  ];
  var SLOT_BY_KEY = {};
  var P0_SLOTS = [];
  SLOTS.forEach(function (s) {
    SLOT_BY_KEY[s.key] = s;
    if (s.p0) P0_SLOTS.push(s);
  });

  /* ---------------------------------------------------------------- 词条表 */
  var STATS = {
    dmgPct:      { name: '伤害',     unit: '%', range: [3, 8],  weight: 2.6, slots: ['weapon', 'amulet', 'ring'] },
    critPct:     { name: '暴击率',   unit: '%', range: [1, 4],  weight: 1.6, slots: ['weapon', 'amulet', 'ring'] },
    atkSpeedPct: { name: '攻击速度', unit: '%', range: [3, 9],  weight: 2.0, slots: ['weapon', 'ring'] },
    rangePct:    { name: '攻击距离', unit: '%', range: [4, 10], weight: 1.4, slots: ['weapon'] },
    hpFlat:      { name: '生命值',   unit: '点', range: [24, 76], weight: 3.0, slots: ['chest', 'legs', 'amulet'] },
    drPct:       { name: '减伤',     unit: '%', range: [3, 8],  weight: 2.2, slots: ['chest', 'legs'] },
    speedPct:    { name: '移动速度', unit: '%', range: [3, 8],  weight: 2.0, slots: ['boots', 'legs'] },
    stamPct:     { name: '耐力上限', unit: '%', range: [4, 10], weight: 1.6, slots: ['boots', 'legs'] },
    stamRegenPct:{ name: '耐力回复', unit: '%', range: [6, 18], weight: 1.4, slots: ['boots', 'ring'] },
    enFlat:      { name: '能量上限', unit: '点', range: [8, 24], weight: 1.6, slots: ['amulet', 'chest'] },
    enRegenPct:  { name: '能量回复', unit: '%', range: [8, 22], weight: 1.3, slots: ['amulet', 'ring'] }
  };

  /* ---------------------------------------------------------------- 唯一被动
     橙装每条固定一条，按槽位给；只做"能被感知的一件小事"，不做乘法大改。 */
  var UNIQUE = {
    weapon: { key: 'exec', name: '处决', desc: '对生命低于 30% 的目标伤害 +18%' },
    chest:  { key: 'guard', name: '铁壁', desc: '生命低于 30% 时减伤 +10%' },
    legs:   { key: 'stride', name: '疾行', desc: '连续移动 3 秒后移速 +8%' },
    boots:  { key: 'dash', name: '踏风', desc: '闪避耐力消耗 −25%' },
    amulet: { key: 'focus', name: '专注', desc: '咏唱被打断时返还 30% CD' },
    ring:   { key: 'edge', name: '锋锐', desc: '暴击后有 25% 概率追加一次 40% 伤害' },
    def:    { key: 'minor', name: '余韵', desc: '击杀后回复 3% 生命' }
  };

  /* ---------------------------------------------------------------- 命名池 */
  var PREFIX = {
    white:  ['磨损的', '旧制的', '巡防用'],
    green:  ['精铸', '淬火', '轻装'],
    blue:   ['玄铁', '墨锋', '第七式'],
    purple: ['断罪', '无声', '夜巡'],
    orange: ['无冠', '破晓', '镇场'],
    silver: ['自制', '署名', '匠作']
  };
  var BASE_NAME = {
    weapon: { blade: '长剑', boxer: '拳套', gunner: '长铳', mage: '法杖', assassin: '双刃', priest: '圣杖' },
    chest:  { blade: '胸甲', boxer: '护胸', gunner: '护胸', mage: '长袍胸片', assassin: '皮甲', priest: '圣袍' },
    legs:   { blade: '战裙', boxer: '束裤', gunner: '战术裤', mage: '衬袍', assassin: '绑腿', priest: '祭裙' },
    boots:  { blade: '战靴', boxer: '拳靴', gunner: '疾行靴', mage: '远行鞋', assassin: '影履', priest: '圣履' },
    amulet: { blade: '剑穗坠', boxer: '缠腕坠', gunner: '弹壳坠', mage: '符环坠', assassin: '骨坠', priest: '圣徽坠' },
    ring:   { blade: '锋戒', boxer: '握戒', gunner: '准星戒', mage: '环流戒', assassin: '毒戒', priest: '祷戒' },
    def:    { blade: '护具', boxer: '护具', gunner: '护具', mage: '护具', assassin: '护具', priest: '护具' }
  };
  var SUFFIX = { white: '', green: ' · 轻', blue: ' · 破', purple: ' · 无声', orange: ' · 无鞘', silver: ' · 自铭' };

  /* ---------------------------------------------------------------- 工具 */
  function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function round1(v) { return Math.round(v * 10) / 10; }

  var _uid = 0;

  /* ---------------------------------------------------------------- 生成一件
     opts: {ilvl, slot, rarity, cls, forceAffix, name} */
  function roll(opts) {
    opts = opts || {};
    var ilvl = Math.max(1, Math.min(80, Math.round(opts.ilvl || 1)));
    var slot = SLOT_BY_KEY[opts.slot] ? opts.slot : pick(P0_SLOTS).key;
    var rarKey = opts.rarity && RARITY[opts.rarity] ? opts.rarity : 'white';
    var rar = RARITY[rarKey];
    var cls = opts.cls || 'blade';

    // 主属性（GDD 7.2）：8 + 2.6 × ilvl，再乘稀有度系数
    var rawMain = LEVEL.itemMain(ilvl);
    var main = Math.round(rawMain * (rar.mainMul || 1));

    // 词条池：按槽位筛
    var pool = [];
    Object.keys(STATS).forEach(function (k) {
      var st = STATS[k];
      if (st.slots.indexOf(slot) >= 0) pool.push({ k: k, w: st.weight });
    });

    var count = Math.min(rar.count, pool.length);
    var stats = [];
    var used = {};
    var bias = { white: 0.35, green: 0.45, blue: 0.55, purple: 0.65, orange: 0.72, silver: 0.60 }[rarKey];

    for (var i = 0; i < count; i++) {
      var total = 0;
      pool.forEach(function (p) { if (!used[p.k]) total += p.w; });
      var r = Math.random() * total, acc = 0, chosen = null;
      for (var j = 0; j < pool.length; j++) {
        var p = pool[j];
        if (used[p.k]) continue;
        acc += p.w;
        if (r <= acc) { chosen = p; break; }
      }
      if (!chosen) continue;
      used[chosen.k] = true;

      var def = STATS[chosen.k];
      var lo = def.range[0], hi = def.range[1];
      var base = lo + (hi - lo) * (bias + Math.random() * (1 - bias));
      // 词条随装等缓慢抬升（GDD 7.2）：满级 ilvl75 约 2.35 倍，避免低装等就白送 50% 攻速
      var v = base * (1 + 0.018 * (ilvl - 1));
      stats.push({ k: chosen.k, v: def.unit === '点' ? Math.round(v) : round1(v), selfPick: false });
    }

    // 银武：从池里再自选一条（默认由调用方指定，随机时取权重最高的未用词条）
    if (rar.selfPick) {
      var best = null;
      pool.forEach(function (p) {
        if (used[p.k]) return;
        if (!best || p.w > best.w) best = p;
      });
      if (best) {
        var d2 = STATS[best.k];
        var v2 = d2.range[1] * (1 + 0.05 * (ilvl - 1));
        stats.push({ k: best.k, v: d2.unit === '点' ? Math.round(v2) : round1(v2), selfPick: true });
      }
    }

    var item = {
      uid: 'it' + (++_uid),
      slot: slot,
      slotName: SLOT_BY_KEY[slot].name,
      rarity: rarKey,
      rarityName: rar.name,
      color: rar.color,
      hex: rar.hex,
      ilvl: ilvl,
      main: main,
      enh: 0,
      skillBonus: rar.skillBonus || 0,
      unique: rar.unique ? (UNIQUE[slot] || UNIQUE.def) : null,
      stats: stats,
      name: (opts.name || (pick(PREFIX[rarKey] || PREFIX.white) +
            (BASE_NAME[slot] ? (BASE_NAME[slot][cls] || BASE_NAME[slot].blade) : BASE_NAME.def.blade) +
            (SUFFIX[rarKey] || '')))
    };
    item.score = score(item);
    return item;
  }

  /* ---------------------------------------------------------------- 评分
     同槽横向比较用；跨槽（武器 vs 鞋子）不比，避免玩家被误导。 */
  var SCORE_W = {
    dmgPct: 3.0, critPct: 4.0, atkSpeedPct: 2.4, rangePct: 1.2,
    hpFlat: 0.42, drPct: 1.8, speedPct: 1.4, stamPct: 0.5,
    stamRegenPct: 0.45, enFlat: 0.5, enRegenPct: 0.45
  };
  function score(item) {
    if (!item || !item.stats) return 0;
    var s = 0;
    // 主属性折算：武器每点主属性约 0.7 分，防具每点约 0.3 分
    var mainW = item.slot === 'weapon' ? 0.7 : (SLOT_BY_KEY[item.slot] && SLOT_BY_KEY[item.slot].main === 'hp' ? 0.15 : 0.35);
    s += (item.main || 0) * mainW * (1 + (item.enh || 0) * 0.03);
    item.stats.forEach(function (a) { s += (SCORE_W[a.k] || 0) * a.v; });
    if (item.skillBonus) s += 6;
    if (item.unique) s += 8;
    return Math.round(s * 10) / 10;
  }

  function lines(item) {
    if (!item) return [];
    var out = [];
    var slotDef = SLOT_BY_KEY[item.slot];
    var mainTxt = slotDef && slotDef.main === 'hp' ? '生命' : '攻击主属性';
    out.push(mainTxt + ' +' + effectiveMain(item) + (item.enh ? '（+' + item.enh + '）' : ''));
    item.stats.forEach(function (a) {
      var def = STATS[a.k];
      out.push((a.selfPick ? '★ ' : '') + def.name + ' +' + a.v + def.unit);
    });
    if (item.skillBonus) out.push('技能等级 +' + item.skillBonus);
    if (item.unique) out.push('唯一被动 · ' + item.unique.name + '：' + item.unique.desc);
    return out;
  }

  /* 强化后的实际主属性（+3%/级） */
  function effectiveMain(item) {
    if (!item) return 0;
    return Math.round((item.main || 0) * (1 + (item.enh || 0) * 0.03));
  }

  /* ---------------------------------------------------------------- 强化
     GDD 7.4：+1–+5 必成；+6–+10 成功率 75/65/55/45/35%，失败掉 1 级。 */
  function tryEnhance(item) {
    if (!item) return { ok: false, msg: '没有装备' };
    var ECON = (R.ECON || { enhanceCost: function (v) { return v * 35; } });
    var cur = item.enh || 0;
    if (cur >= 10) return { ok: false, msg: '已满强化' };
    var next = cur + 1;
    var cost = ECON.enhanceCost(item.ilvl);
    var rates = ECON.enhanceRate || [1, 1, 1, 1, 1, 0.75, 0.65, 0.55, 0.45, 0.35];
    var rate = rates[next - 1] == null ? 0.35 : rates[next - 1];
    var ok = Math.random() < rate;
    if (ok) {
      item.enh = next;
      item.score = score(item);
      return { ok: true, from: cur, to: next, cost: cost, rate: rate, msg: '强化成功 +' + next };
    }
    if (cur > 0) {
      item.enh = cur - 1;
      item.score = score(item);
      return { ok: false, from: cur, to: cur - 1, cost: cost, rate: rate, msg: '强化失败，掉到 +' + (cur - 1) };
    }
    return { ok: false, from: 0, to: 0, cost: cost, rate: rate, msg: '强化失败' };
  }

  /* ---------------------------------------------------------------- 掉落表
     敌人类型 → 掉落率 / 稀有度权重 / 物品等级加成。
     档位（普通/精英/团队/深渊）由 Rules.DUNGEONS 的 drop 表覆盖稀有度权重。 */
  var DROP_TABLE = {
    grunt:   { chance: 0.14, ilvl: 0, extra: 0 },
    shooter: { chance: 0.14, ilvl: 0, extra: 0 },
    swarm:   { chance: 0.10, ilvl: 0, extra: 0 },
    golem:   { chance: 0.30, ilvl: 1, extra: 0 },
    hexer:   { chance: 0.22, ilvl: 1, extra: 0 },
    elite:   { chance: 0.45, ilvl: 1, extra: 0 },
    boss:    { chance: 1.00, ilvl: 2, extra: 1 },
    warden:  { chance: 1.00, ilvl: 2, extra: 1 },
    oracle:  { chance: 1.00, ilvl: 2, extra: 1 },
    duelist: { chance: 0.00, ilvl: 0, extra: 0 }
  };

  /* 默认权重（非副本怪，即野外） */
  var FIELD_WEIGHT = { white: 60, green: 30, blue: 9, purple: 0.9, orange: 0.1, silver: 0 };

  function rollRarity(weights) {
    var total = 0;
    RARITY_ORDER.forEach(function (k) { total += (weights[k] || 0); });
    if (total <= 0) return 'white';
    var r = Math.random() * total, acc = 0;
    for (var i = 0; i < RARITY_ORDER.length; i++) {
      var k = RARITY_ORDER[i];
      acc += (weights[k] || 0);
      if (r <= acc) return k;
    }
    return 'white';
  }

  /* opts: {wave, ilvl, dungeon, cls} */
  function dropFor(enemyType, opts) {
    opts = opts || {};
    var t = DROP_TABLE[enemyType] || DROP_TABLE.grunt;
    var out = [];
    if (Math.random() > t.chance) return out;

    var ilvl = Math.max(1, Math.min(80, (opts.ilvl || 1) + (t.ilvl || 0)));
    var weights = FIELD_WEIGHT;
    var D = null;
    if (opts.dungeon && R.dungeonFor) D = R.dungeonFor(opts.dungeon);
    if (D && D.drop) {
      weights = D.drop;
      // 只有 BOSS / 精英按档位表；杂兵在副本里降一档，避免普通怪也爆紫
      if (!(enemyType === 'boss' || enemyType === 'warden' || enemyType === 'oracle' || enemyType === 'elite')) {
        weights = { white: 55, green: 33, blue: 11, purple: 1, orange: 0, silver: 0 };
      }
    }

    var n = 1 + (Math.random() < 0.35 ? t.extra : 0);
    for (var i = 0; i < n; i++) {
      var rar = rollRarity(weights);
      if (rar === 'silver') rar = 'orange';   // 银武只能通过打造获得，掉落表命中也给橙
      out.push(roll({ ilvl: ilvl, rarity: rar, cls: opts.cls }));
    }
    return out;
  }

  /* ---------------------------------------------------------------- 装备槽
     12 槽全量建出来，P0 只暴露前 6 个（isOpen 判断）。 */
  var Gear = {
    slots: {},
    bag: [],
    bagMax: (R.ECON && R.ECON.bagMax) || 24,
    version: 0,

    isOpen: function (slotKey) {
      var s = SLOT_BY_KEY[slotKey];
      return !!(s && s.p0);
    },

    better: function (a, b) {
      if (!a) return false;
      if (!b) return true;
      if (a.slot !== b.slot) return false;
      if (a.score !== b.score) return a.score > b.score;
      if (a.ilvl !== b.ilvl) return a.ilvl > b.ilvl;
      return RARITY_ORDER.indexOf(a.rarity) > RARITY_ORDER.indexOf(b.rarity);
    },

    equip: function (item) {
      if (!item || !this.slots.hasOwnProperty(item.slot)) return null;
      if (!this.isOpen(item.slot)) return null;
      var old = this.slots[item.slot];
      this.slots[item.slot] = item;
      if (old) this.bag.push(old);
      this.trimBag();
      this.version++;
      return old;
    },

    take: function (slotKey) {
      var it = this.slots[slotKey];
      if (!it) return null;
      this.slots[slotKey] = null;
      this.bag.push(it);
      this.trimBag();
      this.version++;
      return it;
    },

    trimBag: function () {
      while (this.bag.length > this.bagMax) {
        var worst = 0;
        for (var i = 1; i < this.bag.length; i++) {
          if (score(this.bag[i]) < score(this.bag[worst])) worst = i;
        }
        this.bag.splice(worst, 1);
      }
    },

    removeFromBag: function (uid) {
      for (var i = 0; i < this.bag.length; i++) {
        if (this.bag[i].uid === uid) { this.bag.splice(i, 1); this.version++; return this.bag[i]; }
      }
      return null;
    },

    /* 汇总：主属性分流（武器全进攻击、饰品半额、防具转生命），词条按类型相加 */
    totals: function () {
      var t = {
        dmgPct: 0, critPct: 0, atkSpeedPct: 0, rangePct: 0,
        hpFlat: 0, drPct: 0, speedPct: 0, stamPct: 0,
        stamRegenPct: 0, enFlat: 0, enRegenPct: 0,
        mainWeapon: 0, mainArmor: 0, skillBonus: 0,
        pieces: 0, ilvlAvg: 0, uniques: []
      };
      var self = this;
      var sumIlvl = 0;
      P0_SLOTS.forEach(function (s) {
        var it = self.slots[s.key];
        if (!it) return;
        t.pieces++;
        sumIlvl += it.ilvl || 1;
        var m = effectiveMain(it);
        if (s.main === 'atk') t.mainWeapon += m;
        else if (s.main === 'halfAtk') t.mainWeapon += Math.round(m * 0.5);
        else { t.hpFlat += Math.round(m * 1.2); t.mainArmor += m; }
        it.stats.forEach(function (a) { t[a.k] = (t[a.k] || 0) + a.v; });
        if (it.skillBonus) t.skillBonus += it.skillBonus;
        if (it.unique) t.uniques.push(it.unique);
      });
      t.ilvlAvg = t.pieces ? Math.round(sumIlvl / t.pieces) : 0;
      return t;
    },

    clear: function () {
      SLOTS.forEach(function (s) { Gear.slots[s.key] = null; });
      this.bag.length = 0;
      this.version++;
    }
  };
  SLOTS.forEach(function (s) { Gear.slots[s.key] = null; });

  window.Loot = {
    SLOTS: SLOTS, P0_SLOTS: P0_SLOTS, RARITY: RARITY, STATS: STATS,
    UNIQUE: UNIQUE, DROP_TABLE: DROP_TABLE,
    roll: roll, score: score, lines: lines, dropFor: dropFor,
    effectiveMain: effectiveMain, tryEnhance: tryEnhance,
    slotOf: function (k) { return SLOT_BY_KEY[k]; }
  };
  window.Gear = Gear;
})();
