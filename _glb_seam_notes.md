# GLB 写实档接缝实测笔记（加载器组）

- 工程根：`C:\Users\施豪杰\Doubao\chats\2026-11-19\new-chat-1\游戏`
- 交付代码：`glb3d.js`（`window.Glb3D`，与 Real3D / Hero3D 同签名）、`_glb_seam.html`（接缝验证页）、`_glb_boneaxes.html` + `_glb_boneaxes_notes.md`（骨骼轴诊断）
- 验证入口：本地静态服务 `127.0.0.1:8080`；浏览器 Chrome 157（真机 GPU）+ 无头 Chrome（SwiftShader 软渲染，独立 `--user-data-dir`）双路核对
- three r128 UMD；未改 `index.html` / `art.js` / `game.js` / `night.js`；未做 commit / push
- 冻结规范：`brief_glb_seam.md`（加载器组认领范围）

## 1. 资产实测（脚本直解 GLB JSON chunk，与 `art/模型/glb/inventory.json` 一致）

| 模型 | 文件(2K) | 文件(1024) | 三角面 | 顶点 | 骨骼 | 实测身高 | 名义身高 | 材质槽 | 发光材质 emissive |
|---|---|---|---|---|---|---|---|---|---|
| swordsman_idle | 4,127,728 B | 2,267,124 B | 14,999 | 18,660 | 21 | 1.83412 m | 1.84 m | 6 | MAT_Emissive_Cyan `#11e0ff`（factor≈0.071,0.882,1.0） |
| gunner_idle | 4,000,772 B | 2,070,544 B | 16,000 | 16,764 | 21 | 1.889851 m | 1.89 m | 6 | MAT_Emissive_Cyan `#11e0ff` |
| mage_idle | 3,595,808 B | 1,821,360 B | 14,000 | 13,990 | 21 | 1.960404 m | 1.96 m | 6 | MAT_Emissive_Purple `#a63bff`（factor≈0.653,0.232,1.0） |

材质槽名（6 个，槽名不变）：

- 剑客 / 枪手：`MAT_Armor_Plate` · `MAT_Cloth_Navy` · `MAT_Leather_Black` · `MAT_Skin` · `MAT_Hair_Black` · `MAT_Emissive_Cyan`
- 术士：`MAT_Armor_Plate` · `MAT_Cloth_Purple` · `MAT_Leather_Black` · `MAT_Skin` · `MAT_Hair_Black` · `MAT_Emissive_Purple`

### 贴图口径（资产组 2026-11-23 实测确认，勿按旧口径写死）

- **每份 GLB 真实源贴图 3 张**：normal PNG + baseColor JPEG + metallicRoughness JPEG，由 6 个材质槽共享；**不是 6 张**。
- RM 这一张在 three 里同时挂 `material.roughnessMap` 与 `material.metalnessMap`（同一源图），HUD 合并显示为一条 `rmMap`。
- 2K 档：三张均 2048×2048；1024 档：三张均 1024×1024。
- 1024 降级版与 2K 版几何 / 21 joints / 材质槽名 / `Idle_2s` 时长帧数 / 贴地原点 / 身高包围盒完全一致（身高差 0 mm）；文件体积约为 2K 的 0.51–0.55。

### 动画

- 唯一 clip：`Idle_2s`，**49 个关键帧 / 2.041667 s**（48 个采样间隔 + 末帧闭环重复），63 条通道。
- 循环时长按 **2.0417 s** 处理；加载器未用 2.0 s 硬切，贴地采样与 mixer 时长均取 `clip.duration`。

## 2. 加载器实现要点（`glb3d.js`）

1. **同步 build / 异步挂载**：`build(kind, opts)` 立即返回空 `THREE.Group`，置 `userData.glbPending=true / heroKit / glbKind / fit`；GLB 到达后 `add` 进组并清 `glbPending`。`update / swing / cast / pose / stats` 在未加载、失败、回退态全部安全空转。
2. **kind → 模型映射（冻结）**：swordsman/blade/grunt/elite→swordsman_idle；gunner/shooter/duelist→gunner_idle；warlock/mage/boss→mage_idle。
3. **fit 因子（只加内层节点，根节点 scale 归 game.js）**：敌人档 FIT 一律归一到基准 1.800 m / GLB 名义身高，类型放大全部交给 `game.js` 根 scale（`ArenaArt.scaleOf`），**不再把根 scale 算进 FIT**（旧版 boss/elite 把根 1.85/1.24 二次乘入，boss 网格被重复放大到 6.162 m，已修）。
   - grunt 0.9783（1.800/1.84）；shooter/duelist 0.9524（1.800/1.89）；elite 0.9783（根 1.24 → 世界 2.232 m）；boss 0.9184（根 1.85 → 世界 3.330 m）。
   - 玩家/远端（swordsman/gunner/warlock/mage/blade）fit=1，世界身高 1.834 / 1.890 / 1.960。
4. **缓存与克隆**：按 url 缓存 Promise + gltf，一份 GLB 只 fetch/parse 一次；每实例 `SkeletonUtils.clone` + 独立 `AnimationMixer`。
5. **资源守卫（硬性）**：每个 Mesh `geometry.userData.shared=true`；材质按实例 `clone()`（贴图只共享引用），`material.userData.shared=true`。避免 `disposeGroup()` 释放共享几何裂开，也避免 `setEmissiveFlash` 写 emissive 让同模型全体闪红。
6. **Root motion**：每帧 mixer 更新后把 Hips 的 x/z 锁回绑定姿势，角色不漂移。
7. **贴地补偿**：48 帧采样 `Box3.min.y` 取最小值，内层节点 `position.y = -minY` 抬到脚底归零。
8. **夜间档**：异步挂载完成后若 `NightGrade.active()`，调 `NightGrade.silhouette(root, userData.nightSil || 0.62)`；压暗/面罩光公式只走 night.js 一份，加载器不复制。
9. **贴图档位（按 kind 策略 + URL 覆盖）**：`Glb3D.setTierPolicy({hero:'2k', enemy:'1024'})`；hero 组=`swordsman/blade/gunner/warlock/mage`，enemy 组=`grunt/shooter/duelist/elite/boss`。`modelUrl` 优先取该 kind 策略档；`?tex=1024` / `?tex=2k` 全局覆盖（对比用）；无参数走默认策略（hero 2k / enemy 1024）。cache 按完整 URL 分开，同一模型可同时存在 2K 与 1024 两个 URL 实例、互不覆盖；`info().entries[kind].tier/url` 反映每个 kind 实际取的档，`info().policy / override / fallbacks / cacheUrls` 并列。1024 文件缺失静默回退 2K 并记入 `info().fallbacks`。
10. **失败兜底**：loader 缺失或加载失败回退 `window.Real3D.build(kind, opts)`，标 `userData.glbFallback=true`。
11. **动作叠加**：不新增 clip，在 `mixer.update()` 之后做程序化骨骼 delta；轴映射依据 `_glb_boneaxes.html` 实测（见该笔记），未盲猜。
12. **骨骼名查表**：运行时骨骼名点号被加载器去掉（`UpperArm.L` → `UpperArmL`），查表前统一去点号。

### 叠加层关键修复（本轮实测发现并修正）

- **堆积根因**：Idle clip 63 条通道覆盖全部 21 根骨骼，且 glTF 旋转在 three 里走的是 **`.quaternion` 轨**（不是 `.rotation`）。mixer 每帧写骨骼四元数；直接对 `bone.rotation` 欧拉角 `+=` 时，欧拉角不会从四元数反向同步，增量在陈旧欧拉角上逐帧堆积，动作中段肢体/武器飞脱。
- **现方案（纯四元数局部增量）**：每帧 `mixer.update()` 之后，先取骨骼当前四元数 `q`，构造增量四元数 `dq`（Euler XYZ），**右乘** `q' = q·dq`（骨骼局部空间；左乘是父空间旋转，会搅乱轴），写回 `bone.quaternion`。探针实测连续 120 帧四元数长度恒为 1.0000、无逐帧累积（f1 与 f3 姿态一致，其余波动仅来自 clip 摆动）。
- **躯干/颈与手臂同法**：不再回写 rest 基准（rest 与 clip 臂姿之差会与蒙皮剪切）；所有叠加都在当前 clip 姿态上做局部增量。攻击结束后 0.25 s 平滑回零，`attack=null` 回 Idle。
- **HUD 读数口径**：HUD 上 `uaR x/z` 直接读 `bone.rotation` 欧拉角，该欧拉角由四元数反解、受万向节分解影响，**数值仅供参考，不作幅度口径**；真实叠加幅度以代码内增量 rad 为准（见第 4 节角度表）。
- 真机浏览器复测：连续触发 slash/shoot/cast，每次结束 1.4 s 后 HUD 攻击标记消失、姿态回 Idle，无残余旋转、控制台无报错。

## 3. 日场实机 HUD 实测（2K 档，fit=1，真机浏览器）

| 职业 | 模型 | 身高实测 | 骨骼 | 三角面 | 顶点 | 贴地 minY | 挂载耗时(冷) |
|---|---|---|---|---|---|---|---|
| 剑客 swordsman | swordsman_idle | 1.834 m | 21 | 14,999 | 18,660 | 1.2 mm | 662–819 ms |
| 枪手 gunner | gunner_idle | 1.890 m | 21 | 16,000 | 16,764 | 0.4 mm | 755–935 ms |
| 术士 warlock | mage_idle | 1.960 m | 21 | 14,000 | 13,990 | -0.4 mm | 571–751 ms |

- 贴地误差均 ≤5 mm 达标（跨帧 48 帧采样最小值）。
- 三职业并排身高 1.834 / 1.890 / 1.960，术士最高、剑客最矮，与名义 1.84 / 1.89 / 1.96 一致，无明显高低错位。
- 日场 `renderer.info`：draw calls=26，triangles=45,055，geometries=24。

### 敌人/首领尺寸复测（`?demo=size`，纯网格 Box3，含根 scale）

| 类型 | FIT（内层） | 根 scale（game.js `scaleOf`） | 实测世界身高 | 目标 | 偏差 |
|---|---|---|---|---|---|
| swordsman（主角） | 1.000 | 1.00 | 1.834 m | 1.834 | — |
| grunt | 0.9783 | 1.00 | 1.794 m | ≈1.800 | -0.6 cm |
| shooter | 0.9524 | 1.02 | 1.836 m | 1.836 | 0 |
| elite | 0.9783 | 1.24 | 2.225 m | 2.232 | -0.7 cm |
| boss | 0.9184 | 1.85 | 3.331 m | 3.330 | +0.1 cm |

- 修复前旧 FIT 把根 scale 算入内层，boss 网格身高 6.162 m（×1.85 重复放大）；现口径 FIT 只归一到基准 1.800 m，类型放大全部由根 scale 承担，五项均落在 ±2 cm 内。截图 `glb_seam_boss尺寸.png`。
- 挂载耗时为本地文件 + 真机 GPU 冷启动单模型口径；同 URL 多实例走缓存 Promise，不重复 fetch/parse。无头 SwiftShader 软渲染下纹理解码耗时波动很大（百 ms 到十余秒），不作为性能口径。

### 贴图计数口径（两套，勿混）

- **源贴图口径（HUD「贴图(3)」）**：每模型 3 条——`map`(baseColor) / `normalMap` / `rmMap`(RM 合并 roughness+metalness)。
- **renderer.info.memory.textures 口径**：按 Texture 外壳计数。日场三模型合计 75（含场景物件；每实例材质 clone 出独立 Texture 外壳，RM 同时挂两张外壳）。两者口径不同，HUD 与本笔记分列。

## 4. 动作叠加实测（增量角度表，峰值 rad）

依据骨骼轴诊断结论：上臂/前臂/大腿/小腿局部 X=前后摆、Y=扭转、Z=内外展；Chest X=俯仰、Y=转体、Z=侧弯。下表为**叠加增量**（在 clip 当前姿态上局部叠加，非骨骼绝对角）；符号按轴实测：四肢前抬/前摘取负 X，外展走 Z；Chest +X 前倾。

| 动作 | 右上臂 X | 右前臂 X | 左上臂 | 左前臂 X | 躯干/颈增量 | 备注 |
|---|---|---|---|---|---|---|
| `slash` 横斩 | -1.10（前摆，wind×0.85）；Z 外展 ≤0.70 | ≤-1.05 | 不动 | 不动 | Chest Y 转体 ≤0.26；Spine X ≤0.12 | 挥砍前摆保留到 ~1.10；观感正常，作幅度参照 |
| `shoot` 举枪 | -0.45 | -0.70 | X -0.35 | -0.75 | Chest X 后坐 ≤0.08；Chest Y 转体 0.15 | 肩抬 0.35–0.5 档内，肘弯 0.6–0.8 档内，枪口大致朝前 |
| `cast` 施法 | 非 mage -0.15；**mage 禁用** | 非 mage -0.10；**mage 禁用** | 非 mage Z ≤0.13；**mage 禁用** | 不动 | Chest X 后仰 0.05；Head X 0.06 | **mage_idle 手臂叠加全关（arm=off，资产限制）**，见第 7 节缺陷 #6 |
| `aim` 举枪待命 | -1.15 | -1.30 | X -0.95 | -1.45 | Chest Y 0.26 | 肘弯 ≤1.5 上限内 |
| `walk` 移动 | — | — | — | — | Chest X 前倾 0.10 | timeScale 随速度提升（上限 1.6） |
| `hit` 受击 | — | — | — | — | Spine X -0.18；Chest X -0.10；Head X -0.12 | 后仰增量 |

- 收敛口径：上臂单轴增量 ≤1.0–1.2 rad（slash 前摆许可到 1.4，本版 1.10）；肘 ≤1.5；胸/脊/髋旋转增量 ≤0.3 rad。
- **mage_idle（术士/boss）手臂叠加全关**：slash/shoot/cast/aim 的肩/上臂/前臂增量对该模型一律置 0，仅保留 Chest ≤0.10、Spine ≤0.05、Head ≤0.08 微动；`info().entries[kind].arm='off'`，`info().armPolicy.mage_idle='arm=off（资产限制…）'`。
- 入/出平滑：前 25% 缓入、后 25% 缓出；结束后 0.25 s 增量线性回零，`attack=null`。真机浏览器复测：三动作结束后攻击标记清除、姿态回 Idle，无抽搐、无残余旋转。
- 移动腿部摆动未叠加（仅 Idle clip，观感以实机为准）。
- 接缝页演示对三职业同时触发同一动作；局内动作按职业映射（slash=剑客、shoot=枪手、cast=术士），非本职业动作姿态仅作压力观察，不作该职业验收姿态。
- 未决观察：枪手 shoot 中段枪口仍偏上斜，水平朝前可能还需补 `Weapon.R` 骨的 Y 扭转/俯仰微调；本轮未盲调武器骨，留待实机走位确认后再定。
- 截图：`glb_seam_动作_slash.png` / `glb_seam_动作_shoot.png` / `glb_seam_动作_cast.png`（全身中段 q≈0.50）；`glb_seam_动作_术士近景.png`、`glb_seam_动作_剑客近景.png`（袖口/披风核对）。

## 5. 夜景验收（`?look=night`）

- 剪影压暗由 `NightGrade.silhouette` 完成；实机三职业主体压暗后，发光条仍可见、未糊成白块、未发黑：
  - 剑客：胸甲青色发光条；枪手：青色护目镜、斜挎带、腕/靴发光边；术士：紫色面帘光、袍身紫色纹路、法杖宝珠。
- 夜景 `renderer.info`：draw calls=32，triangles=45,067，textures=76，geometries=24（多出的绘制/纹理来自剪影面罩光与脚下冷光 Sprite）。
- **夜间身高口径（已修为纯网格）**：早期夜景 HUD 读数 2.035 / 2.101 / 2.183 m 偏大，原因是 `silhouette()` 在脚下加了冷光 Sprite，旧版 `Box3.setFromObject(mesh)` 把 Sprite 包围体一并计入，min.y 被压低约 0.20 m。本轮 `stats()` 与贴地采样 `sampleGround()` 均改为**只遍历 Mesh 构建 Box3，排除 Sprite**；复测夜景 HUD 身高回到 1.834 / 1.890 / 1.960 m，与日场纯网格口径一致。Sprite 仍正常渲染（脚下冷光可见），只是不计入身高/贴地测量。
- 截图：`_shots/glb_seam_night.png`。

## 6. 贴图档位策略（hero 2k / enemy 1024）

- 默认策略（无 URL 参数）：hero 组 `swordsman/blade/gunner/warlock/mage` 走 **2K**；enemy 组 `grunt/shooter/duelist/elite/boss` 走 **1024**。`?tex=2k` 全 2K、`?tex=1024` 全 1024 为全局对比覆盖；cache 按 URL 分开，同一模型 2K 与 1024 两套 URL 可同屏共存、互不覆盖。
- `?demo=tier` 同屏留证：swordsman(hero,2k,2048²) / grunt(enemy,1024,1024²) / gunner(hero,2k,2048²) / shooter(enemy,1024,1024²)，`info().fallbacks={}`，控制台无报错。截图 `_shots/glb_seam_tierp.png`，HUD 逐模型打 `档=2k/1024`。
- `?tex=1024` 全局覆盖：三份 `*_1024.glb` 真实走通，`info().fallbacks={}`；HUD 贴图(3) 三条均 1024×1024，身高/三角面/顶点/骨骼/贴地与 2K 逐项一致。观感：视口距离下 1024 与 2K 无肉眼可辨错位/发糊，近看布料略软，可作敌人降级档。截图 `_shots/glb_seam_1024.png`。

### 贴图预算与档位结论（数字取自 `inventory.json` 实测）

- 单份 2K 变体三张 2048 贴图；解码显存按 RGBA8 4B/px × mipmap 系数 1.33。
- 场景预算：主角 1 + 敌人 3 全 2K，唯一 3 变体，贴图解码显存 191.52 MiB（主角 63.84 + 敌人 127.68）；主角 2K + 敌人 1024，唯一 4 变体，解码显存 111.72 MiB（主角 63.84 + 敌人 47.88）。
- 建议：**主角保持 2K；同屏多敌人降 1024**（敌人 1024 与主角 2K 是不同 URL/变体，贴图不跨档共享）。骁龙 680 档位下，单模型 14–16k 三角面、三职业同屏约 45k 三角面 / 26 draw calls；敌人 1024 可显著降低贴图解码显存与带宽，三角面量两档一致。

## 7. 已知缺陷与观察项（模型侧，游戏侧未遮盖，仅记录）

1. **枪手步枪左下碎屑**：步枪模型左下有游离碎屑，日场近景可见。
2. **术士下摆内衬暗块**：袍摆内衬存在一块暗色面。
3. **动作姿态下法杖下段偏移**：术士法杖由两段绑定组成，手持段随上臂/前臂旋转，下段在手臂大幅外展/上举时与手持段出现分离悬浮（见 cast / shoot 动作截图右下）。属于模型侧权重/骨骼绑定划分问题，加载器未做修补。
4. **动作姿态下腰侧鞘/布片偏移**：剑客腰侧长鞘/布片随 Chest 旋转时摆动幅度偏大；同属模型侧布料权重观察项。
5. **术士袖/下摆权重弱（资产侧限制，引擎侧以禁用叠加规避，未修好）**：`mage_idle` 法袍袖口与下摆多片顶点**未绑到 Hips、权重落在上臂/前臂上**，任何可见抬臂都会把袖/摆拖成脱离袍身的斜条/飞片。无头对照实测：手臂增量归零时袍身主体完整；上臂抬 0.15 rad 仍有下摆松片被拉出，0.30 rad 即出现跨轮廓布片，继续压幅度已无意义。**工程处理：对 `model==='mage_idle'` 的实例，slash/shoot/cast/aim 所有肩/上臂/前臂叠加一律置 0（arm=off），只保留 Chest ≤0.10、Spine ≤0.05、Head ≤0.08 微动**；未用遮罩、缩放或隐藏网格遮盖。局内 boss 走 `bossBurst()` 弹幕、`game.js` 不调 `Hero3D.swing`，术士/boss 本就不触发手臂动作，禁用后不影响 boss 表现，也避免远端术士施法露破袍。**待 Blender 重绑袖/摆到 Hips 后，再按肩抬 0.55–0.75、肘弯 0.35–0.5 放开手臂叠加**；当前状态是资产侧限制下的规避方案，不是权重已修复。
6. 以上缺陷在 Idle 站姿下不明显；动作叠加放大了绑定差异。后续若资产组重绑权重，加载器侧无需改动。

## 8. 截图清单（`_shots/`）

| 文件 | 内容 |
|---|---|
| `glb_seam_全景.png` | 日场三职业并排全景，HUD 全量统计 + 1.60/1.80/2.00 标尺 |
| `glb_seam_近景.png` | 日场枪手近景，装甲/贴图/发光边细节核对 |
| `glb_seam_动作_slash.png` | slash 横斩中段（q≈0.50） |
| `glb_seam_动作_shoot.png` | shoot 举枪中段（q≈0.50） |
| `glb_seam_动作_cast.png` | cast 施法中段（q≈0.50） |
| `glb_seam_动作_术士近景.png` | 术士 cast 近景，袖口/下摆核对 |
| `glb_seam_动作_剑客近景.png` | 剑客 slash 近景，披风/腰侧布片核对 |
| `glb_seam_tierp.png` | hero 2K + enemy 1024 同屏对照（`?demo=tier`），HUD 逐模型档位 |
| `glb_seam_boss尺寸.png` | 主角/grunt/shooter/elite/boss 同框（`?demo=size`），boss 3.331 m、非 6 m |
| `glb_seam_night.png` | 夜景剪影 + 发光条可见度核对（纯网格身高） |
| `glb_seam_1024.png` | 1024 全局覆盖档留证（贴图 1024²、回退空） |
| `glb_boneaxes/`（33 张） | 11 根骨骼 × X/Y/Z 轴向诊断截图，数据表见 `_glb_boneaxes_notes.md` |

## 9. 边界与未决

- 接缝页为验证页，非局内入口；局内实机由接入组用 `index.html` 开关与 `_ingame_glb.html` 验收。
- `pose/setFace` 为安全空实现（GLB 无程序化姿态档、无 morph 目标）。
- 移动腿部摆动未做程序化叠加，仅靠 timeScale + 前倾；若实机走位观感偏滑，后续可再叠腿部 delta。
- 无头 SwiftShader 软渲染仅作结构/截帧留证；帧率与耗时口径以真机浏览器数据为准。
