/* 第七竞技场 · 夜景渲染层（night.js）
   依据参考实机画面的明度结构：整幅压到 8%–15% 明度，只留两处高亮
   —— 冷青（面罩/符阵/祭石）与暖橙（火盆/飘火星）对打。
   做法三层，互不侵占：
     1) grade   渲染后处理：暗部染青、压高光、暗角、颗粒（改 WebGLRenderer.prototype.render）
     2) dress   场地重做：天穹/月/分层雾/湿反光/火盆/光柱/余烬（包装 ArenaScene.build）
     3) mask    人物剪影化：全身压暗 + 头部冷青面罩光（包装 ArenaArt.buildFighter/buildHero）
   只包装、不改写 game.js / scene.js / art.js 内部逻辑。 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  /* ================= 程序贴图 ================= */
  function cv(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function radial(inner, mid, size) {
    size = size || 128;
    var c = cv(size, size), g = c.getContext('2d');
    var r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    r.addColorStop(0, inner);
    r.addColorStop(0.32, mid);
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, size, size);
    var t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.LinearFilter;
    return t;
  }

  var TEX = {};
  function tex(key, make) { if (!TEX[key]) TEX[key] = make(); return TEX[key]; }

  /* 冷青面罩光 / 暖橙火星 / 湿反光条 / 雾团 / 月 */
  function maskTex() { return radial('rgba(226,252,255,0.95)', 'rgba(96,214,246,0.55)', 128); }
  function emberTex() { return radial('rgba(255,236,196,0.95)', 'rgba(255,122,40,0.5)', 64); }
  function moonTex() { return radial('rgba(238,248,255,1)', 'rgba(150,196,220,0.35)', 256); }

  /* 地面湿反光：几十道长条横向笔触，靠加法混合只留高光，不做真反射 */
  function streakTex() {
    var c = cv(512, 512), g = c.getContext('2d');
    g.clearRect(0, 0, 512, 512);
    for (var i = 0; i < 90; i++) {
      var y = Math.random() * 512;
      var w = 40 + Math.random() * 220;
      var h = 1.5 + Math.random() * 7;
      var a = 0.05 + Math.random() * 0.16;
      var x = Math.random() * 512 - w * 0.5;
      var gr = g.createLinearGradient(x, y, x + w, y);
      gr.addColorStop(0, 'rgba(160,220,238,0)');
      gr.addColorStop(0.5, 'rgba(190,235,250,' + a.toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(160,220,238,0)');
      g.fillStyle = gr;
      g.fillRect(x, y, w, h);
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 6);
    return t;
  }

  /* 雾团：上下软化的横带，贴到朝心的竖面片上就是一层雾 */
  function mistTex() {
    var c = cv(256, 256), g = c.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, 'rgba(150,188,206,0)');
    gr.addColorStop(0.45, 'rgba(160,200,218,0.55)');
    gr.addColorStop(0.62, 'rgba(170,208,224,0.42)');
    gr.addColorStop(1, 'rgba(150,188,206,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    var t = new THREE.CanvasTexture(c);
    return t;
  }

  /* ================= 1) 画面分级（后处理） ================= */
  var VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  var FS = [
    'uniform sampler2D tDiffuse;',
    'uniform vec2 res;',
    'uniform float time;',
    'uniform float exposure;',
    'uniform float contrast;',
    'uniform float vig;',
    'uniform float grain;',
    'uniform float sat;',
    'varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'void main(){',
    '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
    '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
    // 暗部染冷青：暗处只留青，最深处再压一层蓝
    '  float sMask = clamp(1.0 - l * 2.0, 0.0, 1.0);',
    '  vec3 cold = c * vec3(0.74, 0.94, 1.10);',
    '  c = mix(c, cold, sMask * 0.85);',
    // 高光微暖：只给火盆与火星一点橙，不与冷青抢主导
    '  float hMask = clamp((l - 0.52) * 2.4, 0.0, 1.0);',
    '  vec3 warm = c * vec3(1.10, 1.01, 0.90);',
    '  c = mix(c, warm, hMask * 0.55);',
    // 灰一点：参考画面几乎没有高饱和，饱和度整体下拉
    '  vec3 gray = vec3(dot(c, vec3(0.299, 0.587, 0.114)));',
    '  c = mix(c, gray, sat);',
    // 对比：以 0.40 为支点压暗中间调，把 8% 以下的黑拉回来一点
    '  c = (c - 0.40) * contrast + 0.40;',
    '  c *= exposure;',
    // 黑位抬高到青黑，避免死黑（参考画面最暗处也不是纯黑）
    '  c = max(c, vec3(0.012, 0.022, 0.030));',
    // 暗角
    '  float d = length((vUv - 0.5) * vec2(res.x / res.y, 1.0));',
    '  c *= mix(1.0, smoothstep(1.02, 0.28, d), vig);',
    // 颗粒
    '  float n = hash(vUv * res + vec2(time * 57.0, time * 91.0));',
    '  c += (n - 0.5) * grain;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var GRADE = { exposure: 1.06, contrast: 1.16, vig: 0.62, grain: 0.030, sat: 0.22 };

  function quadFor(renderer) {
    var rt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false
    });
    rt.texture.encoding = THREE.sRGBEncoding;

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: rt.texture },
        res: { value: new THREE.Vector2(2, 2) },
        time: { value: 0 },
        exposure: { value: GRADE.exposure },
        contrast: { value: GRADE.contrast },
        vig: { value: GRADE.vig },
        grain: { value: GRADE.grain },
        sat: { value: GRADE.sat }
      },
      vertexShader: VS,
      fragmentShader: FS,
      depthTest: false,
      depthWrite: false
    });
    var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    var qScene = new THREE.Scene();
    qScene.add(quad);
    var qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return { rt: rt, mat: mat, scene: qScene, cam: qCam, w: 2, h: 2 };
  }

  var origRender = THREE.WebGLRenderer.prototype.render;
  THREE.WebGLRenderer.prototype.render = function (scene, camera) {
    var self = this;
    if (self.__gradeOff || self.__gradeFail) {
      return origRender.call(self, scene, camera);
    }
    try {
      var st = self.__grade;
      if (!st) st = self.__grade = quadFor(self);
      var size = self.getDrawingBufferSize
        ? self.getDrawingBufferSize(new THREE.Vector2())
        : new THREE.Vector2(self.domElement.width, self.domElement.height);
      var w = Math.max(2, Math.floor(size.x)), h = Math.max(2, Math.floor(size.y));
      if (w !== st.w || h !== st.h) {
        st.w = w; st.h = h;
        st.rt.setSize(w, h);
        st.mat.uniforms.res.value.set(w, h);
      }
      st.mat.uniforms.time.value += 0.016;
      st.mat.uniforms.exposure.value = GRADE.exposure;
      st.mat.uniforms.contrast.value = GRADE.contrast;
      st.mat.uniforms.vig.value = GRADE.vig;
      st.mat.uniforms.grain.value = GRADE.grain;
      st.mat.uniforms.sat.value = GRADE.sat;

      // 场景先渲到离屏，再全屏过一次分级
      self.setRenderTarget(st.rt);
      self.clear();
      origRender.call(self, scene, camera);
      self.setRenderTarget(null);
      self.__gradeOff = true;
      origRender.call(self, st.scene, st.cam);
      self.__gradeOff = false;
    } catch (e) {
      // 分级链任何一步失败就退回直出，绝不让画面黑屏
      self.__gradeFail = true;
      try { self.setRenderTarget(null); } catch (e2) { }
      origRender.call(self, scene, camera);
    }
  };

  /* ================= 2) 场地重做 ================= */
  var LOOK = {
    arena: {
      bg: 0x04080c,
      fog: 0x07141a, near: 8, far: 36,
      hemiSky: 0x22414f, hemiGround: 0x030609, hemi: 0.13,
      keyColor: 0x9fd2e6, key: 0.22,
      fillColor: 0x16384f, fill: 0.09,
      dim: 0.15, wet: 0.60,
      braziers: 4, brazierR: 9.2, brazierH: 2.0,
      embers: 220, shaft: 0.9, moon: 1
    },
    dungeon: {
      bg: 0x03080a,
      fog: 0x061114, near: 11, far: 44,
      hemiSky: 0x1d3a48, hemiGround: 0x020506, hemi: 0.26,
      keyColor: 0x8fc4d8, key: 0.40,
      fillColor: 0x123f52, fill: 0.14,
      dim: 0.42, wet: 0.66,
      braziers: 4, brazierR: 17.4, brazierH: 1.0,
      embers: 260, shaft: 1.0, moon: 0
    }
  };

  var state = { kind: null, scene: null, group: null, embers: null, emberData: null, braziers: [], t: 0 };
  var _v3 = new THREE.Vector3();

  /* 天穹：一整颗反面球，顶点色垂直渐变，替代原来那块纯色 background */
  function skyDome(kind, cfg) {
    var geo = new THREE.SphereGeometry(96, 24, 18);
    var mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color(kind === 'dungeon' ? 0x02070a : 0x040c12) },
        mid: { value: new THREE.Color(kind === 'dungeon' ? 0x0a1a20 : 0x0c1e27) },
        bot: { value: new THREE.Color(cfg.fog) }
      },
      vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying float vY;' +
        'void main(){ float y = vY * 0.5 + 0.5;' +
        ' vec3 c = y > 0.52 ? mix(mid, top, smoothstep(0.52, 0.95, y)) : mix(bot, mid, smoothstep(0.02, 0.52, y));' +
        ' gl_FragColor = vec4(c, 1.0); }'
    });
    var m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    return m;
  }

  /* 雾：分层竖面片，近处薄、远处厚，只做加法/常规混合的低透明，不吃性能 */
  function fogLayers(kind, cfg, group) {
    var mist = tex('mist', mistTex);
    var mat = new THREE.MeshBasicMaterial({
      map: mist, color: cfg.fog, transparent: true, opacity: 0.55,
      depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    var n = 10;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + 0.17;
      var r = 26 + (i % 4) * 6.5;
      var h = 9 + (i % 3) * 3;
      var p = new THREE.Mesh(new THREE.PlaneGeometry(30 + (i % 3) * 8, h), mat);
      p.position.set(Math.cos(a) * r, h * 0.42, Math.sin(a) * r);
      p.lookAt(0, h * 0.42, 0);
      group.add(p);
    }
    // 贴地一层雾：水平大片，抬头看是雾墙，低头看是地气
    var groundMat = new THREE.MeshBasicMaterial({
      map: mist, color: cfg.fog, transparent: true, opacity: 0.30,
      depthWrite: false, side: THREE.DoubleSide, fog: false
    });
    for (var j = 0; j < 3; j++) {
      var gm = new THREE.Mesh(new THREE.PlaneGeometry(52, 52), groundMat);
      gm.rotation.x = -Math.PI / 2;
      gm.position.y = 0.55 + j * 0.9;
      group.add(gm);
    }
  }

  /* 湿反光：一层加法贴片盖在台面上，条状高光 = 潮气，不做真反射 */
  function wetSheen(kind, cfg, group, R) {
    var m = new THREE.Mesh(
      new THREE.CircleGeometry(R - 0.3, 64),
      new THREE.MeshBasicMaterial({
        map: tex('streak', streakTex), color: 0x6f9fb4, transparent: true,
        opacity: cfg.wet * 0.05, blending: THREE.AdditiveBlending,
        depthWrite: false, fog: true
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.035;
    group.add(m);
    return m;
  }

  /* 火盆：石座 + 铜盆 + 火苗贴片 + 一盏暖橙点光（每场 4 盏，是画面里唯一暖源） */
  function braziers(kind, cfg, group) {
    var stoneMat = new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: 0.55, metalness: 0.35 });
    var bowlMat = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.4, metalness: 0.7 });
    var fireMat = new THREE.SpriteMaterial({
      map: tex('ember', emberTex), color: 0xff8a3c, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    state.braziers = [];
    var n = cfg.braziers;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU + (kind === 'dungeon' ? 0.6 : 0.22);
      var r = cfg.brazierR;
      var x = Math.cos(a) * r, z = Math.sin(a) * r;
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, cfg.brazierH, 8), stoneMat);
      post.position.set(x, cfg.brazierH / 2, z);
      group.add(post);
      var bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.24, 0.34, 10), bowlMat);
      bowl.position.set(x, cfg.brazierH + 0.17, z);
      group.add(bowl);

      var fire = new THREE.Sprite(fireMat);
      fire.position.set(x, cfg.brazierH + 0.52, z);
      fire.scale.set(1.10, 2.00, 1);
      group.add(fire);

      var halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex('ember', emberTex), color: 0xff6a24, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.5
      }));
      halo.position.copy(fire.position);
      halo.scale.set(4.6, 4.6, 1);
      group.add(halo);

      // 地面光池：火盆脚下摊开一圈暖光，暗场里才有“灯是照在地上的”感觉
      var pool = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), new THREE.MeshBasicMaterial({
        map: tex('ember', emberTex), color: 0xff5e1e, transparent: true, opacity: 0.30,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: true
      }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.025, z);
      group.add(pool);

      var light = new THREE.PointLight(0xff6f2e, 1.05, 15, 2);
      light.__isBrazier = true;   // 火盆光不参与“彩色点光压暗”的清洗
      light.position.set(x, cfg.brazierH + 0.7, z);
      group.add(light);

      state.braziers.push({ fire: fire, halo: halo, light: light, base: cfg.brazierH + 0.52, ph: i * 1.7 });
    }
  }

  /* 冷光柱：用一摞加法柔光片叠出体积光，不用锥体
     锥体的直边在暗场里特别明显，会读成一块半透明三角形；换成沿方向排的柔光片就没有边 */
  function coldShafts(kind, cfg, group) {
    var glow = tex('mask', maskTex);
    var specs = kind === 'dungeon'
      ? [{ x: 0, y0: 8.6, y1: 1.6, r0: 0.6, r1: 3.8, n: 12 }]
      : [{ x: 0, y0: 12.0, y1: 2.0, r0: 0.7, r1: 4.6, n: 14 },
         { x: -6.4, y0: 9.0, y1: 1.2, r0: 0.5, r1: 2.4, n: 9, z: 4.8 }];
    for (var i = 0; i < specs.length; i++) {
      var s = specs[i];
      var mat = new THREE.SpriteMaterial({
        map: glow, color: 0x8fd0e0, transparent: true, opacity: 0.034 * cfg.shaft,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      });
      for (var k = 0; k < s.n; k++) {
        var f = k / (s.n - 1);                       // 0 = 顶部光源，1 = 落到地面
        var sp = new THREE.Sprite(mat);
        var yy = s.y0 + (s.y1 - s.y0) * f;
        // 横向按正弦错开，打散竖着的直边，否则一摞柔光片会读成一个三角形
        var wob = Math.sin(f * 5.2 + i) * 0.32 * (1 - f);
        sp.position.set((s.x || 0) + wob, yy, (s.z || 0) + wob * 0.6);
        var rad = (s.r0 + (s.r1 - s.r0) * Math.pow(f, 0.9)) * 2.2;
        sp.scale.set(rad, rad, 1);
        group.add(sp);
        state.shafts = state.shafts || [];
        state.shafts.push(sp);
      }
    }
  }

  /* 月：只在竞技场出现，冷白圆盘 + 大晕，给天穹一个可读的“光源” */
  function moonDisc(group, pos) {
    var core = new THREE.Mesh(new THREE.CircleGeometry(3.4, 32), new THREE.MeshBasicMaterial({
      map: tex('moon', moonTex), color: 0xdcf0fb, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    }));
    core.position.copy(pos);
    core.lookAt(0, 2, 0);
    group.add(core);
    var halo = core.clone();
    halo.material = new THREE.MeshBasicMaterial({
      map: tex('moon', moonTex), color: 0x9cc8dd, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false
    });
    halo.scale.setScalar(4.6);
    halo.position.copy(pos);
    halo.lookAt(0, 2, 0);
    group.add(halo);
  }

  /* 余烬：贴着地面的暖橙火星，缓慢上飘、绕场游走，是暗场里的“呼吸” */
  function embers(cfg, group) {
    var n = cfg.embers;
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(n * 3);
    var data = [];
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var r = 3 + Math.random() * 19;
      var y = 0.15 + Math.random() * 7.5;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * r;
      data.push({ a: a, r: r, y: y, rise: 0.10 + Math.random() * 0.42, spin: (Math.random() - 0.5) * 0.16 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      map: tex('ember', emberTex), color: 0xff9a52, size: 0.085,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      sizeAttenuation: true, opacity: 0.85, fog: true
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    group.add(pts);
    state.embers = pts;
    state.emberData = data;
  }

  function dimMaterials(root, k) {
    root.traverse(function (o) {
      if (!o.isMesh && !o.isPoints && !o.isSprite) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      for (var i = 0; i < mats.length; i++) {
        var m = mats[i];
        if (!m || m.userData.__dim) continue;
        m.userData.__dim = true;
        if (m.isMeshStandardMaterial) {
          m.color.multiplyScalar(k);
          if (m.emissive) m.emissive.multiplyScalar(k * 0.8);
          // 石面给一点潮气：粗糙度降、金属度略抬，湿石才会在冷光下出高光
          if (m.roughness !== undefined) m.roughness = Math.min(0.86, m.roughness * 0.55 + 0.10);
          if (m.metalness !== undefined) m.metalness = Math.min(0.42, m.metalness + 0.16);
        } else if (m.isMeshPhongMaterial) {
          m.color.multiplyScalar(k);
        } else if (m.isMeshBasicMaterial) {
          // 符阵、朱红帐幔这类自发光面片在白日还行，夜里必须一起压，否则一块块发灰白
          m.color.multiplyScalar(Math.min(1, k * 1.6));
          if (m.transparent && m.opacity !== undefined) m.opacity *= 0.62;
        }
      }
    });
  }

  function dress(scene, kind) {
    var cfg = LOOK[kind] || LOOK.arena;
    var old = scene.getObjectByName('nightDress');
    if (old) {
      old.parent.remove(old);
      old.traverse(function (o) {
        if (o.isMesh || o.isPoints) {
          if (o.geometry) o.geometry.dispose();
          var ms = Array.isArray(o.material) ? o.material : [o.material];
          for (var i = 0; i < ms.length; i++) if (ms[i]) ms[i].dispose();
        }
      });
    }
    var g = new THREE.Group();
    g.name = 'nightDress';
    scene.add(g);
    state.shafts = [];

    scene.background = new THREE.Color(cfg.bg);
    scene.fog = new THREE.Fog(cfg.fog, cfg.near, cfg.far);
    g.add(skyDome(kind, cfg));
    if (cfg.moon) moonDisc(g, new THREE.Vector3(-31, 22, -30));
    fogLayers(kind, cfg, g);
    wetSheen(kind, cfg, g, 22.3);
    braziers(kind, cfg, g);
    coldShafts(kind, cfg, g);
    embers(cfg, g);
    dimMaterials(scene.getObjectByName('scene_' + kind) || scene, cfg.dim);
    state.kind = kind;
    state.scene = scene;
    state.group = g;
  }

  function tick(dt) {
    state.t += dt || 0.016;
    var t = state.t;
    // 火苗：亮度呼吸 + 位置抖动，四盏不同相位
    for (var i = 0; i < state.braziers.length; i++) {
      var b = state.braziers[i];
      var f = 0.82 + Math.sin(t * 7.3 + b.ph) * 0.18 + Math.sin(t * 13.1 + b.ph * 2) * 0.08;
      b.fire.scale.set(0.66 + f * 0.10, 1.06 + f * 0.22, 1);
      b.fire.position.y = b.base + Math.sin(t * 5.1 + b.ph) * 0.05;
      b.halo.material.opacity = 0.34 + f * 0.20;
      b.light.intensity = 0.92 + f * 0.30;
    }
    if (state.shafts) {
      for (var s = 0; s < state.shafts.length; s++) {
        // 同一束光共用一份材质，一帧只写一次也够
        state.shafts[s].material.opacity = 0.042 + Math.sin(t * 0.9 + 0.4) * 0.010;
      }
    }
    // 火星上飘：升到顶就回到地面，周向缓慢绕行
    if (state.embers && state.emberData) {
      var arr = state.embers.geometry.attributes.position.array;
      var d = state.emberData;
      var maxY = 8.4;
      for (var k = 0; k < d.length; k++) {
        var p = d[k];
        p.y += p.rise * dt;
        p.a += p.spin * dt;
        if (p.y > maxY) { p.y = 0.1; p.r = 3 + Math.random() * 19; }
        arr[k * 3] = Math.cos(p.a) * p.r;
        arr[k * 3 + 1] = p.y;
        arr[k * 3 + 2] = Math.sin(p.a) * p.r;
      }
      state.embers.geometry.attributes.position.needsUpdate = true;
    }
  }

  /* ================= 3) 人物剪影化 ================= */
  var MASK_TEX = null;
  function maskSprite() {
    if (!MASK_TEX) MASK_TEX = tex('mask', maskTex);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: MASK_TEX, color: 0x9fe6f6, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.9
    }));
    return sp;
  }

  function silhouette(o, k) {
    if (!o || o.userData.__sil) return o;
    o.userData.__sil = true;
    var box = new THREE.Box3();
    try { box.setFromObject(o); } catch (e) { return o; }
    var h = Math.max(0.1, box.max.y - box.min.y);
    dimMaterials(o, k || 0.42);
    // 面罩光：贴在头部，Sprite 永远朝相机，第一人称下就是“那双眼”
    var sp = maskSprite();
    sp.material.opacity = 0.55;
    sp.position.set(0, box.max.y - h * 0.11, 0);
    sp.scale.set(h * 0.17, h * 0.10, 1);
    o.add(sp);
    // 脚下一点冷光余晖，避免整具人在暗场里完全贴黑
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex('mask', maskTex), color: 0x2f6e88, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.5
    }));
    glow.position.set(0, box.min.y + 0.12, 0);
    glow.scale.set(h * 0.55, h * 0.35, 1);
    o.add(glow);
    return o;
  }

  /* ================= 接线 ================= */
  var hooked = false;
  function hook() {
    if (hooked) return;
    hooked = true;

    if (window.ArenaScene) {
      var build0 = ArenaScene.build;
      ArenaScene.build = function (k, scene, obstacles) {
        var r = build0.apply(this, arguments);
        try { dress(scene, k); } catch (e) { console.warn('[night] dress failed', e); }
        tune(scene, k);
        return r;
      };
      var upd0 = ArenaScene.update;
      ArenaScene.update = function (dt) {
        var r = upd0.apply(this, arguments);
        tick(dt);
        return r;
      };
      var tune0 = ArenaScene.tuneLights;
      ArenaScene.tuneLights = function (scene) {
        // 先让 scene.js 自己按日场/地宫排一遍，再整体压到夜色，顺序不能反
        if (tune0) tune0.apply(this, arguments);
        tune(scene, kindOf());
      };
    }

    if (window.ArenaArt) {
      var bf = ArenaArt.buildFighter;
      if (bf) ArenaArt.buildFighter = function (type) {
        var o = bf.apply(this, arguments);
        try { silhouette(o, 0.62); } catch (e) { }
        return o;
      };
      var bh = ArenaArt.buildHero;
      if (bh) ArenaArt.buildHero = function (key) {
        var o = bh.apply(this, arguments);
        try { silhouette(o, 0.66); } catch (e) { }
        return o;
      };
    }
  }

  function kindOf() {
    return state.kind || (window.ArenaScene && ArenaScene.kind) || 'arena';
  }

  /* 灯光重排：半球压到 0.3，主光只留一道冷月光，补光给冷青，暖色全交给火盆 */
  function tune(scene, kind) {
    var cfg = LOOK[kind] || LOOK.arena;
    var dirs = 0;
    scene.traverse(function (o) {
      if (o.isHemisphereLight) {
        o.color.setHex(cfg.hemiSky);
        o.groundColor.setHex(cfg.hemiGround);
        o.intensity = cfg.hemi;
      }
      if (o.isDirectionalLight) {
        if (dirs === 0) {
          o.color.setHex(cfg.keyColor);
          o.intensity = cfg.key;
          o.position.set(-26, 26, -30);   // 从月亮方向打，影子朝场内
        } else {
          o.color.setHex(cfg.fillColor);
          o.intensity = cfg.fill;
        }
        dirs++;
      }
      // game.js 里四盏彩色点光是白日糖水，夜里只会污染冷调，压到很低
      if (o.isPointLight && !o.__isBrazier) {
        o.intensity = Math.min(o.intensity, 0.10);
      }
    });
  }

  // 立刻挂载：本文件排在 scene.js / art.js 之后、game.js 初始化之前，
  // 只有先接管 build/tune，首发场景才会走夜色
  hook();
  var tries = 0;
  var iv = setInterval(function () {
    if (hooked || ++tries > 60) clearInterval(iv);
    else hook();
  }, 50);

  window.ArenaNight = {
    GRADE: GRADE,
    LOOK: LOOK,
    redraw: function (scene, kind) { dress(scene, kind || kindOf()); },
    tick: tick,
    stats: function () {
      return { kind: state.kind, braziers: state.braziers.length, embers: state.emberData ? state.emberData.length : 0 };
    }
  };
})();
