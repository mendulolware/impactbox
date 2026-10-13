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

const FINAL_FRAG = `
  uniform sampler2D tScene; uniform sampler2D tAO; uniform sampler2D tBloom;
  uniform vec2 uAoTexel; uniform float uHelmet; uniform float uAspect; uniform vec3 uFaces[8]; varying vec2 vUv;
  void main() {
    // bodycam lens: the middle of the picture is magnified and the edges squeezed in (corners stay put)
    vec2 lc = vUv * 2.0 - 1.0;
    float bend = 0.3 * uHelmet;
    vec2 uv = 0.5 + 0.5 * lc * (1.0 + bend * dot(lc, lc)) / (1.0 + bend * 2.0);
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
    float ao = 0.0;
    for (int x = 0; x < 4; x++) for (int y = 0; y < 4; y++) {
      ao += texture2D(tAO, uv + (vec2(float(x), float(y)) - 1.5) * uAoTexel).r;
    }
    ao /= 16.0;
    col *= mix(1.0, ao, 0.85);
    col += texture2D(tBloom, uv).rgb * 0.7;

    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, mix(1.06, 0.84, uHelmet));                       // helmet cam is flatter and colder
    col *= mix(vec3(1.0), vec3(0.98, 1.0, 1.03) * 1.06, uHelmet);
    vec2 v = vUv * 2.0 - 1.0;
    col *= mix(1.0, mix(0.8, 0.5, uHelmet), smoothstep(0.55, 1.55, length(v)));  // darker toward the corners
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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
      uAoTexel: { value: new THREE.Vector2() }, uHelmet: { value: 0 }, uAspect: { value: 1 },
      uFaces: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    });

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

    this.final.uniforms.uHelmet.value = helmet ? 1 : 0;
    this.pass(this.final, null);
  }
}
