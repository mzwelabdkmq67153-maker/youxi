/* ============================================================
   _glb_shot.mjs — GLB 局内验收截图 + 实测采集（接入组调试工具）
   零依赖：Node 22 内置 WebSocket，走 Chrome CDP；独立 user-data-dir，
   不与 8080 那头的 profile / 缓存抢同一份。
   用法：node _glb_shot.mjs [shot|metrics|all]
   ============================================================ */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(ROOT, '_shots');
mkdirSync(SHOTS, { recursive: true });

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const PROFILE = join(SHOTS, '_cdp_profile_8091');
const BASE = 'http://127.0.0.1:8091/_ingame_glb.html';

/* ---------- CDP 极简客户端 ---------- */
let browserWs = null;
let msgId = 0;
const pending = new Map();

function wsSend(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    browserWs.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

function attachWs(ws) {
  browserWs = ws;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  ws.onerror = (e) => console.error('WS error', e.message || e);
}

async function getBrowserWs() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
  const j = await r.json();
  const ws = new WebSocket(j.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  attachWs(ws);
}

async function newTarget(url) {
  const { targetId } = await wsSend('Target.createTarget', { url });
  const { sessionId } = await wsSend('Target.attachToTarget', { targetId, flatten: true });
  await wsSend('Page.enable', {}, sessionId);
  await wsSend('Runtime.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function evalJs(sessionId, expression) {
  const r = await wsSend('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, timeout: 15000
  }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(sessionId, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await evalJs(sessionId, 'window.__glbDbg ? __glbDbg.ready() : false');
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

async function shoot(spec) {
  const { sessionId } = await newTarget(BASE + (spec.query ? '?' + spec.query : ''));
  const logs = [];
  // 收集控制台 / 异常（通过轮询表达式侧记；CDP 事件在 flatten 下挂在 ws 消息流）
  const ready = await waitReady(sessionId);
  if (!ready) console.warn(`[${spec.name}] 超时未就绪`);
  await sleep(700);   // 等出生缩放 0.55s 动画结束，读数为缩放到 1.0 之后的值

  if (spec.action === 'hit') { await evalJs(sessionId, '__glbDbg.hit()'); await sleep(350); }
  if (spec.action === 'kill') {
    await evalJs(sessionId, '__glbDbg.kill()');
    for (let i = 0; i < 40; i++) { const r = await evalJs(sessionId, '__glbDbg.ready()'); if (r) break; await sleep(250); }
    await sleep(600);
  }
  if (spec.action === 'slash') {
    /* 拉近剑客小兵到 3.6m 便于读动作；站位锁定每帧按 planted 的 dist/lateral 重算 */
    await evalJs(sessionId, `(function(){var p=__glbDbg.planted();var g=p.find(function(x){return x.type==='grunt';});if(g){g.dist=3.6;g.lateral=-1.0;}return !!g;})()`);
    await evalJs(sessionId, `(function(){var d=__arenaDebug;var e=d.enemies.find(function(x){return x.type==='grunt';});if(e)window.Hero3D.swing(e.mesh,'slash',0.42);return !!e;})()`);
    await sleep(230);   // 挥砍中段（q≈0.55，strike 相位）
  }
  if (spec.action === 'shoot') {
    await evalJs(sessionId, `(function(){var p=__glbDbg.planted();var g=p.find(function(x){return x.type==='shooter';});if(g){g.dist=4.2;g.lateral=0;}return !!g;})()`);
    await evalJs(sessionId, `(function(){var d=__arenaDebug;var e=d.enemies.find(function(x){return x.type==='shooter';});if(e)window.Hero3D.swing(e.mesh,'shoot',0.42);return !!e;})()`);
    await sleep(230);
  }

  const metrics = await evalJs(sessionId, `JSON.stringify({
    hud: document.getElementById('glbHud').textContent,
    info: __glbDbg.info(),
    bytes: __glbDbg.bytes(),
    stats: __glbDbg.stats(),
    alive: __glbDbg.planted().filter(p=>!p.e.dead).length,
    planted: __glbDbg.planted().length
  })`);

  const shot = await wsSend('Page.captureScreenshot', { format: 'png' }, sessionId);
  const out = join(SHOTS, spec.file);
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`[${spec.name}] -> ${spec.file}  (ready=${ready}, alive=${JSON.parse(metrics).alive})`);
  return { spec: spec.name, file: spec.file, ready, metrics: JSON.parse(metrics), logs };
}

/* ---------- 截图清单 ---------- */
const SHOTS_LIST = [
  { name: '全景',   file: 'glb_ingame_全景.png',  query: '',            action: null },
  { name: '近景',   file: 'glb_ingame_近景.png',  query: 'near=shooter', action: null },
  { name: '夜景',   file: 'glb_ingame_night.png', query: '',            action: null },
  { name: 'ink回退', file: 'glb_ingame_ink.png',   query: 'art=ink',    action: null },
  { name: '命中闪光', file: 'glb_ingame_hitflash.png', query: 'act=hit', action: 'hit' },
  { name: '击杀残留', file: 'glb_ingame_afterkill.png', query: 'act=kill', action: 'kill' },
  { name: '动作-slash', file: 'glb_ingame_动作_slash.png', query: '', action: 'slash' },
  { name: '动作-shoot', file: 'glb_ingame_动作_shoot.png', query: '', action: 'shoot' }
];

/* ---------- 实测清单（不截图，只采 HUD / info / 字节） ---------- */
const METRICS_LIST = [
  { name: '1主角+3敌人(2K)', query: '' },
  { name: '1主角+6敌人(2K)', query: 'extra=3' },
  { name: '1主角+3敌人(敌人1024)', query: 'tex=1024' },
  { name: '回归-real档', query: 'art=real' },
  { name: '回归-ink档', query: 'art=ink' }
];

async function main() {
  const mode = process.argv[2] || 'all';
  if (!existsSync(CHROME)) throw new Error('Chrome 未找到: ' + CHROME);

  // 启动 Chrome（独立 profile，远端调试端口）
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--window-size=1440,900',
    '--no-first-run', '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    'about:blank'
  ], { stdio: 'ignore' });
  await sleep(1500);
  try {
    await getBrowserWs();

    const results = [];
    if (mode === 'shot' || mode === 'all') {
      for (const s of SHOTS_LIST) results.push(await shoot(s));
    }
    if (mode === 'metrics' || mode === 'all') {
      for (const m of METRICS_LIST) {
        const { sessionId } = await newTarget(BASE + '?' + m.query);
        const ready = await waitReady(sessionId, 25000);
        const metrics = await evalJs(sessionId, `JSON.stringify({
          hud: document.getElementById('glbHud').textContent,
          info: __glbDbg.info(),
          bytes: __glbDbg.bytes(),
          stats: __glbDbg.stats(),
          alive: __glbDbg.planted().filter(p=>!p.e.dead).length,
          planted: __glbDbg.planted().length
        })`);
        results.push({ spec: m.name, query: m.query, ready, metrics: JSON.parse(metrics) });
        console.log(`[${m.name}] ready=${ready} alive=${JSON.parse(metrics).alive}`);
      }
    }
    writeFileSync(join(SHOTS, 'glb_ingame_metrics.json'), JSON.stringify(results, null, 2));
    console.log('metrics -> _shots/glb_ingame_metrics.json');
  } finally {
    chrome.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
