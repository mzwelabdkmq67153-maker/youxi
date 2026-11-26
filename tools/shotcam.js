/* 用 CDP 真实等待页面就绪后再截图。
   --virtual-time-budget 会把大 glb 的网络请求一起冻住，导致随机卡在 loading；
   这里改成真实时间轮询一个 JS 标志，稳得多。
   用法：node tools/shotcam.js <url> <out.png> [waitExpr] [timeoutMs] [w] [h] */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.argv[2];
const OUT = process.argv[3];
const WAIT = process.argv[4] || 'window.__ready === true';
const TIMEOUT = parseInt(process.argv[5] || '90000', 10);
const W = parseInt(process.argv[6] || '1400', 10);
const H = parseInt(process.argv[7] || '820', 10);

if (!URL_ || !OUT) {
  console.error('usage: node tools/shotcam.js <url> <out.png> [waitExpr] [timeoutMs] [w] [h]');
  process.exit(2);
}

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9300 + Math.floor(Math.random() * 90);
const PROFILE = path.join(os.tmpdir(), 'shotcam' + Date.now());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const proc = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--user-data-dir=' + PROFILE,
    '--remote-debugging-port=' + PORT,
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--window-size=' + W + ',' + H,
    'about:blank'
  ], { stdio: 'ignore' });

  let wsUrl = null;
  const t0 = Date.now();
  while (!wsUrl && Date.now() - t0 < 15000) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    if (!wsUrl) await sleep(150);
  }
  if (!wsUrl) { proc.kill(); throw new Error('Chrome CDP 未就绪'); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let seq = 0;
  const waiters = new Map();
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (method, params) => new Promise((res) => {
    const id = ++seq; waiters.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  await send('Page.enable');
  await send('Page.navigate', { url: URL_ });

  let ok = false;
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    const r = await send('Runtime.evaluate', { expression: WAIT, returnByValue: true });
    const v = r && r.result && r.result.result && r.result.result.value;
    if (v) { ok = true; break; }
    await sleep(200);
  }

  await sleep(400);
  const ttl = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  const title = ttl && ttl.result && ttl.result.result && ttl.result.result.value;
  if (title) console.log('TITLE ' + String(title).slice(0, 400));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    console.log((ok ? 'OK ' : 'TIMEOUT ') + '-> ' + OUT);
  } else {
    console.log('FAIL ' + JSON.stringify(shot).slice(0, 200));
  }

  try { ws.close(); } catch (e) {}
  proc.kill();
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
}

main().catch((e) => { console.error('ERR', e && e.message); process.exit(3); });
