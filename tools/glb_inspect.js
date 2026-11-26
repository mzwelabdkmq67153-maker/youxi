/* 读 GLB 的 JSON chunk，打印 mesh / skin / joints / animations —— 用来核对绑骨结果 */
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('usage: node glb_inspect.js <file.glb>'); process.exit(1); }
const buf = fs.readFileSync(file);
const magic = buf.readUInt32LE(0);
if (magic !== 0x46546c67) { console.error('not a glb'); process.exit(1); }
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));

const nodes = json.nodes || [];
const skins = json.skins || [];
const anims = json.animations || [];
const prims = (json.meshes || []).reduce((a, m) => a + (m.primitives || []).length, 0);

console.log('file        ', file.split(/[\\/]/).pop());
console.log('nodes       ', nodes.length);
console.log('meshes/prims', (json.meshes || []).length + ' / ' + prims);
console.log('skins       ', skins.length);
for (const s of skins) {
  const names = s.joints.map((i) => nodes[i] && nodes[i].name);
  console.log('  joints     ' + names.length);
  console.log('  names      ' + names.join(', '));
}
console.log('animations  ', anims.length);
for (const a of anims) {
  const dur = Math.max(...(a.samplers || []).map((sp) => {
    const acc = json.accessors[sp.input];
    return acc && acc.max ? acc.max[0] : 0;
  }));
  console.log('  ' + (a.name || '(noname)') + '  channels=' + a.channels.length + '  dur=' + (dur || 0).toFixed(3) + 's');
}

const hasJointAttr = (json.meshes || []).some((m) =>
  (m.primitives || []).some((p) => p.attributes && p.attributes.JOINTS_0 != null && p.attributes.WEIGHTS_0 != null));
console.log('JOINTS_0/WEIGHTS_0 on primitives:', hasJointAttr);
