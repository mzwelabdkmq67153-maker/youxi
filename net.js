/* 联机客户端：只管连接与收发，战斗判定仍在 game.js / server.js
   暴露 window.ArenaNet
*/
(function () {
  'use strict';

  const T = window.ArenaNet || {};

  const net = {
    ws: null,
    connected: false,
    room: '',
    myId: 0,
    myName: '',
    myCls: 'blade',
    hp: 130,
    maxHp: 130,
    score: { 1: 0, 2: 0 },
    // 远端玩家的最近状态（game.js 每帧按它做插值）
    remote: null,
    lastSendT: 0,
    sendGap: 1000 / 20, // 20Hz 上行
    callbacks: {}
  };

  function emit(name, payload) {
    const fn = net.callbacks[name];
    if (fn) {
      try { fn(payload); } catch (e) { console.warn('[net] handler error', name, e); }
    }
  }

  function urlFor(room, name, cls) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = 'room=' + encodeURIComponent(room) + '&name=' + encodeURIComponent(name) + '&cls=' + encodeURIComponent(cls);
    return proto + '//' + location.host + '/ws?' + q;
  }

  net.connect = function (opts) {
    net.close();
    net.callbacks = opts || {};
    net.room = (opts.room || '').toUpperCase();
    net.myName = opts.name || '玩家';
    net.myCls = opts.cls || 'blade';
    net.myId = 0;
    net.hp = 130;
    net.spawn = null;
    net.score = { 1: 0, 2: 0 };
    net.remote = null;

    let ws;
    try {
      ws = new WebSocket(urlFor(net.room, net.myName, net.myCls));
    } catch (e) {
      emit('error', '无法建立连接');
      return;
    }
    net.ws = ws;

    ws.onopen = function () {
      net.connected = true;
      // 稍等一帧再打招呼：部分客户端内核在 open 瞬间还会丢掉立刻到达的帧
      window.setTimeout(function () { net.send({ t: 'hello' }); }, 40);
      emit('open', {});
    };

    ws.onmessage = function (ev) {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || !m.t) return;
      handle(m);
    };

    ws.onclose = function (ev) {
      const wasConnected = net.connected;
      net.connected = false;
      net.remote = null;
      // 403 表示房间满或已关闭
      emit('close', { code: ev.code, reason: ev.reason, wasConnected });
    };

    ws.onerror = function () {
      emit('error', '连接出错');
    };
  };

  function handle(m) {
    switch (m.t) {
      case 'welcome':
        net.myId = m.id;
        net.hp = m.hp;
        net.maxHp = m.hp;
        net.spawn = m.spawn || null;
        net.score = m.score || { 1: 0, 2: 0 };
        if (m.opponent) {
          net.remote = {
            id: m.opponent.id, name: m.opponent.name, cls: m.opponent.cls,
            hp: m.opponent.hp, maxHp: m.opponent.hp, x: 0, y: 0, z: 0, yaw: 0, anim: 'idle'
          };
        }
        emit('welcome', m);
        break;

      case 'opponentJoined':
        net.remote = {
          id: m.id, name: m.name, cls: m.cls, hp: m.hp, maxHp: m.hp,
          x: 0, y: 0, z: 0, yaw: 0, anim: 'idle'
        };
        emit('opponent', m);
        break;

      case 'opponentLeft':
        net.remote = null;
        emit('leave', m);
        break;

      case 'state':
        if (m.id === net.myId) break;
        if (!net.remote) net.remote = { id: m.id, name: '对手', cls: 'blade', hp: 130 };
        net.remote.x = m.x;
        net.remote.y = m.y;
        net.remote.z = m.z;
        net.remote.yaw = m.yaw;
        net.remote.anim = m.anim || 'idle';
        emit('state', m);
        break;

      case 'kill':
        net.score = m.score || net.score;
        // 对手被击倒：血量清零，等复活消息再恢复，期间本地不再上报伤害
        if (net.remote && m.target === net.remote.id) net.remote.hp = 0;
        emit('kill', m);
        break;

      case 'respawn':
        if (m.id === net.myId) {
          net.hp = m.hp;
          emit('respawn', m);
        } else if (net.remote && m.id === net.remote.id) {
          net.remote.hp = m.hp;
        }
        break;

      case 'hit':
        // 命中回执只给开火方
        if (m.target === net.myId) {
          net.hp = m.hp;
          emit('hurt', m);
        } else if (net.remote) {
          net.remote.hp = m.hp;
          emit('hitOk', m);
        }
        break;

      case 'matchEnd':
        net.score = m.score || net.score;
        emit('end', m);
        break;

      case 'restart':
        // 服务器把房间重置成新一局：比分清零、双方满血回到出生点
        net.score = m.score || { 1: 0, 2: 0 };
        (m.players || []).forEach(function (pl) {
          if (pl.id === net.myId) {
            net.hp = pl.hp;
            net.spawn = { x: pl.x, z: pl.z, yaw: pl.yaw };
          } else if (net.remote) {
            net.remote.hp = pl.hp;
            net.remote.maxHp = pl.hp;
            net.remote.x = pl.x;
            net.remote.z = pl.z;
            net.remote.yaw = pl.yaw;
          }
        });
        emit('restart', m);
        break;

      case 'shielded':
        // 目标还在出生保护里，这一刀不算
        emit('shield', m);
        break;

      case 'error':
        emit('error', m.msg || '房间异常');
        break;

      default:
        break;
    }
  }

  net.send = function (obj) {
    if (!net.ws || net.ws.readyState !== 1) return;
    try {
      net.ws.send(JSON.stringify(obj));
    } catch (e) { /* ignore */ }
  };

  net.sendState = function (s) {
    const now = Date.now();
    if (now - net.lastSendT < net.sendGap) return;
    net.lastSendT = now;
    net.send({ t: 'state', x: s.x, y: s.y, z: s.z, yaw: s.yaw, anim: s.anim });
  };

  net.sendHit = function (targetId, dmg) {
    net.send({ t: 'hit', target: targetId, dmg: Math.round(dmg) });
  };

  net.sendRespawn = function () {
    net.send({ t: 'respawn' });
  };

  net.sendRestart = function () {
    net.send({ t: 'restart' });
  };

  net.close = function () {
    if (net.ws) {
      try { net.ws.close(); } catch (e) { /* ignore */ }
    }
    net.ws = null;
    net.connected = false;
    net.remote = null;
  };

  if (T && T !== net) {
    Object.keys(T).forEach((k) => { net[k] = T[k]; });
  }

  window.ArenaNet = net;
})();
