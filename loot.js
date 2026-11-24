/* ============================================================================
   loot.js — 副本掉落与装备（六槽：武器 / 盔甲 / 裤子 / 鞋子 / 项链 / 戒指）
   ----------------------------------------------------------------------------
   职责边界：
   1) 只负责"物品数据"：稀有度、词条、评分、命名、背包与装备槽；
   2) 不碰 three.js、不碰游戏循环、不碰网络 —— 场景里的掉落物与拾取在 game.js；
   3) 属性只输出汇总对象，怎么作用到玩家由 game.js 的 recalcGear() 决定。

   约定（与项目现有数值对齐）：
   - 词条一律百分比或固定值，不再二次叠乘；同一件物品不出现重复词条；
   - 稀有度决定词条条数 1/2/3/4，并抬高数值区间下限；
   - ilvl（物品等级）随波次上升，按 (1 + 0.05 * (ilvl - 1)) 线性放大，
     这样第 5 波掉的蓝装能稳稳压过第 1 波的紫装，不会出现"早期神装用到毕业"。

   对外接口：
     Loot.SLOTS / Loot.RARITY / Loot.STATS  数据表
     Loot.roll({ilvl, slot, rarity, cls})   生成一件物品
     Loot.dropFor(enemyType, wave, cls)     按敌人类型与波次决定"掉什么 / 掉不掉"
     Loot.score(item)                       物品强弱评分（跨槽不可比，同槽可比）
     Loot.lines(item)                       词条文本行
     Gear.equip(item) / Gear.take(slot) / Gear.totals() / Gear.better(a, b)
     Gear.slots / Gear.bag / Gear.version
   ============================================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 稀有度 */
  var RARITY = {
    common: { key: 'common', name: '普通', color: '#c9d3dc', hex: 0xc9d3dc, count: 1, affix: 0.00 },
    rare:   { key: 'rare',   name: '稀有', color: '#63b3ff', hex: 0x63b3ff, count: 2, affix: 0.10 },
    epic:   { key: 'epic',   name: '史诗', color: '#b98cff', hex: 0xb98cff, count: 3, affix: 0.22 },
    legend: { key: 'legend', name: '传说', color: '#ffb04a', hex: 0xffb04a, count: 4, affix: 0.40 }
  };
  var RARITY_ORDER = ['common', 'rare', 'epic', 'legend'];

  /* ---------------------------------------------------------------- 六个槽 */
  var SLOTS = [
    { key: 'weapon', name: '武器' },
    { key: 'chest',  name: '盔甲' },
    { key: 'legs',   name: '裤子' },
    { key: 'boots',  name: '鞋子' },
    { key: 'amulet', name: '项链' },
    { key: 'ring',   name: '戒指' }
  ];
  var SLOT_BY_KEY = {};
  SLOTS.forEach(function (s) { SLOT_BY_KEY[s.key] = s; });

  /* ---------------------------------------------------------------- 词条表
     slots  : 允许出现的槽位
     range  : [下限, 上限]，单位见 unit
     weight : 抽词条时的权重（武器偏伤害、盔甲偏生存）
     fmt    : 展示格式                                                        */
  var STATS = {
    dmgPct:      { name: '伤害',     unit: '%', range: [5, 13], weight: 3.2, slots: ['weapon', 'amulet', 'ring'] },
    critPct:     { name: '暴击率',   unit: '%', range: [2, 6],  weight: 2.4, slots: ['weapon', 'amulet', 'ring'] },
    atkSpeedPct: { name: '攻击速度', unit: '%', range: [3, 9],  weight: 2.0, slots: ['weapon', 'ring'] },
    rangePct:    { name: '攻击距离', unit: '%', range: [4, 10], weight: 1.4, slots: ['weapon'] },
    hpFlat:      { name: '生命值',   unit: '点', range: [24, 76], weight: 3.0, slots: ['chest', 'legs', 'amulet'] },
    drPct:       { name: '减伤',     unit: '%', range: [3, 8],  weight: 2.2, slots: ['chest', 'legs'] },
    speedPct:    { name: '移动速度', unit: '%', range: [3, 8],  weight: 2.0, slots: ['boots', 'legs'] },
    stamPct:     { name: '耐力上限', unit: '%', range: [6, 16], weight: 1.6, slots: ['boots', 'legs'] },
    stamRegenPct:{ name: '耐力回复', unit: '%', range: [6, 18], weight: 1.4, slots: ['boots', 'ring'] },
    enFlat:      { name: '能量上限', unit: '点', range: [8, 24], weight: 1.6, slots: ['amulet', 'chest'] },
    enRegenPct:  { name: '能量回复', unit: '%', range: [8, 22], weight: 1.3, slots: ['amulet', 'ring'] }
  };

  /* ---------------------------------------------------------------- 命名池 */
  var PREFIX = {
    common: ['磨损的', '旧制的', '巡防用'],
    rare:   ['精铸', '淬火', '轻装'],
    epic:   ['玄铁', '墨锋', '第七式'],
    legend: ['无冠', '破晓', '镇场']
  };
  var BASE_NAME = {
    weapon: { blade: '长剑', gunner: '长铳', mage: '法杖' },
    chest:  { blade: '胸甲', gunner: '护胸', mage: '长袍胸片' },
    legs:   { blade: '战裙', gunner: '战术裤', mage: '衬袍' },
    boots:  { blade: '战靴', gunner: '疾行靴', mage: '远行鞋' },
    amulet: { blade: '剑穗坠', gunner: '弹壳坠', mage: '符环坠' },
    ring:   { blade: '锋戒', gunner: '准星戒', mage: '环流戒' }
  };
  var SUFFIX = { common: '', rare: ' · 轻', epic: ' · 破', legend: ' · 无鞘' };

  /* ---------------------------------------------------------------- 工具 */
  function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function round1(v) { return Math.round(v * 10) / 10; }

  var _uid = 0;

  /* ---------------------------------------------------------------- 生成一件 */
  function roll(opts) {
    opts = opts || {};
    var ilvl = Math.max(1, Math.round(opts.ilvl || 1));
    var slot = SLOT_BY_KEY[opts.slot] ? opts.slot : pick(SLOTS).key;
    var rarKey = opts.rarity || 'common';
    if (!RARITY[rarKey]) rarKey = 'common';
    var rar = RARITY[rarKey];
    var cls = opts.cls || 'blade';

    // 该槽可用的词条池
    var pool = [];
    Object.keys(STATS).forEach(function (k) {
      var st = STATS[k];
      if (st.slots.indexOf(slot) >= 0) pool.push({ k: k, w: st.weight });
    });

    var count = Math.min(rar.count, pool.length);
    var stats = [];
    var used = {};
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
      // 稀有度抬下限：普通吃区间下 35%，传说吃上 55%
      var lo = def.range[0], hi = def.range[1];
      var bias = { common: 0.35, rare: 0.50, epic: 0.62, legend: 0.72 }[rarKey];
      var base = lo + (hi - lo) * (bias + Math.random() * (1 - bias));
      var v = base * (1 + 0.05 * (ilvl - 1));
      stats.push({ k: chosen.k, v: def.unit === '点' ? Math.round(v) : round1(v) });
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
      name: (PREFIX[rarKey][0 + Math.floor(Math.random() * PREFIX[rarKey].length)]) +
            (BASE_NAME[slot][cls] || BASE_NAME[slot].blade) +
            (SUFFIX[rarKey] || ''),
      stats: stats
    };
    item.score = score(item);
    return item;
  }

  /* ---------------------------------------------------------------- 评分
     同槽横向比较用；跨槽（武器 vs 鞋子）不比，避免玩家被误导。          */
  var SCORE_W = {
    dmgPct: 3.0, critPct: 4.0, atkSpeedPct: 2.4, rangePct: 1.2,
    hpFlat: 0.42, drPct: 1.8, speedPct: 1.4, stamPct: 0.5,
    stamRegenPct: 0.45, enFlat: 0.5, enRegenPct: 0.45
  };
  function score(item) {
    if (!item || !item.stats) return 0;
    var s = 0;
    item.stats.forEach(function (a) { s += (SCORE_W[a.k] || 0) * a.v; });
    return Math.round(s * 10) / 10;
  }

  function lines(item) {
    if (!item) return [];
    return item.stats.map(function (a) {
      var def = STATS[a.k];
      var sign = '+';
      return def.name + ' ' + sign + a.v + def.unit;
    });
  }

  /* ---------------------------------------------------------------- 掉落表
     敌人类型 → 掉落率 / 稀有度权重 / 物品等级加成。
     grunt 与 shooter 是杂兵，elite 是有名字的守关，boss 必掉两件。        */
  var DROP_TABLE = {
    grunt:   { chance: 0.14, weights: { common: 70, rare: 25, epic: 5, legend: 0 },  ilvl: 0, extra: 0 },
    shooter: { chance: 0.14, weights: { common: 70, rare: 25, epic: 5, legend: 0 },  ilvl: 0, extra: 0 },
    elite:   { chance: 0.45, weights: { common: 30, rare: 42, epic: 22, legend: 6 }, ilvl: 1, extra: 0 },
    boss:    { chance: 1.00, weights: { common: 0,  rare: 40, epic: 42, legend: 18 }, ilvl: 2, extra: 1 },
    duelist: { chance: 0.00, weights: null, ilvl: 0, extra: 0 }  // PVP 对手不掉装备
  };

  function rollRarity(weights) {
    var total = 0;
    RARITY_ORDER.forEach(function (k) { total += (weights[k] || 0); });
    if (total <= 0) return 'common';
    var r = Math.random() * total, acc = 0;
    for (var i = 0; i < RARITY_ORDER.length; i++) {
      var k = RARITY_ORDER[i];
      acc += (weights[k] || 0);
      if (r <= acc) return k;
    }
    return 'common';
  }

  /* 返回本件敌人掉落的物品数组（可能为空） */
  function dropFor(enemyType, wave, cls) {
    var t = DROP_TABLE[enemyType] || DROP_TABLE.grunt;
    var out = [];
    if (Math.random() > t.chance) return out;

    var ilvl = Math.max(1, (wave || 1) + (t.ilvl || 0));
    var n = 1 + (Math.random() < 0.35 ? t.extra : 0);
    for (var i = 0; i < n; i++) {
      out.push(roll({ ilvl: ilvl, rarity: rollRarity(t.weights), cls: cls }));
    }
    return out;
  }

  /* ---------------------------------------------------------------- 装备槽 */
  var Gear = {
    slots: { weapon: null, chest: null, legs: null, boots: null, amulet: null, ring: null },
    bag: [],
    bagMax: 12,
    version: 0,          // 脏标记：HUD 只在变化时重建 DOM

    better: function (a, b) {
      // a 是否比 b 好（b 为空则直接 true）
      if (!a) return false;
      if (!b) return true;
      if (a.slot !== b.slot) return false;
      if (a.score !== b.score) return a.score > b.score;
      // 同分时以物品等级、稀有度作次级判定
      if (a.ilvl !== b.ilvl) return a.ilvl > b.ilvl;
      return RARITY_ORDER.indexOf(a.rarity) > RARITY_ORDER.indexOf(b.rarity);
    },

    /* 装备一件；被换下的进背包。返回被换下的旧件（可能为 null） */
    equip: function (item) {
      if (!item || !this.slots.hasOwnProperty(item.slot)) return null;
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

    /* 背包满时丢最差的一件（同槽内最低分），保证新掉落不被无声吞掉 */
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

    /* 汇总：所有装备的词条按"百分比相加 / 固定值相加"合成一个对象 */
    totals: function () {
      var t = {
        dmgPct: 0, critPct: 0, atkSpeedPct: 0, rangePct: 0,
        hpFlat: 0, drPct: 0, speedPct: 0, stamPct: 0,
        stamRegenPct: 0, enFlat: 0, enRegenPct: 0,
        pieces: 0
      };
      var self = this;
      SLOTS.forEach(function (s) {
        var it = self.slots[s.key];
        if (!it) return;
        t.pieces++;
        it.stats.forEach(function (a) { t[a.k] = (t[a.k] || 0) + a.v; });
      });
      return t;
    },

    clear: function () {
      for (var k in this.slots) this.slots[k] = null;
      this.bag.length = 0;
      this.version++;
    }
  };

  window.Loot = {
    SLOTS: SLOTS, RARITY: RARITY, STATS: STATS, DROP_TABLE: DROP_TABLE,
    roll: roll, score: score, lines: lines, dropFor: dropFor, slotOf: function (k) { return SLOT_BY_KEY[k]; }
  };
  window.Gear = Gear;
})();
