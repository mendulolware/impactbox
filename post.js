import * as THREE from 'three';

// The picture is not drawn straight to the screen. It goes to an off-screen HDR image first,
// then through three effects that do most of the work of making it look photographed:
//   ambient occlusion - soft darkening in creases and where things meet the ground
//   bloom             - bright things (sun, fire, muzzle flash) glow into their surroundings
//   grade             - contrast, a slight vignette, and the bodycam look (bent lens, colour fringes, blocked-out faces)
// Everything here is self-contained shader code; nothing is loaded from outside.

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const AO_FRAG = `
  uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uProjInv; varying vec2 vUv;
  vec3 viewPos(vec2 uv) {
    float d = textureLod(tDepth, uv, 0.0).x;   // explicit level: this is sampled inside a loop
    vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return v.xyz / v.w;
  }
  void main() {
    vec3 p = viewPos(vUv);
    if (-p.z > 90.0) { gl_FragColor = vec4(1.0); return; }      // sky and far distance: nothing to do
    vec3 n = normalize(cross(dFdx(p), dFdy(p)));                 // surface direction, from the depth itself
    vec3 t = normalize(cross(n, vec3(0.13, 1.0, 0.07)));
    vec3 b = cross(n, t);
    // a 4x4 repeating twist of the sample pattern; the final pass blurs exactly that away
    float twist = (mod(gl_FragCoord.x, 4.0) * 4.0 + mod(gl_FragCoord.y, 4.0)) * 0.3927;
    float radius = clamp(0.38 + -p.z * 0.02, 0.38, 1.2);
    float occ = 0.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float a = twist + fi * 2.39996;
      float r = sqrt((fi + 0.5) / 12.0);
      vec3 s = p + (t * cos(a) * r + b * sin(a) * r + n * (0.12 + 0.75 * (1.0 - r))) * radius;
      vec4 c = uProj * vec4(s, 1.0);
      vec2 suv = c.xy / c.w * 0.5 + 0.5;
      float sz = viewPos(suv).z;
      float inRange = smoothstep(0.0, 1.0, radius / (abs(p.z - sz) + 1e-4));
      occ += step(s.z + 0.03, sz) * inRange;
    }
    gl_FragColor = vec4(vec3(1.0 - occ / 12.0), 1.0);
  }`;

const BRIGHT_FRAG = `
  uniform sampler2D tScene; varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tScene, vUv).rgb;
    float m = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c * smoothstep(0.92, 1.6, m), 1.0);
  }`;

const BLUR_FRAG = `
  uniform sampler2D tSrc; uniform vec2 uStep; varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
    c += (texture2D(tSrc, vUv + uStep * 1.385).rgb + texture2D(tSrc, vUv - uStep * 1.385).rgb) * 0.316;
    c += (texture2D(tSrc, vUv + uStep * 3.231).rgb + texture2D(tSrc, vUv - uStep * 3.231).rgb) * 0.070;
    gl_FragColor = vec4(c, 1.0);
  }`;

// Bodycam auto exposure: the log-average brightness of the middle of the picture, eased toward over time
// (it lives in a 1x1 target and is mixed with last frame's), so walking from shade into sun blows out first.
const EXP_FRAG = `
  uniform sampler2D tScene; uniform sampler2D tPrev; uniform float uRate; varying vec2 vUv;
  void main() {
    float s = 0.0;
    for (int x = 0; x < 8; x++) for (int y = 0; y < 8; y++) {
      vec3 c = textureLod(tScene, 0.2 + (vec2(float(x), float(y)) + 0.5) / 8.0 * 0.6, 0.0).rgb;
      s += log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
    }
    float now = exp(s / 64.0), was = texture2D(tPrev, vec2(0.5)).r;
    gl_FragColor = vec4(was <= 0.0 ? now : mix(was, now, uRate), 0.0, 0.0, 1.0);
  }`;

const FINAL_FRAG = `
  uniform sampler2D tScene; uniform sampler2D tAO; uniform sampler2D tBloom;
  uniform vec2 uAoTexel; uniform float uHelmet; uniform float uAspect; uniform float uSupp; uniform vec3 uFaces[8]; uniform vec2 uBlur; uniform vec2 uTexel; uniform float uTime; uniform sampler2D tExp; uniform float uKey; uniform float uFlash; varying vec2 vUv;
  void main() {
    // bodycam lens: the middle of the picture is magnified and the edges squeezed in (corners stay put)
    vec2 lc = vUv * 2.0 - 1.0;
    float bend = 0.3 * uHelmet;
    vec2 uv = 0.5 + 0.5 * lc * (1.0 + bend * dot(lc, lc)) / (1.0 + bend * 2.0);
    uv.x += uBlur.x * (uv.y - 0.5) * 1.6 * uHelmet;            // rolling shutter: lines read top to bottom, so a fast turn leans the picture
    // faces are blocked out the way released footage is. uFaces: where on the picture, and how big (0 = unused)
    for (int i = 0; i < 8; i++) {
      vec3 f = uFaces[i];
      vec2 d = (uv - f.xy) * vec2(uAspect, 1.0);
      if (f.z > 0.0 && dot(d, d) < f.z * f.z) {
        vec2 cell = vec2(f.z / uAspect, f.z) * 0.3;
        uv = f.xy + (floor((uv - f.xy) / cell) + 0.5) * cell;
      }
    }
    vec2 fringe = lc * dot(lc, lc) * 0.0035 * uHelmet;      // a cheap lens splits colours toward the edges
    vec3 col = vec3(texture2D(tScene, uv + fringe).r, texture2D(tScene, uv).g, texture2D(tScene, uv - fringe).b);
    if (uHelmet > 0.5) {
      // a slow shutter smears the picture while the camera turns (uBlur: how far it slid this frame)
      if (dot(uBlur, uBlur) > 6e-7) {
        vec3 acc = col;
        for (int i = 1; i < 8; i++) acc += texture2D(tScene, uv + uBlur * (float(i) / 7.0 - 0.5)).rgb;
        col = acc / 8.0;
      }
      // and the camera sharpens what is left, which puts a halo on every hard edge
      vec3 nb = texture2D(tScene, uv + vec2(uTexel.x * 1.5, 0.0)).rgb + texture2D(tScene, uv - vec2(uTexel.x * 1.5, 0.0)).rgb
              + texture2D(tScene, uv + vec2(0.0, uTexel.y * 1.5)).rgb + texture2D(tScene, uv - vec2(0.0, uTexel.y * 1.5)).rgb;
      col = max(col + (col - nb * 0.25) * 0.4, 0.0);
      // too much changing at once for the bitrate: the picture breaks into 8x8 blocks until it settles
      vec2 blk = (floor(uv / (8.0 * uTexel)) + 0.5) * 8.0 * uTexel;
      col = mix(col, texture2D(tScene, blk).rgb, clamp(length(uBlur) * 22.0 - 0.05, 0.0, 0.65));
    }
    float ao = 0.0;
    for (int x = 0; x < 4; x++) for (int y = 0; y < 4; y++) {
      ao += texture2D(tAO, uv + (vec2(float(x), float(y)) - 1.5) * uAoTexel).r;
    }
    ao /= 16.0;
    col *= mix(1.0, ao, 0.85);
    col += texture2D(tBloom, uv).rgb * 0.7;
    if (uHelmet > 0.5) col *= clamp(uKey / texture2D(tExp, vec2(0.5)).r, 0.5, 1.6);   // the camera's auto exposure

    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, mix(1.06, 0.84, uHelmet) * (1.0 - 0.6 * uSupp));   // under fire the colour drains and the edges close in                       // helmet cam is flatter and colder
    col *= mix(vec3(1.0), vec3(0.98, 1.0, 1.03) * 1.06, uHelmet);
    vec2 v = vUv * 2.0 - 1.0;
    col *= mix(1.0, mix(0.8, 0.5, uHelmet), smoothstep(0.55, 1.55, length(v)));
    col *= 1.0 - 0.8 * uSupp * smoothstep(0.2, 1.2, length(v));  // darker toward the corners
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    if (uHelmet > 0.5) {
      // a small sensor: shadows crushed, highlights clipping to white, a faint green cast, and grain that
      // gets heavier the darker it is (the gain going up)
      vec3 c = gl_FragColor.rgb;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      c = smoothstep(0.025, 1.0, c);
      c = mix(c, vec3(1.0), smoothstep(0.78, 1.0, lum) * 0.55);
      c = floor(c * 48.0 + 0.5) / 48.0;                         // compression bands smooth gradients (the grain then breaks them up a little)
      c *= vec3(0.97, 1.02, 0.96);
      float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 517.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * (0.035 + 0.11 * (1.0 - smoothstep(0.0, 0.4, lum)));
      gl_FragColor.rgb = c;
    }
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 1.0, 0.97), uFlash);    // a flashbang: the picture burns out to white
  }`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.depth = new THREE.DepthTexture(2, 2);
    this.target = new THREE.WebGLRenderTarget(2, 2, { ...opts, type: THREE.HalfFloatType, samples: 4, depthTexture: this.depth });
    this.aoTarget = new THREE.WebGLRenderTarget(2, 2, opts);
    this.bloomA = new THREE.WebGLRenderTarget(2, 2, { ...opts, type: THREE.HalfFloatType });
    this.bloomB = new THREE.WebGLRenderTarget(2, 2, { ...opts, type: THREE.HalfFloatType });

    const mat = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.ao = mat(AO_FRAG, { tDepth: { value: this.depth }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() } });
    this.ao.toneMapped = false;
    this.bright = mat(BRIGHT_FRAG, { tScene: { value: this.target.texture } });
    this.bright.toneMapped = false;
    this.blur = mat(BLUR_FRAG, { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.blur.toneMapped = false;
    this.final = mat(FINAL_FRAG, {
      tScene: { value: this.target.texture }, tAO: { value: this.aoTarget.texture }, tBloom: { value: this.bloomA.texture },
      uAoTexel: { value: new THREE.Vector2() }, uHelmet: { value: 0 }, uAspect: { value: 1 }, uSupp: { value: 0 }, uBlur: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2() }, uTime: { value: 0 }, tExp: { value: null }, uKey: { value: 0.14 }, uFlash: { value: 0 },   // what a sunny yard averages, so daylight stays as it was
      uFaces: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    });

    const one = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType };
    this.expA = new THREE.WebGLRenderTarget(1, 1, one);
    this.expB = new THREE.WebGLRenderTarget(1, 1, one);
    this.exp = mat(EXP_FRAG, { tScene: { value: this.target.texture }, tPrev: { value: null }, uRate: { value: 1 } });
    this.exp.toneMapped = false;
    this.lastT = performance.now();

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.final);
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1), qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
    this.target.setSize(w, h);
    this.aoTarget.setSize(hw, hh);
    this.bloomA.setSize(qw, qh);
    this.bloomB.setSize(qw, qh);
    this.final.uniforms.uAoTexel.value.set(1 / hw, 1 / hh);
    this.bloomStep = [1 / qw, 1 / qh];
    this.final.uniforms.uAspect.value = w / h;
    this.final.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene, camera, helmet) {
    const r = this.renderer;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.target);
    r.render(scene, camera);

    this.ao.uniforms.uProj.value.copy(camera.projectionMatrix);
    this.ao.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    this.pass(this.ao, this.aoTarget);

    this.pass(this.bright, this.bloomA);
    for (let i = 0; i < 2; i++) {      // two rounds of blur, each a horizontal then a vertical sweep
      const k = i + 1;
      this.blur.uniforms.tSrc.value = this.bloomA.texture;
      this.blur.uniforms.uStep.value.set(this.bloomStep[0] * k, 0);
      this.pass(this.blur, this.bloomB);
      this.blur.uniforms.tSrc.value = this.bloomB.texture;
      this.blur.uniforms.uStep.value.set(0, this.bloomStep[1] * k);
      this.pass(this.blur, this.bloomA);
    }

    const now = performance.now(), dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    if (helmet) {
      this.exp.uniforms.tPrev.value = this.expA.texture;
      this.exp.uniforms.uRate.value = 1 - Math.exp(-dt * 1.6);
      this.pass(this.exp, this.expB);
      [this.expA, this.expB] = [this.expB, this.expA];
      this.final.uniforms.tExp.value = this.expA.texture;
    }
    this.final.uniforms.uHelmet.value = helmet ? 1 : 0;
    this.final.uniforms.uTime.value = performance.now() / 1000;
    this.pass(this.final, null);
  }
}
