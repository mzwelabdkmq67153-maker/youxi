/* 第七竞技场 · 局域网联机服务端
   静态页面 + WebSocket 对战房间，同一个端口，无第三方依赖。

   用法：
     node server.js              # 端口 8080，只监听 127.0.0.1（自己机器上单机联调）
     node server.js 8080 --lan   # 监听 0.0.0.0，同 WiFi 的其他电脑可连（会打印本机地址）

   设计取舍：位置/朝向由客户端上报，服务端只仲裁血量、比分与胜负。
   好处是不用把整局战斗逻辑搬进服务端；代价是不防改包，局域网朋友对打够用。
*/

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const ROOT = path.resolve(__dirname);
const PORT = Number(process.argv[2] || 8080);
const LAN = process.argv.includes('--lan');
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8'
};

/* ---------- 静态文件 ---------- */

function resolveSafe(reqUrl) {
  const raw = (reqUrl || '/').split('#')[0].split('?')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch (e) {
    return null;
  }
  if (decoded.indexOf('\0') >= 0) return null;

  let rel = decoded.replace(/^[\\/]+/, '');
  if (rel === '') rel = 'index.html';

  const segments = rel.split(/[\\/]+/);
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === '..') return null;
  }

  const file = path.resolve(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return null;
  return file;
}

function sendHttp(res, status, headers, body) {
  res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers));
  res.end(body);
}

const server = http.createServer((req, res) => {
  const file = resolveSafe(req.url);
  if (!file) {
    sendHttp(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'bad request');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      sendHttp(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'not found');
      return;
    }
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    };
    if (req.method === 'HEAD') {
      sendHttp(res, 200, headers, '');
      return;
    }
    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        sendHttp(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'internal error');
        return;
      }
      sendHttp(res, 200, headers, data);
    });
  });
});

/* ---------- WebSocket 帧 ---------- */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function frame(opcode, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/* 客户端 -> 服务端的帧一定带掩码，这里逐帧解出来 */
function makeParser(ws, onText, onClose) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 2 * 1024 * 1024) {
      onClose();
      return;
    }
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) === 0x80;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) === 0x80;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < off + 2) return;
        len = buf.readUInt16BE(off);
        off += 2;
      } else if (len === 127) {
        if (buf.length < off + 8) return;
        len = Number(buf.readBigUInt64BE(off));
        off += 8;
      }
      const mask = masked ? buf.slice(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;

      let payload = buf.slice(off, off + len);
      if (masked) {
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
        payload = out;
      }
      buf = buf.slice(off + len);

      if (opcode === 0x8) {
        onClose();
        return;
      }
      if (opcode === 0x9) {
        ws.write(frame(0xA, payload));
        continue;
      }
      if (opcode === 0x1 && fin) onText(payload.toString('utf8'));
    }
  };
}

/* ---------- 房间 ---------- */

const MAX_HP = 130;
const CLS_HP = { blade: 130, gunner: 110, mage: 105 };
const MAX_DMG = 80;        // 单次上报伤害上限，挡住随手改包
const SCORE_TO_WIN = 3;
const SPAWNS = [
  { x: 0, z: -13, yaw: Math.PI },  // 出生在 -z 一侧，面向 +z 的对手
  { x: 0, z: 13, yaw: 0 }          // 出生在 +z 一侧，面向 -z 的对手
];

const rooms = new Map();
const sockets = new Set();

function getRoom(code) {
  let r = rooms.get(code);
  if (!r) {
    r = { code, players: [], score: { 1: 0, 2: 0 }, ended: false };
    rooms.set(code, r);
  }
  return r;
}

function send(p, obj) {
  if (!p || !p.ws || p.ws.destroyed) {
    if (obj && obj.t !== 'state') log('send-domain-fail #' + (p && p.id) + ' ' + (obj && obj.t));
    return;
  }
  const buf = frame(0x1, JSON.stringify(obj));
  try {
    p.ws.write(buf);
    if (obj.t !== 'state') log('send #' + p.id + ' ' + obj.t + ' ' + buf.length + 'B');
  } catch (e) {
    /* 连接已断，交给 close 处理 */
  }
}

function sendRoom(room, obj, exceptId) {
  room.players.forEach((p) => {
    if (p.id !== exceptId) send(p, obj);
  });
}

function roomIsFull(room) {
  return room.players.length >= 2;
}

function dropPlayer(p) {
  const room = p.room;
  if (!room) return;
  room.players = room.players.filter((x) => x !== p);
  sendRoom(room, { t: 'opponentLeft', id: p.id, name: p.name });
  if (room.players.length === 0) rooms.delete(room.code);
  p.room = null;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function log(msg) {
  const d = new Date();
  const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
  console.log('[' + t + '] ' + msg);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function handleMessage(p, raw) {
  if (typeof raw !== 'string' || raw.length > 800) return;
  let m;
  try {
    m = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (!m || typeof m.t !== 'string') return;

  const room = p.room;
  if (!room) return;

  if (m.t === 'hello') {
    if (p.welcomed) return;
    p.welcomed = true;
    const opp = room.players.find((x) => x.id !== p.id);
    send(p, {
      t: 'welcome',
      id: p.id,
      room: room.code,
      name: p.name,
      cls: p.cls,
      hp: p.maxHp,
      spawn: { x: p.x, z: p.z, yaw: p.yaw },
      score: room.score,
      // 只带必要字段：玩家对象里有 socket 与房间引用，直接序列化会循环引用
      opponent: opp ? { id: opp.id, name: opp.name, cls: opp.cls, hp: opp.hp } : null
    });
    sendRoom(room, { t: 'opponentJoined', id: p.id, name: p.name, cls: p.cls, hp: p.hp }, p.id);
    sendRoom(room, { t: 'state', id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, anim: 'idle' }, p.id);
    log('hello #' + p.id + ' ' + p.name + ' 已下发欢迎包');
    return;
  }

  if (m.t === 'state') {
    p.x = clamp(num(m.x), -40, 40);
    p.y = clamp(num(m.y), 0, 8);
    p.z = clamp(num(m.z), -40, 40);
    p.yaw = num(m.yaw);
    p.anim = typeof m.anim === 'string' ? m.anim.slice(0, 12) : 'idle';
    sendRoom(room, { t: 'state', id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, anim: p.anim }, p.id);
    return;
  }

  if (m.t === 'hit') {
    if (!p.alive || room.ended) return;
    const target = room.players.find((x) => x.id === num(m.target) && x.id !== p.id);
    if (!target || !target.alive) return;
    const dmg = clamp(Math.round(num(m.dmg)), 1, MAX_DMG);
    target.hp = Math.max(0, target.hp - dmg);
    sendRoom(room, { t: 'hit', by: p.id, target: target.id, dmg, hp: target.hp }, 0);
    if (target.hp <= 0) {
      target.alive = false;
      room.score[p.id] = (room.score[p.id] || 0) + 1;
      sendRoom(room, { t: 'kill', by: p.id, target: target.id, score: room.score }, 0);
      if (room.score[p.id] >= SCORE_TO_WIN) {
        room.ended = true;
        sendRoom(room, { t: 'matchEnd', winner: p.id, score: room.score }, 0);
      }
    }
    return;
  }

  if (m.t === 'respawn') {
    if (room.ended) return;
    p.hp = p.maxHp;
    p.alive = true;
    const spawn = SPAWNS[p.id === 1 ? 0 : 1];
    p.x = spawn.x;
    p.z = spawn.z;
    p.yaw = spawn.yaw;
    sendRoom(room, { t: 'respawn', id: p.id, hp: p.hp, x: spawn.x, z: spawn.z, yaw: spawn.yaw }, 0);
    sendRoom(room, { t: 'state', id: p.id, x: spawn.x, y: p.y, z: spawn.z, yaw: spawn.yaw, anim: 'idle' }, p.id);
  }
}

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key || !req.headers.upgrade || req.headers.upgrade.toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }

  const code = (url.searchParams.get('room') || '0000').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || '0000';
  const name = (url.searchParams.get('name') || '玩家').slice(0, 10);
  const cls = ['blade', 'gunner', 'mage'].includes(url.searchParams.get('cls') || '') ? url.searchParams.get('cls') : 'blade';

  const room = getRoom(code);
  if (roomIsFull(room) || room.ended) {
    // 先正常升级，再用一帧说明原因并关闭，客户端能给出人话提示而不是"连接失败"
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n'
    );
    const why = room.ended ? '这个房间已经打完了，换一个房间号' : '房间已满（只支持 2 人对战）';
    socket.write(frame(0x1, JSON.stringify({ t: 'error', msg: why })));
    socket.write(Buffer.from([0x88, 0x02, 0x03, 0xE8])); // 关闭帧 1000
    log('reject ' + code + ' ' + name + ' ' + why);
    setTimeout(() => { try { socket.destroy(); } catch (e) { /* ignore */ } }, 200);
    return;
  }

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n'
  );
  socket.setNoDelay(true);

  const p = {
    id: room.players.length === 0 ? 1 : 2,
    name,
    cls,
    ws: socket,
    room,
    maxHp: CLS_HP[cls] || MAX_HP,
    hp: CLS_HP[cls] || MAX_HP,
    alive: true,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    anim: 'idle'
  };
  room.players.push(p);
  sockets.add(socket);
  log('join ' + code + ' #' + p.id + ' ' + name + '/' + cls + ' 房间人数 ' + room.players.length);

  const spawn = SPAWNS[p.id === 1 ? 0 : 1];
  p.x = spawn.x;
  p.z = spawn.z;
  p.yaw = spawn.yaw;

  // 首帧交给客户端的 hello 触发：客户端 onopen 时才回欢迎包，避免与 101 响应抢时序
  log('ready #' + p.id + ' ' + name + ' 等待 hello');

  const parser = makeParser(
    socket,
    (text) => handleMessage(p, text),
    () => {
      sockets.delete(socket);
      dropPlayer(p);
      try { socket.destroy(); } catch (e) { /* ignore */ }
    }
  );

  socket.on('data', (chunk) => {
    try {
      parser(chunk);
    } catch (e) {
      log('data-error #' + p.id + ' ' + (e && e.message) + ' | ' + (e && e.stack && e.stack.split('\n')[1]));
      sockets.delete(socket);
      dropPlayer(p);
      socket.destroy();
    }
  });

  socket.on('close', (hadError) => {
    log('socket close #' + p.id + ' hadError=' + hadError);
    sockets.delete(socket);
    dropPlayer(p);
  });

  socket.on('error', (err) => {
    log('socket error #' + p.id + ' ' + (err && err.message));
    sockets.delete(socket);
    dropPlayer(p);
    try { socket.destroy(); } catch (e) { /* ignore */ }
  });
});

/* 心跳：清掉僵死连接 */
setInterval(() => {
  sockets.forEach((s) => {
    if (s.destroyed) return;
    try { s.write(frame(0x9, '')); } catch (e) { /* ignore */ }
  });
}, 30000);

function lanAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

server.listen(PORT, HOST, () => {
  console.log('serving: http://localhost:' + PORT);
  if (LAN) {
    const ip = lanAddress();
    console.log('局域网联机已开启，同 WiFi 的电脑访问：' + (ip ? 'http://' + ip + ':' + PORT : '（未检测到网卡，检查网络）'));
    console.log('如果对方连不上，检查 Windows 防火墙是否放行 node.exe 的入站连接。');
  } else {
    console.log('当前只监听本机。要让同一 WiFi 的电脑联机，用：node server.js ' + PORT + ' --lan');
  }
});
