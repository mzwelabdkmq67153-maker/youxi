/* 打击感系统（按《打击感系统实现规格》GDD-COMBAT-HITFEEL-001 v1.0 落地）
   要点：三档打击 / 角色级顿帧 / 方向性震屏 / 镜头推近 / 暴击闪白 / 四层特效 / 三轨音频 / 调试面板
   约定：
   1) 本文件的 TIERS 是三档参数的唯一数据源，改手感只改这里，不在各处写死；
   2) 顿帧只压表现层时间，冷却与网络走真实时间（见 game.js 的 animate / updateSkills）；
   3) 空挥与命中分两条分支：空挥只有破空音与拖影，命中才有撞击音、冲击波、震屏、闪白。 */
window.HitFeel = (function () {
  const FPS = 60;
  const f2ms = (f) => (f * 1000) / FPS;

  /* 表 A.1 三档打击参数速查（60 帧基准） */
  const TIERS = {
    light: {
      label: '轻击', total: 22, win: [9, 11], lead: 1, freeze: 0, dilation: 1.0,
      shakeAmp: 0.03, shakeDur: 0.05, push: 0, flash: 0, knock: 0.05, stun: 8,
      layers: ['contact']
    },
    heavy: {
      label: '重击', total: 36, win: [17, 19], lead: 1, freeze: 2, dilation: 0.15,
      shakeAmp: 0.08, shakeDur: 0.10, push: 0.08, flash: 0, knock: 0.14, stun: 16,
      layers: ['contact', 'shock']
    },
    crit: {
      label: '暴击', total: 42, win: [19, 21], lead: 2, freeze: 3, dilation: 0.05,
      shakeAmp: 0.15, shakeDur: 0.14, push: 0.08, flash: 0.55, knock: 0.24, stun: 24,
      layers: ['contact', 'shock', 'debris', 'post']
    }
  };

  /* 表现层开关：调试面板与无障碍设置都改这里，关掉不影响判定与结算 */
  const flags = {
    contact: true, shock: true, debris: true, post: true,
    shake: true, flash: true, sfx: true, freeze: true
  };
  let camScale = 1;        // 镜头强度：0 / 0.5 / 1
  let panelOn = false;

  const st = {
    tier: 'light',
    frame: 0,
    freezeLeft: 0, freezeMs: 0, freezeDil: 1,
    shakeLeft: 0, shakeDur: 0.05, shakeAmp: 0,
    dirX: 0, dirZ: 0,
    pushLeft: 0, pushAmt: 0,
    lastImpactAt: -1e9, lastTarget: null, lastFullAt: -1e9
  };

  const records = [];
  const hooks = {
    whoosh: function () {}, impact: function () {}, tail: function () {},
    contact: function () {}, shock: function () {}, debris: function () {}, post: function () {}
  };

  /* 判档：暴击 > 重击（伤害≥30 或技能）> 轻击 */
  function tierFor(dmg, crit, kind) {
    if (crit) return 'crit';
    if (kind === 'skill' || (dmg || 0) >= 30) return 'heavy';
    return 'light';
  }

  function reset() {
    st.freezeLeft = 0;
    st.shakeLeft = 0;
    st.pushLeft = 0;
  }

  /* 命中：顿帧 → 震屏 → 推镜 → 闪白 → 分层特效 → 三轨音频 */
  function hit(o) {
    o = o || {};
    const tierName = o.tier || tierFor(o.dmg, o.crit, o.kind);
    const cfg = TIERS[tierName] || TIERS.light;
    st.tier = tierName;

    const now = performance.now();
    // 同一目标 3 帧内的重复命中只播一次完整特效，避免高频连击把屏幕糊住
    const sameTarget = o.targetId !== undefined && o.targetId === st.lastTarget;
    const full = !(sameTarget && now - st.lastFullAt < f2ms(3));
    st.lastImpactAt = now;
    st.lastTarget = o.targetId;
    if (full) st.lastFullAt = now;

    // 1) 角色级顿帧（只压表现层时间）
    if (flags.freeze && cfg.freeze > 0) {
      const ms = f2ms(cfg.freeze);
      if (ms > st.freezeLeft) {
        st.freezeLeft = ms;
        st.freezeMs = ms;
        st.freezeDil = cfg.dilation;
      }
    }

    // 2) 方向性震屏：沿攻击方向施加，快速衰减，不做全向抖动
    if (flags.shake && cfg.shakeAmp > 0) {
      st.shakeLeft = cfg.shakeDur;
      st.shakeDur = cfg.shakeDur;
      st.shakeAmp = cfg.shakeAmp;
      st.dirX = o.dirX || 0;
      st.dirZ = o.dirZ || 0;
    }

    // 3) 镜头推近 8cm 后回位（仅重击与暴击）
    if (cfg.push > 0) {
      st.pushLeft = 0.16;
      st.pushAmt = cfg.push;
    }

    // 4) 暴击闪白（两帧以内，可单独关闭）
    if (flags.flash && flags.post && cfg.flash > 0) domFlash(cfg.flash);

    // 5) 特效分层
    if (o.point) {
      const pt = o.point;
      const layers = cfg.layers;
      if (flags.contact && layers.indexOf('contact') >= 0) hooks.contact(pt, o);
      if (flags.shock && layers.indexOf('shock') >= 0 && full) hooks.shock(pt, o);
      if (flags.debris && layers.indexOf('debris') >= 0 && full) hooks.debris(pt, o);
      if (flags.post && layers.indexOf('post') >= 0) hooks.post(pt, o);
    }

    // 6) 音频三轨：撞击同帧，余波延迟两帧，低频衰减
    if (flags.sfx) {
      hooks.impact(o, tierName);
      const tailDelay = f2ms(2);
      setTimeout(function () { hooks.tail(o, tierName); }, tailDelay);
    }

    pushRecord({ kind: 'hit', tier: tierName, dmg: o.dmg || 0, dist: o.dist, targetId: o.targetId, at: now });
    refreshPanel();
    return cfg;
  }

  /* 空挥：只有破空音与拖影，绝不触发撞击音、震屏、冲击波、闪白 */
  function whiff(o) {
    o = o || {};
    if (flags.sfx) hooks.whoosh(o, o.tier || 'light');
    pushRecord({ kind: 'whiff', tier: o.tier || 'light', dmg: 0, dist: o.dist, at: performance.now() });
    refreshPanel();
  }

  function pushRecord(r) {
    r.frame = Math.round(st.frame || 0);
    records.push(r);
    if (records.length > 40) records.shift();
  }

  /* 每帧递减：顿帧、震屏、推镜 */
  function tick(dt, frameNo) {
    if (frameNo !== undefined) st.frame = frameNo;
    if (st.freezeLeft > 0) st.freezeLeft = Math.max(0, st.freezeLeft - dt * 1000);
    if (st.shakeLeft > 0) st.shakeLeft = Math.max(0, st.shakeLeft - dt);
    if (st.pushLeft > 0) st.pushLeft = Math.max(0, st.pushLeft - dt);
  }

  /* 时间倍率：顿帧期间世界走慢，UI 与音频不受影响 */
  function dilation() {
    if (flags.freeze && st.freezeLeft > 0) return st.freezeDil;
    return 1;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  /* 相机反馈：位移沿攻击方向 + 少量随机，旋转按档位微扰，再叠加推近 */
  function applyCamera(camera, dt) {
    let ox = 0, oy = 0, oz = 0;
    if (flags.shake && st.shakeLeft > 0) {
      const p = st.shakeLeft / (st.shakeDur || 0.05);
      const env = p * p;                       // 快速衰减
      const amp = st.shakeAmp * env * camScale;
      // 0.3/0.8/1.4 厘米换算成米，沿攻击方向
      const shift = amp * 0.09;
      ox = st.dirX * shift * 1.6 + rnd(-1, 1) * shift * 0.45;
      oz = st.dirZ * shift * 1.6 + rnd(-1, 1) * shift * 0.45;
      oy = rnd(-1, 1) * shift * 0.7;
      camera.rotation.z += rnd(-1, 1) * amp * 0.05;
      camera.rotation.x += rnd(-1, 1) * amp * 0.02;
    }
    if (st.pushLeft > 0) {
      const p = st.pushLeft / 0.16;
      oz -= st.pushAmt * p;                    // 相机局部 -z 即朝前推
    }
    camera.position.set(ox, oy, oz);
  }

  /* 暴击闪白：DOM 覆盖层，两帧以内 */
  let flashEl = null;
  function domFlash(strength) {
    if (!flashEl) {
      flashEl = document.getElementById('flashWhite');
      if (!flashEl) {
        flashEl = document.createElement('div');
        flashEl.id = 'flashWhite';
        document.body.appendChild(flashEl);
      }
    }
    flashEl.style.opacity = String(Math.min(0.85, strength));
    clearTimeout(flashEl._t);
    flashEl._t = setTimeout(function () { flashEl.style.opacity = '0'; }, f2ms(2));
  }

  /* ---------------- 调试面板（规格第 11 节要求：交付件而非可选项） ---------------- */
  let panel = null;
  let panelBody = null;
  const SWITCHES = [
    ['contact', '接触层'], ['shock', '冲击层'], ['debris', '碎屑层'], ['post', '闪白/后置'],
    ['shake', '震屏'], ['flash', '闪白'], ['sfx', '音效'], ['freeze', '顿帧']
  ];

  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'hfPanel';
    panel.innerHTML =
      '<div class="hfHead">打击感调试 <span class="hfKey">F3 开关</span></div>' +
      '<div class="hfSw"></div>' +
      '<div class="hfCam"><label>镜头强度</label><button data-cam="0">关</button><button data-cam="0.5">半</button><button data-cam="1">全</button></div>' +
      '<div class="hfStat"></div>' +
      '<div class="hfLog"></div>';
    document.body.appendChild(panel);
    const sw = panel.querySelector('.hfSw');
    SWITCHES.forEach(function (s) {
      const b = document.createElement('button');
      b.dataset.flag = s[0];
      b.textContent = s[1];
      b.className = flags[s[0]] ? 'on' : '';
      b.onclick = function () {
        flags[s[0]] = !flags[s[0]];
        b.className = flags[s[0]] ? 'on' : '';
      };
      sw.appendChild(b);
    });
    panel.querySelectorAll('[data-cam]').forEach(function (b) {
      b.onclick = function () { camScale = Number(b.dataset.cam); refreshPanel(); };
    });
    panelBody = panel.querySelector('.hfStat');
    panel.style.display = 'none';
  }

  function refreshPanel() {
    if (!panel || panel.style.display === 'none') return;
    const cfg = TIERS[st.tier] || TIERS.light;
    panel.querySelector('.hfStat').innerHTML =
      '帧 ' + Math.round(st.frame) + ' · 分节 ' + sectionOf(cfg) + ' · 档位 ' + cfg.label +
      ' · 判定窗 ' + cfg.win[0] + '–' + cfg.win[1] + '<br>' +
      '顿帧 ' + (st.freezeLeft > 0 ? st.freezeLeft.toFixed(0) + 'ms@' + st.freezeDil : '—') +
      ' · 震屏 ' + (st.shakeLeft > 0 ? st.shakeLeft.toFixed(2) + 's' : '—') +
      ' · 镜头 ' + camScale;
    const list = records.slice(-6).reverse().map(function (r) {
      return '<div class="' + r.kind + '">' + (r.kind === 'whiff' ? '空挥' : '命中') +
        ' F' + r.frame + ' ' + (TIERS[r.tier] || {}).label + ' dmg ' + Math.round(r.dmg) +
        (r.dist !== undefined ? ' ' + Number(r.dist).toFixed(1) + 'm' : '') + '</div>';
    }).join('');
    panel.querySelector('.hfLog').innerHTML = list || '<div>暂无命中记录</div>';
  }

  /* 以重击为基准，把当前顿帧进度映射到分节，只用于面板显示 */
  function sectionOf(cfg) {
    if (st.freezeLeft > 0) return '碰撞';
    if (st.pushLeft > 0) return '收势';
    return '突进';
  }

  function togglePanel(force) {
    if (!panel) buildPanel();
    panelOn = force === undefined ? !panelOn : !!force;
    panel.style.display = panelOn ? 'block' : 'none';
    if (panelOn) refreshPanel();
  }

  addEventListener('keydown', function (e) {
    if (e.key === 'F3') { e.preventDefault(); togglePanel(); }
  });

  function init(opt) {
    if (opt && opt.hooks) Object.keys(opt.hooks).forEach(function (k) { if (hooks[k]) hooks[k] = opt.hooks[k]; });
    if (/hf/i.test(location.search)) togglePanel(true);
  }

  return {
    TIERS: TIERS, flags: flags, records: records, hooks: hooks, st: st,
    init: init, tierFor: tierFor, hit: hit, whiff: whiff, tick: tick,
    dilation: dilation, applyCamera: applyCamera, reset: reset,
    togglePanel: togglePanel,
    setCamScale: function (v) { camScale = v; },
    getCamScale: function () { return camScale; }
  };
})();
