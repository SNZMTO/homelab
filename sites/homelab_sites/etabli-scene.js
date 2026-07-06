/* =========================================================================
   <etabli-scene> — Établi 3D low-poly interactif (three.js)
   Menu de navigation du site homelab.

   - Survol : rebond springy + étiquette kraft à ficelle + cursor pointer
   - Clic   : window.dispatchEvent CustomEvent('etabli:navigate', {detail:{id,label}})
   - Attributs : show-labels="true|false"   parallax="true|false"   wood="#hex"
   ========================================================================= */
(function () {
  'use strict';
  if (customElements.get('etabli-scene')) return;

  var CDN = [
    'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.149.0/three.min.js',
    'https://unpkg.com/three@0.149.0/build/three.min.js'
  ];
  var threeP = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (threeP) return threeP;
    threeP = new Promise(function (resolve, reject) {
      var i = 0;
      (function next() {
        if (i >= CDN.length) { reject(new Error('three.js introuvable')); return; }
        var s = document.createElement('script');
        s.src = CDN[i++];
        s.onload = function () { window.THREE ? resolve(window.THREE) : next(); };
        s.onerror = function () { s.remove(); next(); };
        document.head.appendChild(s);
      })();
    });
    return threeP;
  }

  /* ---- palette ---- */
  var P = {
    bg: 0xF2EAD9,
    ink: '#53381F',
    paper: 0xFBF1DC,
    paperDim: 0xEFE3C4,
    coral: 0xDD6B50,
    coralDark: 0xC85A45,
    orange: 0xE8703A,
    orangeDark: 0xC95B28,
    orangeLite: 0xEE7E48,
    teal: 0x3E8E9C,
    tealDeep: 0x2F6F7A,
    sage: 0x8CA36F,
    mustard: 0xD9A441,
    brass: 0xC08F3C,
    darkwood: 0x8C5A2F,
    brown: 0x5B4224,
    grey: 0xA09585,
    greyDark: 0x6E675E,
    glass: 0xD8ECE4
  };

  var SECTIONS = [
    { id: 'homelab',      label: 'Le homelab',   color: '#3E8E9C' },
    { id: 'projet',       label: 'Le projet',    color: '#E2725B' },
    { id: 'architecture', label: 'Architecture', color: '#7F9C6B' },
    { id: 'stack',        label: 'La stack',     color: '#E8703A' },
    { id: 'monitoring',   label: 'Monitoring',   color: '#C89A42' },
    { id: 'journal',      label: 'Journal',      color: '#B5654D' },
    { id: 'glossaire',    label: 'Glossaire',    color: '#2F6F7A' },
    { id: 'contact',      label: 'Contact / CV', color: '#8C6A4F' }
  ];

  var TOP = 1.56; /* hauteur du plateau */

  /* ======================================================================= */
  var EtabliScene = /** @class */ (function () {
    function C() { return Reflect.construct(HTMLElement, [], C); }
    C.prototype = Object.create(HTMLElement.prototype);
    C.prototype.constructor = C;
    Object.setPrototypeOf(C, HTMLElement);

    C.observedAttributes = ['show-labels', 'parallax', 'wood'];

    C.prototype.attributeChangedCallback = function (n, _o, v) {
      if (n === 'show-labels') { this._showAll = (v === 'true'); if (this._applyShowAll) this._applyShowAll(); }
      if (n === 'parallax') this._parallax = (v !== 'false');
      if (n === 'wood' && v && /^#[0-9a-fA-F]{6}$/.test(v)) { this._wood = v; if (this._applyWood) this._applyWood(); }
    };

    C.prototype.connectedCallback = function () {
      if (this._init) return;
      this._init = true;
      this._showAll = this.getAttribute('show-labels') === 'true';
      this._parallax = this.getAttribute('parallax') !== 'false';
      this._wood = this.getAttribute('wood') || '#D08C42';
      this.style.cssText = 'display:block;width:100%;height:100%;position:relative;overflow:hidden;';
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', "Établi 3D : chaque objet posé dessus ouvre une section du site");
      var self = this;
      loadThree().then(function (T) { if (self.isConnected) self._build(T); })
        .catch(function () {
          self.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:600 15px Nunito,sans-serif;color:#8C6A4F;">La scène 3D n\u2019a pas pu charger — utilisez la navigation ci-dessous.</div>';
        });
    };

    C.prototype.disconnectedCallback = function () {
      if (this._raf) cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
      if (this._renderer) { this._renderer.dispose(); }
      if (this._onVis) document.removeEventListener('visibilitychange', this._onVis);
      this._init = false;
      this.innerHTML = '';
    };

    /* ==================================================================== */
    C.prototype._build = function (T) {
      var self = this;
      var reduceMotion = false;
      try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

      /* ---- renderer / scene / camera ---- */
      var renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';
      this.appendChild(renderer.domElement);
      this._renderer = renderer;

      var scene = new T.Scene();
      scene.background = new T.Color(P.bg);

      var BASE_LOOK = new T.Vector3(0, 1.02, 0);
      var LOOK = BASE_LOOK.clone();
      var camera = new T.PerspectiveCamera(33, 1, 0.1, 60);
      var camDir = new T.Vector3(0, 0.316, 0.949).normalize(); /* ~18° de plongée */
      var curDist = 7.6, fitDist = 7.6, baseDist = 7.6;

      /* ---- lumières ---- */
      scene.add(new T.HemisphereLight(0xFFF6E4, 0xD9B990, 0.46));
      var sun = new T.DirectionalLight(0xFFE9C4, 0.72);
      sun.position.set(-5.5, 9, 4.5);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.left = -4.6; sun.shadow.camera.right = 4.6;
      sun.shadow.camera.top = 4.5; sun.shadow.camera.bottom = -4.5;
      sun.shadow.camera.near = 2; sun.shadow.camera.far = 22;
      sun.shadow.normalBias = 0.05; sun.shadow.bias = -0.0004;
      scene.add(sun);
      var fill = new T.DirectionalLight(0xBFD8D2, 0.22);
      fill.position.set(4.5, 3, -3.5);
      scene.add(fill);

      /* ---- matériaux toon ---- */
      var grad = (function () {
        var steps = [112, 168, 216, 255];
        var data = new Uint8Array(steps.length * 4);
        for (var i = 0; i < steps.length; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = steps[i]; data[i * 4 + 3] = 255; }
        var tx = new T.DataTexture(data, steps.length, 1, T.RGBAFormat);
        tx.minFilter = T.LinearFilter; tx.magFilter = T.LinearFilter; tx.generateMipmaps = false;
        tx.needsUpdate = true;
        return tx;
      })();
      function mat(color, opts) {
        var o = Object.assign({}, opts || {});
        delete o.flatShading;
        return new T.MeshToonMaterial(Object.assign({ color: color, gradientMap: grad }, o));
      }

      /* ---- géométries utilitaires ---- */
      function roundedRect(w, d, r) {
        var s = new T.Shape(), x = -w / 2, y = -d / 2;
        r = Math.max(0.004, Math.min(r, w / 2 - 0.002, d / 2 - 0.002));
        s.moveTo(x + r, y);
        s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
        s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
        s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
        s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
        return s;
      }
      /* boîte arrondie : w(x) h(y) d(z), r rayon coins, centrée */
      function rbox(w, h, d, r, curve) {
        var b = Math.min(0.03, h * 0.28, r);
        var geo = new T.ExtrudeGeometry(roundedRect(w - 2 * b, d - 2 * b, r - b), {
          depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b,
          bevelSegments: 2, curveSegments: curve || 4
        });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, -(h - 2 * b) / 2, 0);
        return geo;
      }
      function mesh(geo, m, x, y, z) {
        var me = new T.Mesh(geo, m);
        if (x !== undefined) me.position.set(x, y, z);
        me.castShadow = true; me.receiveShadow = true;
        return me;
      }

      /* ---- sol : ombre portée + halo AO ---- */
      var groundSh = new T.Mesh(new T.PlaneGeometry(40, 26), new T.ShadowMaterial({ color: 0x6E4B26, opacity: 0.26 }));
      groundSh.rotation.x = -Math.PI / 2; groundSh.receiveShadow = true;
      scene.add(groundSh);
      (function () {
        var c = document.createElement('canvas'); c.width = c.height = 256;
        var g = c.getContext('2d');
        var rg = g.createRadialGradient(128, 128, 10, 128, 128, 126);
        rg.addColorStop(0, 'rgba(96,66,34,0.42)'); rg.addColorStop(1, 'rgba(96,66,34,0)');
        g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
        var tex = new T.CanvasTexture(c);
        var pl = new T.Mesh(new T.PlaneGeometry(8.2, 4.8), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        pl.rotation.x = -Math.PI / 2; pl.position.y = 0.006;
        scene.add(pl);
      })();

      /* ---- établi ---- */
      var woodMats = [];
      function woodMat(dl, ds) {
        var m = mat(0xffffff);
        woodMats.push({ m: m, dl: dl || 0, ds: ds || 0 });
        return m;
      }
      this._applyWood = function () {
        var base = new T.Color(self._wood);
        woodMats.forEach(function (e) { e.m.color.copy(base).offsetHSL(0, e.ds, e.dl); });
      };

      var bench = new T.Group();
      /* planches du plateau */
      var plankDL = [0, -0.045, 0.032, -0.02];
      for (var pi = 0; pi < 4; pi++) {
        var pk = mesh(rbox(5.0, 0.2, 0.6, 0.05), woodMat(plankDL[pi]), 0, 1.46, -0.96 + pi * 0.64);
        bench.add(pk);
      }
      /* ceinture + pieds + étagère */
      var apronM = woodMat(-0.09);
      bench.add(mesh(new T.BoxGeometry(4.6, 0.18, 0.14), apronM, 0, 1.27, 1.08));
      bench.add(mesh(new T.BoxGeometry(4.6, 0.18, 0.14), apronM, 0, 1.27, -1.08));
      bench.add(mesh(new T.BoxGeometry(0.14, 0.18, 2.14), apronM, 2.25, 1.27, 0));
      bench.add(mesh(new T.BoxGeometry(0.14, 0.18, 2.14), apronM, -2.25, 1.27, 0));
      var legM = woodMat(-0.07, -0.04);
      [[-2.1, -0.95], [2.1, -0.95], [-2.1, 0.95], [2.1, 0.95]].forEach(function (lp) {
        var leg = mesh(new T.CylinderGeometry(0.2, 0.155, 1.36, 4), legM, lp[0], 0.68, lp[1]);
        leg.rotation.y = Math.PI / 4;
        bench.add(leg);
      });
      var shelfM = woodMat(-0.02, -0.03);
      bench.add(mesh(rbox(4.3, 0.07, 1.9, 0.03), shelfM, 0, 0.5, 0));
      var strM = woodMat(-0.1);
      bench.add(mesh(new T.BoxGeometry(0.12, 0.14, 1.9), strM, 2.1, 0.42, 0));
      bench.add(mesh(new T.BoxGeometry(0.12, 0.14, 1.9), strM, -2.1, 0.42, 0));
      scene.add(bench);
      this._applyWood();

      /* =================== objets =================== */
      var registry = {};

      /* --- loupe --- */
      function buildLoupe() {
        var g = new T.Group();
        var ring = mesh(new T.TorusGeometry(0.24, 0.055, 8, 22), mat(P.brass), 0, 0.062, 0);
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
        g.add(mesh(new T.CylinderGeometry(0.2, 0.2, 0.03, 22), mat(P.glass, { transparent: true, opacity: 0.85, flatShading: false }), 0, 0.062, 0));
        var collar = mesh(new T.CylinderGeometry(0.06, 0.06, 0.1, 8), mat(P.brass), 0.33, 0.058, 0);
        collar.rotation.z = Math.PI / 2;
        g.add(collar);
        var handle = mesh(new T.CapsuleGeometry(0.048, 0.34, 3, 8), mat(P.darkwood), 0.56, 0.055, 0);
        handle.rotation.z = Math.PI / 2;
        g.add(handle);
        return { g: g, top: 0.14, hit: [1.15, 0.42, 0.72], hc: [0.22, 0.16, 0] };
      }

      /* --- carnet --- */
      function buildCarnet() {
        var g = new T.Group();
        g.add(mesh(rbox(0.62, 0.03, 0.85, 0.08), mat(P.coralDark), 0, 0.015, 0));
        g.add(mesh(rbox(0.585, 0.07, 0.815, 0.06), mat(P.paperDim), 0, 0.065, 0));
        g.add(mesh(rbox(0.62, 0.05, 0.85, 0.08), mat(P.coral), 0, 0.125, 0));
        g.add(mesh(new T.BoxGeometry(0.035, 0.014, 0.855), mat(0x7E4433), 0.185, 0.152, 0));
        return { g: g, top: 0.19, hit: [0.9, 0.44, 1.1], hc: [0, 0.16, 0] };
      }

      /* --- carte topographique --- */
      function mapTexture() {
        var c = document.createElement('canvas'); c.width = 1024; c.height = 704;
        var g = c.getContext('2d');
        g.fillStyle = '#F1E4BE'; g.fillRect(0, 0, 1024, 704);
        g.strokeStyle = '#B8945C'; g.lineWidth = 4; g.strokeRect(30, 30, 964, 644);
        g.lineWidth = 2; g.strokeRect(42, 42, 940, 620);
        function blob(cx, cy, r, seed, col, lw) {
          g.beginPath();
          for (var i = 0; i <= 26; i++) {
            var a = (i / 26) * Math.PI * 2;
            var rr = r * (1 + 0.11 * Math.sin(3 * a + seed) + 0.05 * Math.sin(7 * a + seed * 2));
            var x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.82;
            i ? g.lineTo(x, y) : g.moveTo(x, y);
          }
          g.closePath(); g.strokeStyle = col; g.lineWidth = lw; g.stroke();
        }
        blob(330, 300, 70, 1.2, '#5E7C45', 7); blob(330, 300, 120, 1.7, '#6E8A54', 6);
        blob(330, 300, 172, 2.3, '#7F9C6B', 5.5); blob(330, 300, 226, 2.9, '#93A87E', 5);
        blob(700, 430, 58, 4.1, '#5E7C45', 7); blob(700, 430, 104, 4.8, '#6E8A54', 6);
        blob(700, 430, 152, 5.5, '#7F9C6B', 5.5);
        /* lac */
        g.strokeStyle = '#5F969B'; g.lineWidth = 4;
        for (var w = 0; w < 3; w++) {
          g.beginPath();
          for (var x2 = 90; x2 <= 260; x2 += 8) g.lineTo(x2, 590 + w * 16 + Math.sin(x2 / 18 + w) * 4);
          g.stroke();
        }
        /* itinéraire pointillé */
        g.strokeStyle = '#C14F35'; g.lineWidth = 8; g.setLineDash([18, 14]); g.lineCap = 'round';
        g.beginPath(); g.moveTo(150, 600);
        g.quadraticCurveTo(340, 520, 470, 420);
        g.quadraticCurveTo(600, 320, 690, 260);
        g.quadraticCurveTo(760, 215, 800, 170);
        g.stroke(); g.setLineDash([]);
        g.fillStyle = '#C14F35'; g.beginPath(); g.arc(150, 600, 12, 0, 7); g.fill();
        g.strokeStyle = '#B04430'; g.lineWidth = 11;
        g.beginPath(); g.moveTo(788, 152); g.lineTo(822, 190); g.moveTo(822, 152); g.lineTo(788, 190); g.stroke();
        /* montagnes */
        g.strokeStyle = '#71583B'; g.lineWidth = 5; g.lineJoin = 'round';
        [[190, 160], [250, 130], [310, 170]].forEach(function (m2) {
          g.beginPath(); g.moveTo(m2[0] - 26, m2[1] + 18); g.lineTo(m2[0], m2[1] - 18); g.lineTo(m2[0] + 26, m2[1] + 18); g.stroke();
        });
        /* boussole */
        g.strokeStyle = '#B8945C'; g.lineWidth = 5;
        g.beginPath(); g.arc(886, 120, 34, 0, 7); g.stroke();
        g.fillStyle = '#C14F35'; g.beginPath(); g.moveTo(886, 92); g.lineTo(896, 120); g.lineTo(876, 120); g.closePath(); g.fill();
        g.fillStyle = '#5B4224'; g.beginPath(); g.moveTo(886, 148); g.lineTo(896, 120); g.lineTo(876, 120); g.closePath(); g.fill();
        /* plis */
        g.fillStyle = 'rgba(90,60,20,0.1)';
        for (var f = 1; f < 6; f++) g.fillRect(f * (1024 / 6) - 3, 0, 6, 704);
        var tex2 = new T.CanvasTexture(c);
        tex2.anisotropy = 8;
        return tex2;
      }
      function buildCarte() {
        var g = new T.Group();
        var geo = new T.PlaneGeometry(1.85, 1.28, 6, 2);
        geo.rotateX(-Math.PI / 2);
        var pos = geo.attributes.position;
        var amp = [0.012, 0.06, 0.015, 0.065, 0.012, 0.058, 0.018];
        for (var i = 0; i < pos.count; i++) {
          var x = pos.getX(i), z = pos.getZ(i);
          var col = Math.round((x / 1.85 + 0.5) * 6);
          var y = amp[Math.max(0, Math.min(6, col))];
          if (x > 0 && z > 0) y += 0.05 * Math.pow((x / 0.925) * (z / 0.64), 2);
          pos.setY(i, y);
        }
        geo.computeVertexNormals();
        var mm = mat(0xffffff, { map: mapTexture(), side: T.DoubleSide });
        var plane = mesh(geo, mm, 0, 0.004, 0);
        g.add(plane);
        /* petit fanion sur le X */
        var pin = new T.Group();
        pin.add(mesh(new T.CylinderGeometry(0.008, 0.008, 0.13, 6), mat(P.brown), 0, 0.065, 0));
        var flag = mesh(new T.BoxGeometry(0.1, 0.055, 0.008), mat(P.coral), 0.05, 0.115, 0);
        pin.add(flag);
        pin.position.set(0.52, 0.055, -0.32);
        g.add(pin);
        registry.flag = flag;
        return { g: g, top: 0.24, hit: [2.0, 0.4, 1.42], hc: [0, 0.1, 0] };
      }

      /* --- boîte à outils --- */
      function buildToolbox() {
        var g = new T.Group();
        var baseH = 0.4;
        g.add(mesh(rbox(1.15, baseH, 0.62, 0.07), mat(P.orange), 0, baseH / 2, 0));
        g.add(mesh(new T.BoxGeometry(1.02, 0.025, 0.5), mat(0x6B3316), 0, baseH + 0.002, 0));
        /* nervures + loquets */
        [-0.42, 0.42].forEach(function (rx) {
          g.add(mesh(new T.BoxGeometry(0.06, 0.3, 0.024), mat(P.orangeDark), rx, 0.2, 0.312));
        });
        [-0.3, 0.3].forEach(function (lx) {
          g.add(mesh(new T.BoxGeometry(0.09, 0.08, 0.035), mat(P.mustard), lx, baseH - 0.07, 0.315));
        });
        /* couvercle entrouvert (charnière arrière) */
        var lid = new T.Group();
        lid.position.set(0, baseH, -0.29);
        var lidMesh = mesh(rbox(1.15, 0.13, 0.62, 0.07), mat(P.orangeLite), 0, 0.065, 0.29);
        lid.add(lidMesh);
        [-0.42, 0.42].forEach(function (rx) {
          lid.add(mesh(new T.BoxGeometry(0.06, 0.026, 0.58), mat(P.orangeDark), rx, 0.14, 0.29));
        });
        var arch = mesh(new T.TorusGeometry(0.12, 0.028, 8, 14, Math.PI), mat(P.brown), 0, 0.14, 0.29);
        arch.scale.set(1, 0.72, 1);
        lid.add(arch);
        lid.rotation.x = -0.55;
        g.add(lid);
        /* outils qui dépassent */
        var sd = new T.Group();
        sd.add(mesh(new T.CylinderGeometry(0.013, 0.013, 0.24, 7), mat(P.grey), 0, 0.12, 0));
        sd.add(mesh(new T.CapsuleGeometry(0.04, 0.15, 3, 8), mat(P.teal), 0, 0.33, 0));
        sd.position.set(0.27, 0.26, 0.08); sd.rotation.set(0.5, 0, -0.14);
        g.add(sd);
        var hm = new T.Group();
        hm.add(mesh(new T.CylinderGeometry(0.03, 0.034, 0.42, 7), mat(P.darkwood), 0, 0.21, 0));
        hm.add(mesh(rbox(0.17, 0.075, 0.075, 0.02), mat(P.greyDark), 0, 0.44, 0));
        hm.position.set(-0.26, 0.26, 0.02); hm.rotation.set(0.42, 0.15, 0.42);
        g.add(hm);
        /* clé plate posée devant */
        var wr = new T.Group();
        wr.add(mesh(new T.BoxGeometry(0.3, 0.024, 0.06), mat(P.grey), 0, 0.012, 0));
        var jaw = mesh(new T.TorusGeometry(0.05, 0.022, 6, 12, 4.4), mat(P.grey), 0.17, 0.014, 0);
        jaw.rotation.x = -Math.PI / 2; jaw.rotation.z = 0.5;
        wr.add(jaw);
        wr.position.set(-0.7, 0, 0.5); wr.rotation.y = 0.5;
        g.add(wr);
        return { g: g, top: 0.82, hit: [1.5, 1.05, 1.05], hc: [-0.08, 0.42, 0.08] };
      }

      /* --- manomètre --- */
      function buildGauge() {
        var g = new T.Group();
        g.add(mesh(rbox(0.2, 0.05, 0.15, 0.03), mat(0x9C7431), 0, 0.025, 0.01));
        var body = mesh(new T.CylinderGeometry(0.2, 0.2, 0.12, 18), mat(P.brass, { flatShading: false }), 0, 0.25, 0);
        body.rotation.x = Math.PI / 2;
        g.add(body);
        var face = mesh(new T.CylinderGeometry(0.163, 0.163, 0.022, 18), mat(P.paper, { flatShading: false }), 0, 0.25, 0.058);
        face.rotation.x = Math.PI / 2;
        g.add(face);
        var rim = mesh(new T.TorusGeometry(0.172, 0.02, 8, 20), mat(P.brass, { flatShading: false }), 0, 0.25, 0.068);
        g.add(rim);
        var tickM = mat(P.brown);
        for (var i = 0; i <= 8; i++) {
          var a = (-210 + i * 30) * Math.PI / 180;
          var tk = mesh(new T.BoxGeometry(0.032, 0.011, 0.008), tickM, Math.cos(a) * 0.126, 0.25 + Math.sin(a) * 0.126, 0.072);
          tk.rotation.z = a;
          g.add(tk);
        }
        var needleGeo = new T.BoxGeometry(0.135, 0.016, 0.012);
        needleGeo.translate(0.05, 0, 0);
        var needle = mesh(needleGeo, mat(P.coralDark), 0, 0.25, 0.078);
        needle.rotation.z = 0.6;
        g.add(needle);
        registry.needle = needle;
        var cap = mesh(new T.CylinderGeometry(0.022, 0.022, 0.016, 10), mat(0x9C7431), 0, 0.25, 0.084);
        cap.rotation.x = Math.PI / 2;
        g.add(cap);
        g.rotation.x = -0.12;
        return { g: g, top: 0.5, hit: [0.62, 0.66, 0.62], hc: [0, 0.26, 0] };
      }

      /* --- calendrier chevalet --- */
      function calTexture() {
        var c = document.createElement('canvas'); c.width = 320; c.height = 240;
        var g = c.getContext('2d');
        g.fillStyle = '#FBF3E0'; g.fillRect(0, 0, 320, 240);
        g.fillStyle = '#3E8E9C'; g.fillRect(0, 0, 320, 52);
        g.fillStyle = '#FBF3E0';
        g.beginPath(); g.arc(96, 26, 7, 0, 7); g.arc(224, 26, 7, 0, 7); g.fill();
        function rr(x, y, w, h, r) {
          g.beginPath();
          g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
          g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
          g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
          g.closePath();
        }
        for (var row = 0; row < 4; row++) {
          for (var col = 0; col < 7; col++) {
            g.fillStyle = (row === 1 && col === 3) ? '#D95E44' : '#DCC69B';
            rr(14 + col * 42.5, 68 + row * 42, 32, 30, 7);
            g.fill();
          }
        }
        return new T.CanvasTexture(c);
      }
      function buildCalendar() {
        var g = new T.Group();
        var apex = 0.44;
        var front = new T.Group(); front.position.y = apex;
        var fp = mesh(rbox(0.6, 0.46, 0.035, 0.02), mat(P.paperDim), 0, -0.23, 0);
        front.add(fp);
        var pageGeo = new T.PlaneGeometry(0.55, 0.4);
        pageGeo.translate(0, -0.2, 0);
        var page = mesh(pageGeo, mat(0xffffff, { map: calTexture() }), 0, -0.012, 0.042);
        page.castShadow = false;
        front.add(page);
        registry.calPage = page;
        front.rotation.x = -0.3;
        g.add(front);
        var back = new T.Group(); back.position.y = apex;
        back.add(mesh(rbox(0.6, 0.46, 0.035, 0.02), mat(0xE4D5B4), 0, -0.23, 0));
        back.rotation.x = 0.3;
        g.add(back);
        var ringM = mat(0x8A7458);
        for (var i = -2.5; i <= 2.5; i++) {
          var ring = mesh(new T.TorusGeometry(0.027, 0.0075, 6, 12), ringM, i * 0.085, apex + 0.004, 0);
          ring.rotation.y = Math.PI / 2;
          ring.castShadow = false;
          g.add(ring);
        }
        return { g: g, top: 0.52, hit: [0.85, 0.8, 0.7], hc: [0, 0.3, 0] };
      }

      /* --- dictionnaire --- */
      function buildDico() {
        var g = new T.Group();
        var coverM = mat(P.tealDeep);
        g.add(mesh(rbox(0.95, 0.035, 0.66, 0.03), coverM, 0, 0.018, 0));
        g.add(mesh(rbox(0.88, 0.24, 0.6, 0.02), mat(P.paperDim), 0.025, 0.155, 0));
        g.add(mesh(rbox(0.95, 0.035, 0.66, 0.03), coverM, 0, 0.293, 0));
        var spine = mesh(new T.CylinderGeometry(0.155, 0.155, 0.65, 10, 1, false, 0, Math.PI), coverM, -0.475, 0.155, 0);
        spine.rotation.x = Math.PI / 2; spine.rotation.z = Math.PI;
        g.add(spine);
        var label = mesh(new T.PlaneGeometry(0.42, 0.24), mat(0xF2E7CA, { flatShading: false }), 0.04, 0.3115, 0);
        label.rotation.x = -Math.PI / 2;
        label.castShadow = false;
        g.add(label);
        g.add(mesh(new T.BoxGeometry(0.26, 0.006, 0.03), mat(P.tealDeep), 0.04, 0.3135, -0.03));
        g.add(mesh(new T.BoxGeometry(0.17, 0.006, 0.02), mat(0xC9B891), 0.04, 0.3135, 0.035));
        var bm = mesh(new T.BoxGeometry(0.055, 0.008, 0.2), mat(P.mustard), 0.18, 0.045, 0.42);
        bm.rotation.y = 0.12;
        g.add(bm);
        return { g: g, top: 0.38, hit: [1.2, 0.62, 0.85], hc: [0, 0.22, 0.03] };
      }

      /* --- carte de visite --- */
      function buildCard() {
        var g = new T.Group();
        var under = mesh(rbox(0.5, 0.012, 0.29, 0.025), mat(0xF3E8CF), 0.04, 0.006, 0.015);
        under.rotation.y = 0.28;
        g.add(under);
        var top2 = new T.Group();
        top2.add(mesh(rbox(0.5, 0.013, 0.29, 0.025), mat(0xFDF4E0), 0, 0.019, 0));
        var chip = mesh(new T.CylinderGeometry(0.045, 0.045, 0.01, 14), mat(P.teal, { flatShading: false }), -0.14, 0.028, -0.02);
        top2.add(chip);
        top2.add(mesh(new T.BoxGeometry(0.2, 0.007, 0.024), mat(0xB9A98C), 0.08, 0.027, -0.045));
        top2.add(mesh(new T.BoxGeometry(0.15, 0.007, 0.02), mat(0xCfC0A0), 0.055, 0.027, 0.005));
        top2.add(mesh(new T.BoxGeometry(0.24, 0.007, 0.016), mat(0xCfC0A0), 0.075, 0.027, 0.075));
        g.add(top2);
        return { g: g, top: 0.06, hit: [0.75, 0.3, 0.55], hc: [0.02, 0.09, 0] };
      }

      /* ---- placement ---- */
      var LAYOUT = {
        homelab:      { build: buildLoupe,    pos: [-0.78, 0.92], rotY: -0.5 },
        projet:       { build: buildCarnet,   pos: [-1.6, 0.48], rotY: 0.16 },
        architecture: { build: buildCarte,    pos: [-0.45, -0.5], rotY: 0.1 },
        stack:        { build: buildToolbox,  pos: [1.72, -0.52], rotY: -0.22 },
        monitoring:   { build: buildGauge,    pos: [0.3, 0.68],  rotY: -0.14 },
        journal:      { build: buildCalendar, pos: [-2.02, -0.6], rotY: 0.32 },
        glossaire:    { build: buildDico,     pos: [1.75, 0.55],  rotY: 0.14 },
        contact:      { build: buildCard,     pos: [1.0, 1.06],   rotY: 0.3 }
      };

      var objs = [];
      var hitMeshes = [];
      var hitM = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      SECTIONS.forEach(function (sec) {
        var cfg = LAYOUT[sec.id];
        var built = cfg.build();
        var group = built.g;
        group.position.set(cfg.pos[0], TOP, cfg.pos[1]);
        group.rotation.y = cfg.rotY;
        scene.add(group);
        var hit = new T.Mesh(new T.BoxGeometry(built.hit[0], built.hit[1], built.hit[2]), hitM);
        hit.position.set(cfg.pos[0] + built.hc[0], TOP + built.hc[1], cfg.pos[1] + built.hc[2]);
        hit.userData.sectionId = sec.id;
        scene.add(hit);
        hitMeshes.push(hit);
        objs.push({
          sec: sec, group: group, baseY: TOP, topY: built.top, hitDims: built.hit,
          y: 0, vy: 0, s: 1, vs: 0, hovered: false
        });
      });
      var objById = {};
      objs.forEach(function (o) { objById[o.sec.id] = o; });

      /* ---- étiquettes kraft ---- */
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3;';
      this.appendChild(overlay);
      var FONT = '500 15px "Fredoka","Nunito",sans-serif';
      objs.forEach(function (o) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'position:absolute;left:0;top:0;opacity:0;transition:opacity .14s ease;will-change:transform;';
        var string = document.createElement('div');
        string.style.cssText = 'position:absolute;left:-0.75px;top:-15px;width:1.5px;height:15px;background:#A8834F;';
        var tag = document.createElement('div');
        tag.style.cssText = 'position:absolute;left:0;bottom:15px;transform:translateX(-50%) rotate(-2.5deg);transform-origin:50% 100%;' +
          'background:#EBD3A7;border:1.5px solid rgba(122,88,46,.42);border-radius:9px;padding:7px 14px 8px 26px;' +
          'font:' + FONT + ';color:' + P.ink + ';white-space:nowrap;box-shadow:0 4px 10px rgba(90,60,20,.2);';
        var hole = document.createElement('div');
        hole.style.cssText = 'position:absolute;left:9px;top:50%;transform:translateY(-50%);width:7px;height:7px;border-radius:50%;background:#F2EAD9;box-shadow:inset 0 0 0 1.5px #A8834F;';
        tag.appendChild(hole);
        tag.appendChild(document.createTextNode(o.sec.label));
        wrap.appendChild(string);
        wrap.appendChild(tag);
        overlay.appendChild(wrap);
        o.tagEl = wrap; o.tagInner = tag; o.tagShown = false;
      });
      function showTag(o) {
        if (o.tagShown) return;
        o.tagShown = true;
        o.tagEl.style.opacity = '1';
        if (o.tagInner.animate) o.tagInner.animate([
          { transform: 'translateX(-50%) translateY(10px) rotate(-9deg) scale(.85)', opacity: 0 },
          { transform: 'translateX(-50%) translateY(0) rotate(-2.5deg) scale(1)', opacity: 1 }
        ], { duration: 320, easing: 'cubic-bezier(.3,1.6,.5,1)' });
      }
      function hideTag(o) {
        if (!o.tagShown) return;
        o.tagShown = false;
        o.tagEl.style.opacity = '0';
      }

      /* ---- interactions ---- */
      var ray = new T.Raycaster();
      var ndc = new T.Vector2(-10, -10);
      var mouseN = { x: 0, y: 0 };
      var hovered = null;
      var canvas = renderer.domElement;

      function pick(clientX, clientY) {
        var r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
        ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
        mouseN.x = ndc.x; mouseN.y = ndc.y;
        ray.setFromCamera(ndc, camera);
        var hits = ray.intersectObjects(hitMeshes, false);
        return hits.length ? objById[hits[0].object.userData.sectionId] : null;
      }
      function setHover(o) {
        if (hovered === o) return;
        if (hovered) { hovered.hovered = false; if (!self._showAll) hideTag(hovered); }
        hovered = o;
        if (o) {
          o.hovered = true;
          o.vy += 2.4; /* impulsion rebond */
          showTag(o);
          canvas.style.cursor = 'pointer';
        } else {
          canvas.style.cursor = 'default';
        }
      }
      canvas.addEventListener('pointermove', function (e) {
        if (self._focused) return;
        if (e.pointerType === 'touch') return;
        setHover(pick(e.clientX, e.clientY));
      });
      canvas.addEventListener('pointerleave', function () { setHover(null); mouseN.x = 0; mouseN.y = 0; });
      canvas.addEventListener('click', function (e) {
        if (self._focused) return;
        var o = pick(e.clientX, e.clientY);
        if (!o) return;
        o.vy += 2.0;
        showTag(o);
        if (!self._showAll && hovered !== o) setTimeout(function () { if (hovered !== o) hideTag(o); }, 1400);
        window.dispatchEvent(new CustomEvent('etabli:navigate', { detail: { id: o.sec.id, label: o.sec.label } }));
      });

      /* ---- caméra responsive ---- */
      function fit() {
        var w = self.clientWidth, h = self.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        var need = 3.05 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
        fitDist = Math.max(baseDist, need);
        if (!self._focused && !self._camAnim) curDist = fitDist;
        camera.updateProjectionMatrix();
      }
      this._ro = new ResizeObserver(fit);
      this._ro.observe(this);
      fit();

      /* ---- boucle ---- */
      var last = performance.now();
      var par = { x: 0, y: 0 };
      var tmpV = new T.Vector3();
      var running = true;
      self._paused = false;
      function setRunning() {
        var want = !document.hidden && !self._paused;
        if (want && !running) { running = true; last = performance.now(); self._raf = requestAnimationFrame(tick); }
        else if (!want) { running = false; }
      }
      this._setRunning = setRunning;
      this._onVis = setRunning;
      document.addEventListener('visibilitychange', this._onVis);

      var K = 120, DAMP = 9.5, KS = 150, DAMPS = 11;
      function tick(now) {
        if (!running) return;
        self._raf = requestAnimationFrame(tick);
        var dt = Math.min(0.033, Math.max(0.001, (now - last) / 1000));
        last = now;
        var t = now / 1000;

        /* animation caméra (zoom section / retour) */
        if (self._camAnim) {
          var A = self._camAnim;
          A.t += dt / A.dur;
          var k = A.t >= 1 ? 1 : (A.t < 0.5 ? 4 * A.t * A.t * A.t : 1 - Math.pow(-2 * A.t + 2, 3) / 2);
          LOOK.lerpVectors(A.fromLook, A.toLook, k);
          curDist = A.fromDist + (A.toDist - A.fromDist) * k;
          if (A.t >= 1) {
            self._camAnim = null;
            if (A.onDone) A.onDone();
          }
        }

        for (var i = 0; i < objs.length; i++) {
          var o = objs[i];
          var target = o.hovered ? 0.05 : 0;
          o.vy += (-K * (o.y - target) - DAMP * o.vy) * dt;
          o.y += o.vy * dt;
          var st = o.hovered ? 1.05 : 1;
          o.vs += (-KS * (o.s - st) - DAMPS * o.vs) * dt;
          o.s += o.vs * dt;
          o.group.position.y = o.baseY + o.y;
          o.group.scale.setScalar(o.s);
        }

        /* micro-animations idle */
        var idleAmp = reduceMotion ? 0.3 : 1;
        if (registry.needle) registry.needle.rotation.z = 0.55 + (Math.sin(t * 1.7) * 0.07 + Math.sin(t * 9.3) * 0.022) * idleAmp;
        if (registry.calPage) registry.calPage.rotation.x = (Math.sin(t * 1.2) * 0.03 + Math.sin(t * 4.7) * 0.01) * idleAmp;
        if (registry.flag) registry.flag.rotation.y = Math.sin(t * 2.1) * 0.1 * idleAmp;

        /* caméra + parallaxe */
        var wantX = (self._parallax && !reduceMotion && !self._focused) ? mouseN.x : 0;
        var wantY = (self._parallax && !reduceMotion && !self._focused) ? mouseN.y : 0;
        par.x += (wantX - par.x) * 0.05;
        par.y += (wantY - par.y) * 0.05;
        tmpV.copy(camDir).multiplyScalar(curDist).add(LOOK);
        camera.position.set(tmpV.x + par.x * 0.3, tmpV.y + par.y * 0.14, tmpV.z);
        camera.lookAt(LOOK);

        /* étiquettes */
        var r = canvas.getBoundingClientRect();
        for (var j = 0; j < objs.length; j++) {
          var ob = objs[j];
          if (self._showAll && !ob.tagShown) showTag(ob);
          if (ob.tagShown) {
            tmpV.set(ob.group.position.x, ob.baseY + ob.y + ob.topY + 0.12, ob.group.position.z);
            tmpV.project(camera);
            var sx = (tmpV.x * 0.5 + 0.5) * r.width;
            var sy = (-tmpV.y * 0.5 + 0.5) * r.height;
            ob.tagEl.style.transform = 'translate3d(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px,0)';
          }
        }

        renderer.render(scene, camera);
      }
      this._raf = requestAnimationFrame(tick);

      /* ---- API pour la page : zoom vers un objet, retour, pause ---- */
      this.focusSection = function (id) {
        var o = objById[id];
        if (!o) return;
        setHover(null);
        objs.forEach(hideTag);
        self._focused = true;
        canvas.style.cursor = 'default';
        var dist = Math.max(2.2, 1.35 + Math.max(o.hitDims[0], o.hitDims[2]) * 1.25);
        var target = new T.Vector3(o.group.position.x, TOP + o.topY * 0.5 + 0.05, o.group.position.z);
        self._camAnim = {
          t: 0, dur: 0.65,
          fromLook: LOOK.clone(), toLook: target,
          fromDist: curDist, toDist: dist,
          onDone: function () {
            window.dispatchEvent(new CustomEvent('etabli:focused', { detail: { id: id } }));
          }
        };
      };
      this.resetView = function () {
        self._camAnim = {
          t: 0, dur: 0.6,
          fromLook: LOOK.clone(), toLook: BASE_LOOK.clone(),
          fromDist: curDist, toDist: fitDist,
          onDone: function () {
            self._focused = false;
            if (self._applyShowAll) self._applyShowAll();
          }
        };
      };
      this.pause = function () { self._paused = true; setRunning(); };
      this.resume = function () { self._paused = false; setRunning(); };

      /* état initial / bascule des étiquettes */
      this._applyShowAll = function () {
        objs.forEach(function (o) {
          if (self._showAll) showTag(o);
          else if (!o.hovered) hideTag(o);
        });
      };
      if (this._showAll) this._applyShowAll();
    };

    return C;
  })();

  customElements.define('etabli-scene', EtabliScene);
})();
