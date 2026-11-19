/* 极简本地静态服务器，仅用于本机试玩
   用法：node serve.js [端口]     默认 8080，只监听本机 127.0.0.1
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const PORT = Number(process.argv[2] || 8080);
const HOST = '127.0.0.1'; // 只监听本机，避免同网段其他设备直接访问

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

/* 把请求路径解析为 ROOT 内的绝对路径；不合法返回 null
   防护：畸形百分号编码 / NUL 字节 / .. 目录穿越 / ROOT 前缀同名目录逃逸 */
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

function send(res, status, headers, body) {
  res.writeHead(status, Object.assign({ 'X-Content-Type-Options': 'nosniff' }, headers));
  res.end(body);
}

http.createServer((req, res) => {
  const file = resolveSafe(req.url);
  if (!file) {
    send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'bad request');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'not found');
      return;
    }
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache'
    };
    if (req.method === 'HEAD') {
      send(res, 200, headers, '');
      return;
    }
    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'internal error');
        return;
      }
      send(res, 200, headers, data);
    });
  });
}).listen(PORT, HOST, () => {
  console.log('serving: http://localhost:' + PORT);
});
