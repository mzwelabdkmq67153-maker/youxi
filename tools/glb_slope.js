/* 量 GLB 的"地面倾角"：取底部一段高度的顶点做最小二乘平面拟合，输出法线与倾角。
   用法：node tools/glb_slope.js <file.glb> [底部占比=0.12]
   用途：场景资产被 Tripo 导出成歪的时，先量出真实的 roll/pitch，再决定在装配侧还是资产侧校正。 */
const fs = require('fs');

const file = process.argv[2];
const frac = parseFloat(process.argv[3] || '0.12');
const band = (function () {
  const m = /^(-?[\d.]+):(-?[\d.]+)$/.exec(process.argv[4] || '');
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
})();
if (!file) { console.error('usage: node glb_slope.js <file.glb> [bottomFraction] [yLo:yHi]'); process.exit(1); }

const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error('not a glb'); process.exit(1); }
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8; // 跳过 BIN chunk 头

function readAccessor(idx) {
  const acc = json.accessors[idx];
  const bv = json.bufferViews[acc.bufferView];
  const off = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const out = new Float32Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < comps; c++) {
      const p = off + (i * comps + c) * 4;
      out[i * comps + c] = buf.readFloatLE(p);
    }
  }
  return { data: out, comps: comps };
}

// 只处理静态单网格场景（node 变换这里按 TRS 应用一遍）
const nodes = json.nodes || [];
const nodeMat = (n) => {
  if (n.matrix) return n.matrix;
  return null;
};

const pos = [];
json.meshes.forEach((m) => {
  (m.primitives || []).forEach((p) => {
    const a = p.attributes && p.attributes.POSITION;
    if (a == null) return;
    const { data, comps } = readAccessor(a);
    for (let i = 0; i < data.length; i += comps) pos.push([data[i], data[i + 1], data[i + 2]]);
  });
});

if (!pos.length) { console.error('no POSITION'); process.exit(1); }

// 资产可能在节点上带变换，先把矩阵乘进去（只有 1 个节点时也照做，避免漏掉旋转）
const rootIdx = (json.scenes && json.scenes[0] && json.scenes[0].nodes) || [];
const mats = new Map();
function walk(ni, parent) {
  const n = nodes[ni];
  let m = parent;
  if (n.matrix) m = mul(parent, n.matrix);
  else if (n.translation || n.rotation || n.scale) m = mul(parent, trs(n));
  mats.set(ni, m);
  (n.children || []).forEach((c) => walk(c, m));
}
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function trs(n) {
  const t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  const m = [
    (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
    (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
    (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
  return m;
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
rootIdx.forEach((i) => walk(i, I));

// 顶点转换到世界空间（节点矩阵按 glTF 列主序）
const W = [];
pos.forEach((p) => {
  let m = I;
  json.meshes.forEach(() => {});
  W.push({ x: p[0], y: p[1], z: p[2], m });
});
// 简化：只有一个节点且无变换时直接算，多节点时按第一个节点的矩阵（场景资产就是单节点）
let mm = I;
if (nodes.length === 1 && mats.has(0)) mm = mats.get(0);
const wpos = pos.map(([x, y, z]) => ({
  x: mm[0] * x + mm[4] * y + mm[8] * z + mm[12],
  y: mm[1] * x + mm[5] * y + mm[9] * z + mm[13],
  z: mm[2] * x + mm[6] * y + mm[10] * z + mm[14],
}));

let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
wpos.forEach((v) => {
  minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
  minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
});
const h = maxY - minY;
const lowTop = minY + h * frac;
const low = band
  ? wpos.filter((v) => v.y >= band[0] && v.y <= band[1])
  : wpos.filter((v) => v.y <= lowTop);

// 最小二乘平面：y = a*x + b*z + c，法线 = (-a, 1, -b)
let sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0, n = low.length;
low.forEach((v) => {
  sx += v.x; sz += v.z; sy += v.y;
  sxx += v.x * v.x; szz += v.z * v.z; sxz += v.x * v.z;
  sxy += v.x * v.y; szy += v.z * v.y;
});
const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
  - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
  + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
const A = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]];
const D = det(A);
const solve = (col) => {
  const a2 = A.map((r) => r.slice());
  a2[0][0] = sxy; a2[1][0] = szy; a2[2][0] = sy;
  return det(a2) / D;
};
const a = solve(0), b = solve(1), c = solve(2);

const up = [0, 1, 0];
const nrm = Math.hypot(-a, 1, -b);
const nrmUnit = [-a / nrm, 1 / nrm, -b / nrm];
const tilt = Math.acos(Math.min(1, Math.max(-1, nrmUnit[1]))) * 180 / Math.PI;
// 绕哪个轴的 roll：法线在 x 上的分量决定绕 Z 轴滚转，z 分量决定绕 X 轴俯仰
const rollZ = Math.atan2(nrmUnit[0], nrmUnit[1]) * 180 / Math.PI;
const pitchX = Math.atan2(-nrmUnit[2], nrmUnit[1]) * 180 / Math.PI;

console.log('file      ', file.split(/[\\/]/).pop());
console.log('verts     ', wpos.length, ' bottomSample', low.length);
console.log('bbox      x[' + minX.toFixed(2) + ',' + maxX.toFixed(2) + '] y[' + minY.toFixed(2) + ',' + maxY.toFixed(2) + '] z[' + minZ.toFixed(2) + ',' + maxZ.toFixed(2) + ']');
console.log('plane     y=' + a.toFixed(4) + 'x + ' + b.toFixed(4) + 'z + ' + c.toFixed(4));
console.log('normal    (' + nrmUnit.map((v) => v.toFixed(4)).join(', ') + ')');
console.log('tilt      ' + tilt.toFixed(2) + '°   rollZ(绕Z)=' + rollZ.toFixed(2) + '°  pitchX(绕X)=' + pitchX.toFixed(2) + '°');
