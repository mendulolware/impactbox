import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { makeSurfaces, boxWithWorldUVs } from './textures.js';

const SKY_FRAG = `
  uniform vec3 sunDir; uniform float uTime; varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  void main() {
    vec3 d = normalize(vDir);
    float s = max(dot(d, sunDir), 0.0);
    vec3 zenith = vec3(0.10, 0.26, 0.62), horizon = vec3(0.58, 0.70, 0.84);
    vec3 col = mix(horizon, zenith, pow(clamp(d.y, 0.0, 1.0), 0.5));
    col += vec3(0.35, 0.25, 0.12) * pow(s, 6.0) * (1.0 - clamp(d.y, 0.0, 1.0));     // warm haze around the sun
    // clouds: noise on a flat layer overhead, thinning toward the horizon
    if (d.y > 0.0) {
      vec2 uv = d.xz / (d.y + 0.12) * 0.9 + uTime * vec2(0.006, 0.002);
      float c = fbm(uv) * 0.65 + fbm(uv * 2.7 + 4.0) * 0.35;
      float cover = smoothstep(0.50, 0.78, c) * smoothstep(0.0, 0.16, d.y);
      float shade = smoothstep(0.55, 0.9, fbm(uv + sunDir.xz * 0.35));              // darker on the side away from the sun
      vec3 cloud = mix(vec3(1.0, 0.98, 0.95), vec3(0.62, 0.66, 0.74), shade) * (1.0 + 0.6 * pow(s, 4.0));
      col = mix(col, cloud, cover * 0.9);
    }
    col = mix(col, vec3(0.19, 0.18, 0.17), smoothstep(0.0, -0.08, d.y));            // below the horizon
    col += vec3(1.0, 0.9, 0.72) * (pow(s, 500.0) * 9.0 + pow(s, 30.0) * 0.18);       // the sun itself
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function buildWorld(ctx) {
  const { scene, world } = ctx;
  const S = makeSurfaces();

  // ------------------------------------------------------------ sky, sun, air
  // The sky is a shader on a dome. A small copy is baked into an environment map, which is what
  // lights the shaded side of everything and gives metal something to reflect.
  const sunDir = new THREE.Vector3(34, 38, 22).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_FRAG,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(360, 32, 16), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
  ctx.sky = sky;

  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), skyMat));
  const pmrem = new THREE.PMREMGenerator(ctx.renderer);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  pmrem.dispose();

  const haze = new THREE.Color().setRGB(0.58, 0.70, 0.84);
  scene.background = haze;
  scene.fog = new THREE.FogExp2(haze, 0.0065);       // distance fades into the sky colour

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x3a3632, 0.3));
  const sun = new THREE.DirectionalLight(0xffeccf, 3.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -30; sc.right = sc.top = 30;
  sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  ctx.sun = sun;
  ctx.sunOffset = sunDir.clone().multiplyScalar(70);

  // ------------------------------------------------------------ ground: asphalt
  const TILE = 6; // metres covered by one copy of the asphalt texture
  for (const t of [S.asphalt.map, S.asphalt.normalMap, S.asphalt.roughnessMap]) t.repeat.set(240 / TILE, 240 / TILE);
  const groundMat = new THREE.MeshStandardMaterial({ ...S.asphalt, normalScale: new THREE.Vector2(1.1, 1.1) });
  // big soft blotches over the top, so the tiling does not show from a distance
  groundMat.onBeforeCompile = (shader) => {
    shader.uniforms.tMacro = { value: S.macro };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMacroUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMacroUv = position.xy / 57.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tMacro; varying vec2 vMacroUv;')
      .replace('#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb *= 0.72 + 0.56 * texture2D(tMacro, vMacroUv).r;');
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  world.createCollider(RAPIER.ColliderDesc.cuboid(120, 0.5, 120).setTranslation(0, -0.5, 0).setFriction(0.9));

  // worn painted lines: parking bays and a yard boundary
  const paintMat = new THREE.MeshStandardMaterial({
    map: S.paint, transparent: true, roughness: 0.75, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const stripe = (x, z, len, yaw = 0, width = 0.13) => {
    const g = new THREE.PlaneGeometry(width, len);
    g.attributes.uv.array.forEach((v, i, a) => { if (i % 2) a[i] = v * len / 1.4; else a[i] = v * 0.1 + x * 0.37; });
    const m = new THREE.Mesh(g, paintMat);
    m.rotation.set(-Math.PI / 2, 0, yaw);
    m.position.set(x, 0.012, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  for (let i = 0; i < 7; i++) stripe(-30 + i * 2.7, 31, 5.2);            // bays along the south side
  stripe(-21.9, 33.6, 16.4, Math.PI / 2);
  for (let i = 0; i < 5; i++) stripe(22 + i * 2.7, 20, 5.2);
  stripe(0, 0, 60, 0, 0.11);                                             // centre line across the yard
  stripe(0, 0, 60, Math.PI / 2, 0.11);

  // ------------------------------------------------------------ static structures
  const concreteMats = [0xffffff, 0xe9ebee, 0xd8dade].map((c) =>
    new THREE.MeshStandardMaterial({ ...S.concrete, color: c, normalScale: new THREE.Vector2(0.9, 0.9) }));
  const woodMat = new THREE.MeshStandardMaterial({ ...S.planks, normalScale: new THREE.Vector2(1.0, 1.0) });

  let n = 0;
  const staticBox = (x, y, z, w, h, d, kind, rx = 0, ry = 0, rz = 0) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.9), body);
    const wood = kind === 'wood';
    const m = new THREE.Mesh(boxWithWorldUVs(w, h, d, wood ? 2.4 : 4), wood ? woodMat : concreteMats[n++ % concreteMats.length]);
    m.position.set(x, y, z);
    m.quaternion.copy(q);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  };

  // perimeter walls
  const W = 42, H = 7;
  staticBox(0, H / 2, -W, W * 2 + 2, H, 1, 'concrete');
  staticBox(0, H / 2, W, W * 2 + 2, H, 1, 'concrete');
  staticBox(-W, H / 2, 0, 1, H, W * 2 + 2, 'concrete');
  staticBox(W, H / 2, 0, 1, H, W * 2 + 2, 'concrete');

  // launch ramp
  staticBox(14, 1.05, -10, 7, 0.4, 14, 'wood', -0.17, 0, 0);

  // raised platform with stairs
  staticBox(-18, 2.2, -16, 11, 0.4, 10, 'wood');
  for (let i = 0; i < 8; i++) {
    const hgt = 0.3 * (i + 1);
    staticBox(-18, hgt / 2, -10.5 + (7 - i) * 1.0 + 0.5, 3.2, hgt, 1.0, 'concrete');
  }
  // platform supports and a back rail
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) staticBox(-18 + sx * 5.1, 1.0, -16 + sz * 4.6, 0.35, 2.0, 0.35, 'concrete');
  staticBox(-18, 2.9, -20.9, 11, 1.0, 0.2, 'concrete');

  // cover & pillars
  staticBox(6, 0.75, 6, 4, 1.5, 0.6, 'concrete');
  staticBox(-8, 0.75, 8, 0.6, 1.5, 4, 'concrete');
  staticBox(20, 0.75, 12, 5, 1.5, 0.6, 'concrete', 0, 0.5, 0);
  staticBox(0, 2.5, -26, 1.2, 5, 1.2, 'concrete');
  staticBox(10, 2.5, -26, 1.2, 5, 1.2, 'concrete');
  staticBox(5, 5.3, -26, 12, 0.6, 1.6, 'concrete');

  // a tall block with a ramp up, to throw things off
  staticBox(26, 1.5, -22, 8, 3, 8, 'concrete');
  staticBox(16, 1.3, -22, 12.37, 0.4, 5, 'concrete', 0, 0, 0.245);
}
