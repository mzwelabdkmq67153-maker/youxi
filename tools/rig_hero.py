# -*- coding: utf-8 -*-
"""
给 Tripo 静态 hero 模型加骨骼（B 路线）

用法：
  blender --background --python tools/rig_hero.py -- <in.glb> <out.glb>

做的事：
  1. 导入 glb，apply 变换，把 mesh 摊到世界坐标
  2. 按包围盒比例建 21 骨标准人形骨架，命名与 swordsman_idle 一致
     （Hips/Spine/Chest/Neck/Head/Shoulder.L|R/UpperArm.*/LowerArm.*/Hand.*/Weapon.*/UpperLeg.*/LowerLeg.*/Foot.*）
  3. 用「骨段距离 + 分区门限」写权重（不用 heat map，避免对单网格+武器/披风失败）
  4. 只出一个 2 秒 Idle clip（其余动作继续走 glb3d.js 的 overlay 程序化叠加）
  5. 导出带 skin 的 GLB，关节顺序 = 上面 21 根
"""
import sys, os, math
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    print("NEED_ARGS")
    sys.exit(1)
src, dst = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if not meshes:
    print("NO_MESH")
    sys.exit(1)

# 多个 mesh 时合并成一个（Tripo 一般是 1 个，保险起见）
for o in bpy.context.selected_objects:
    o.select_set(False)
mesh = max(meshes, key=lambda o: len(o.data.vertices))
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
if len(meshes) > 1:
    for o in meshes:
        if o != mesh:
            o.select_set(True)
    bpy.ops.object.join()
    mesh = bpy.context.view_layer.objects.active

bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# glb 导入的三角面顶点是按面拆开的（同名位置各存一份），不焊接的话每个三角形
# 都是独立连通块：武器/披风无法整块识别，权重也没法沿网格平滑。先焊一遍。
before = len(mesh.data.vertices)
if len(mesh.data.edges) and (len(mesh.data.polygons) > 0):
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0012)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    print("WELD %d -> %d" % (before, len(mesh.data.vertices)))

xs = [v.co.x for v in mesh.data.vertices]
ys = [v.co.y for v in mesh.data.vertices]
zs = [v.co.z for v in mesh.data.vertices]
z0, z1 = min(zs), max(zs)
h = max(z1 - z0, 0.01)

# ---- 骨表（比例，z 向上） ----
X_ARM = 0.105 * h
X_LEG = 0.058 * h
Z_HIPS = z0 + 0.500 * h
Z_SPINE = z0 + 0.565 * h
Z_CHEST = z0 + 0.690 * h
Z_NECK = z0 + 0.775 * h
Z_HEAD = z0 + 0.845 * h
Z_TOP = z0 + 0.980 * h
Z_SHO = z0 + 0.755 * h
Z_ELB = z0 + 0.615 * h
Z_WRI = z0 + 0.485 * h
Z_HND = z0 + 0.425 * h
Z_HIPJ = z0 + 0.480 * h
Z_KNEE = z0 + 0.255 * h
Z_ANK = z0 + 0.045 * h


def P(x, y, z):
    return Vector((x, y, z))


BONES = [
    # name,        head,                     tail,                      parent
    ("Hips",       P(0, 0, Z_HIPS),          P(0, 0, Z_SPINE),          None),
    ("Spine",      P(0, 0, Z_SPINE),         P(0, 0, Z_CHEST),          "Hips"),
    ("Chest",      P(0, 0, Z_CHEST),         P(0, 0, Z_NECK),           "Spine"),
    ("Neck",       P(0, 0, Z_NECK),          P(0, 0, Z_HEAD),           "Chest"),
    ("Head",       P(0, 0, Z_HEAD),          P(0, 0, Z_TOP),            "Neck"),
    ("Shoulder.L", P(0.02 * h, 0, Z_NECK - 0.01 * h), P(X_ARM, 0, Z_SHO), "Chest"),
    ("UpperArm.L", P(X_ARM, 0, Z_SHO),       P(X_ARM * 1.10, 0, Z_ELB), "Shoulder.L"),
    ("LowerArm.L", P(X_ARM * 1.10, 0, Z_ELB), P(X_ARM * 1.15, 0, Z_WRI), "UpperArm.L"),
    ("Hand.L",     P(X_ARM * 1.15, 0, Z_WRI), P(X_ARM * 1.15, 0, Z_HND), "LowerArm.L"),
    ("Weapon.L",   P(X_ARM * 1.15, 0, Z_HND), P(X_ARM * 1.15, 0, Z_HND - 0.03 * h), "Hand.L"),
    ("Shoulder.R", P(-0.02 * h, 0, Z_NECK - 0.01 * h), P(-X_ARM, 0, Z_SHO), "Chest"),
    ("UpperArm.R", P(-X_ARM, 0, Z_SHO),      P(-X_ARM * 1.10, 0, Z_ELB), "Shoulder.R"),
    ("LowerArm.R", P(-X_ARM * 1.10, 0, Z_ELB), P(-X_ARM * 1.15, 0, Z_WRI), "UpperArm.R"),
    ("Hand.R",     P(-X_ARM * 1.15, 0, Z_WRI), P(-X_ARM * 1.15, 0, Z_HND), "LowerArm.R"),
    ("Weapon.R",   P(-X_ARM * 1.15, 0, Z_HND), P(-X_ARM * 1.15, 0, Z_HND - 0.03 * h), "Hand.R"),
    ("UpperLeg.L", P(X_LEG, 0, Z_HIPJ),      P(X_LEG, 0, Z_KNEE),       "Hips"),
    ("LowerLeg.L", P(X_LEG, 0, Z_KNEE),      P(X_LEG, 0, Z_ANK),        "UpperLeg.L"),
    ("Foot.L",     P(X_LEG, 0, Z_ANK),       P(X_LEG, -0.055 * h, z0 + 0.012 * h), "LowerLeg.L"),
    ("UpperLeg.R", P(-X_LEG, 0, Z_HIPJ),     P(-X_LEG, 0, Z_KNEE),      "Hips"),
    ("LowerLeg.R", P(-X_LEG, 0, Z_KNEE),     P(-X_LEG, 0, Z_ANK),       "UpperLeg.R"),
    ("Foot.R",     P(-X_LEG, 0, Z_ANK),      P(-X_LEG, -0.055 * h, z0 + 0.012 * h), "LowerLeg.R"),
]

arm_data = bpy.data.armatures.new("HeroRig")
arm = bpy.data.objects.new("HeroRig", arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
for name, head, tail, parent in BONES:
    b = eb.new(name)
    b.head = head
    b.tail = tail
    if parent:
        b.parent = eb[parent]
        b.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')

# ---- 权重：骨段距离 + 分区门限 ----
SEG = {}
for name, head, tail, parent in BONES:
    SEG[name] = (head.copy(), tail.copy())

ARM_NAMES = {"Shoulder.L", "UpperArm.L", "LowerArm.L", "Hand.L", "Weapon.L",
             "Shoulder.R", "UpperArm.R", "LowerArm.R", "Hand.R", "Weapon.R"}
TORSO_NAMES = {"Hips", "Spine", "Chest", "Neck", "Head"}

# 注意：不要把 Hand 骨段往下延长去"兜"武器 —— 那条竖线会穿过大腿外侧，
# 把整条腿和披风下摆吸到手骨上，挥手时腿被甩成 1.5 米长的条。


def seg_dist(p, a, b):
    ab = b - a
    t = 0.0
    l2 = ab.length_squared
    if l2 > 1e-9:
        t = max(0.0, min(1.0, (p - a).dot(ab) / l2))
    return (p - (a + ab * t)).length


groups = {}
for name, _, _, _ in BONES:
    groups[name] = mesh.vertex_groups.new(name=name)

# ---- 连通块：体侧那些又细又长的独立块是武器/挂件，整块刚绑到 Weapon 骨，避免抬臂时被撕成柱 ----
nv = len(mesh.data.vertices)
print("MESH v=%d e=%d p=%d" % (nv, len(mesh.data.edges), len(mesh.data.polygons)))
uf = list(range(nv))


def find(a):
    while uf[a] != a:
        uf[a] = uf[uf[a]]
        a = uf[a]
    return a


# 用多边形环建邻接与连通块：glb 导入的 mesh 常常没有独立边表（edges 为空），
# 只有 polygon 的顶点环可用，之前用 edges 导致「连通块恒为单点、平滑空转」。
NEI = [[] for _ in range(nv)]
for poly in mesh.data.polygons:
    vs = poly.vertices
    m = len(vs)
    for k in range(m):
        a = vs[k]
        b = vs[(k + 1) % m]
        if a == b:
            continue
        NEI[a].append(b)
        NEI[b].append(a)
        ra, rb = find(a), find(b)
        if ra != rb:
            uf[ra] = rb

islands = {}
for i in range(nv):
    islands.setdefault(find(i), []).append(i)
print("ISLANDS total=%d max=%d" % (len(islands), max(len(v) for v in islands.values())))

HANG = {}   # vidx -> Hand.L / Hand.R
for root_id, ids in islands.items():
    if len(ids) < 80:
        continue
    xs = [mesh.data.vertices[i].co.x for i in ids]
    ys = [mesh.data.vertices[i].co.y for i in ids]
    zs = [mesh.data.vertices[i].co.z for i in ids]
    dx = max(xs) - min(xs); dy = max(ys) - min(ys); dz = max(zs) - min(zs)
    cx = (min(xs) + max(xs)) * 0.5
    longest = max(dx, dy, dz); shortest = min(dx, dy, dz)
    print("ISLAND n=%d dx=%.3f dy=%.3f dz=%.3f cx=%.3f" % (len(ids), dx, dy, dz, cx))
    # 细长块 = 武器/挂件：整块刚绑到手骨，否则远端顶点会被分给离它最近的腿/髋，抬臂时撕成碎条
    if longest > 0.22 * h and shortest < 0.07 * h:
        bone = "Hand.L" if cx > 0 else "Hand.R"
        for i in ids:
            HANG[i] = bone
print("HANG verts=%d" % len(HANG))

# 手持武器（刀/剑）是刚体，但 Tripo 把它们和手焊在同一块网格，按连通块无法识别。
# 兜底：腕以下 + 明显外撑的顶点只可能是垂在手边的武器（腿在 |x|≈0.058h，不会到 8.5cm 外），
# 整根硬绑到手骨；不插值，否则挥砍时刀身被不同骨拉成碎条。
hx = 0
for i in range(nv):
    if i in HANG:
        continue
    p = mesh.data.vertices[i].co
    if False:
        HANG[i] = "Hand.L" if p.x > 0 else "Hand.R"
        hx += 1
print("WEAPON verts=%d total_hard=%d" % (hx, len(HANG)))

for i, bone in HANG.items():
    groups[bone].add([i], 1.0, 'REPLACE')

unweighted = 0
WV = [None] * nv
for i, v in enumerate(mesh.data.vertices):
    if i in HANG:
        WV[i] = {HANG[i]: 1.0}
        continue
    p = v.co
    cands = []
    for name, (a, b) in SEG.items():
        d = seg_dist(p, a, b)
        # 手臂骨只吃紧贴骨链的顶点（胶囊 7.5cm）；斗篷/披风/背后武器离骨链远，
        # 一律由下面兜底交给躯干骨，不会跟着抬臂被拽成布片扇。
        if name in ARM_NAMES:
            if abs(p.x) < 0.042 * h: continue
            if p.z > Z_SHO - 0.030 * h: continue
            if p.y > 0.025 * h: continue
            if d > 0.055 * h: continue
        if name in TORSO_NAMES and abs(p.x) > 0.170 * h:
            continue
        if (name.startswith("UpperLeg") or name.startswith("LowerLeg") or name.startswith("Foot")):
            if p.z > Z_HIPS + 0.070 * h:
                continue
        if name == "Head" and p.z < Z_NECK - 0.02 * h:
            continue
        cands.append((name, d))
    if not cands:
        cands = [(n, seg_dist(p, s[0], s[1])) for n, s in SEG.items()]
        unweighted += 1
    cands.sort(key=lambda x: x[1])
    top = cands[:1]
    ws = [(n, 1.0 / ((d + 0.012 * h) ** 2.4)) for n, d in top]
    tot = sum(w for _, w in ws) or 1.0
    WV[i] = {n: w / tot for n, w in ws}

# 权重沿网格邻接抹平若干轮：门限和 top2 硬切会在手臂/躯干交界留断层，
# 断层两侧顶点在抬臂时错开就会把肩部布片撕成薄片；抹平后过渡连续，动作才不裂。
SMOOTH_PASS = 0
for _ in range(SMOOTH_PASS):
    NW = [None] * nv
    for i in range(nv):
        if i in HANG:
            NW[i] = WV[i]
            continue
        acc = {}
        for b, w in WV[i].items():
            acc[b] = acc.get(b, 0.0) + w * 0.55
        nb = NEI[i]
        if nb:
            f = 0.45 / len(nb)
            for j in nb:
                for b, w in WV[j].items():
                    acc[b] = acc.get(b, 0.0) + w * f
        NW[i] = acc
    WV = NW

# 写组：每顶点取权重最大的 4 根骨（glTF skin 上限 4）
for i in range(nv):
    top4 = sorted(WV[i].items(), key=lambda x: -x[1])[:4]
    tot = sum(w for _, w in top4) or 1.0
    for n, w in top4:
        if w / tot < 1e-4:
            continue
        groups[n].add([i], w / tot, 'REPLACE')

# 绑定（保留已有顶点组）
mod = mesh.modifiers.new(name="Armature", type='ARMATURE')
mod.object = arm
mesh.parent = arm
mesh.matrix_parent_inverse = arm.matrix_world.inverted()

# ---- Idle clip：48 帧 @24fps = 2s 循环呼吸 ----
bpy.context.scene.render.fps = 24
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'XYZ'

arm.animation_data_create()
act = bpy.data.actions.new("Idle")
arm.animation_data.action = act

hips = arm.pose.bones["Hips"]
chest = arm.pose.bones["Chest"]
head = arm.pose.bones["Head"]
spine = arm.pose.bones["Spine"]
zero = {pb.name: pb.location.copy() for pb in arm.pose.bones}

KEYS = [(1, 0.0), (13, 1.0), (25, 0.0), (37, -1.0), (49, 0.0)]
for f, s in KEYS:
    bpy.context.scene.frame_set(f)
    hips.location = zero["Hips"] + Vector((0, 0, 0.008 * h * s))
    chest.rotation_euler = (0.012 * s, 0.0, 0.0)
    spine.rotation_euler = (0.008 * s, 0.0, 0.0)
    head.rotation_euler = (-0.006 * s, 0.010 * s, 0.0)
    hips.rotation_euler = (0.0, 0.006 * s, 0.0)
    for pb in (hips, chest, spine, head):
        pb.keyframe_insert(data_path="location", frame=f)
        pb.keyframe_insert(data_path="rotation_euler", frame=f)

# Blender 5.x 用 slotted action，没有 action.fcurves；关键帧默认 BEZIER，不再遍历改插值

bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.scene.frame_set(1)

# ---- 导出 ----
kw = dict(filepath=dst, export_format='GLB', use_selection=False, export_apply=False, export_yup=True)
try:
    bpy.ops.export_scene.gltf(export_animations=True, export_animation_mode='ACTIONS',
                              export_skins=True, export_anim_single_armature=True, **kw)
except TypeError:
    bpy.ops.export_scene.gltf(export_animations=True, export_skins=True, **kw)

print("OK h=%.3f bones=%d verts=%d unweighted=%d out=%s" % (
    h, len(BONES), len(mesh.data.vertices), unweighted, os.path.basename(dst)))
