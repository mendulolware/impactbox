import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

function surfaceTexture(size, repeat, base, variance = 30, joints = true) {
  const color = document.createElement('canvas');
  const height = document.createElement('canvas');
  color.width = color.height = height.width = height.height = size;
  const cg = color.getContext('2d'), hg = height.getContext('2d');
  const image = cg.createImageData(size, size);
  const bump = hg.createImageData(size, size);
  let seed = 0x51f15e;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const coarse = (random() - 0.5) * variance;
    const fine = (random() - 0.5) * variance * 0.35;
    image.data[i] = Math.max(0, Math.min(255, base[0] + coarse));
    image.data[i + 1] = Math.max(0, Math.min(255, base[1] + coarse));
    image.data[i + 2] = Math.max(0, Math.min(255, base[2] + coarse + fine));
    image.data[i + 3] = 255;
    const h = 128 + coarse * 1.7 + fine;
    bump.data[i] = bump.data[i + 1] = bump.data[i + 2] = h;
    bump.data[i + 3] = 255;
  }
  cg.putImageData(image, 0, 0);
  hg.putImageData(bump, 0, 0);
  if (joints) {
    cg.strokeStyle = 'rgba(25,28,30,.42)'; cg.lineWidth = 3;
    hg.strokeStyle = '#3b3b3b'; hg.lineWidth = 3;
    for (const g of [cg, hg]) {
      g.strokeRect(1.5, 1.5, size - 3, size - 3);
      g.beginPath(); g.moveTo(size * 0.5, 0); g.lineTo(size * 0.5, size); g.stroke();
    }
  }
  const map = new THREE.CanvasTexture(color);
  const bumpMap = new THREE.CanvasTexture(height);
  for (const t of [map, bumpMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 16;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bumpMap };
}

export function buildWorld(ctx) {
  const { scene, world } = ctx;

  // Sky: a gradient dome with a sun. A small copy of it is baked into an environment map, which
  // is what lets metal on the weapons and barrels reflect something instead of rendering black.
  const sunDir = new THREE.Vector3(30, 50, 20).normalize();
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir } },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 sunDir; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 zenith = vec3(0.055, 0.17, 0.42), horizon = vec3(0.57, 0.70, 0.82), ground = vec3(0.18, 0.19, 0.20);
        vec3 col = mix(horizon, zenith, pow(clamp(d.y, 0.0, 1.0), 0.55));
        col = mix(col, ground, smoothstep(0.0, -0.08, d.y));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.84, 0.58) * (pow(s, 700.0) * 13.0 + pow(s, 14.0) * 0.26);
        float haze = pow(1.0 - max(d.y, 0.0), 7.0);
        col += vec3(0.22, 0.20, 0.17) * haze;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
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

  const horizon = new THREE.Color().setRGB(0.60, 0.72, 0.84);
  scene.background = horizon;
  scene.fog = new THREE.Fog(horizon, 52, 205);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x5b5a55, 0.78));
  scene.add(new THREE.AmbientLight(0x9fb6c8, 0.18));
  const sun = new THREE.DirectionalLight(0xffe7c2, 3.25);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -28; sc.right = sc.top = 28;
  sc.near = 1; sc.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  ctx.sun = sun;

  const skyFill = new THREE.DirectionalLight(0x8db8e8, 0.42);
  skyFill.position.set(-28, 22, -35);
  scene.add(skyFill);

  // Ground uses matching procedural albedo and height maps, so it reads as poured concrete
  // at grazing angles without shipping an external texture asset.
  const groundMaps = surfaceTexture(512, 48, [104, 110, 115], 34, true);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({
      ...groundMaps,
      roughness: 0.92,
      metalness: 0.02,
      bumpScale: 0.035,
      color: 0xd6dbe0,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  world.createCollider(RAPIER.ColliderDesc.cuboid(120, 0.5, 120).setTranslation(0, -0.5, 0).setFriction(0.9));

  // Keep the albedo near white because MeshStandardMaterial multiplies it by the tint below.
  const concreteMaps = surfaceTexture(384, 2, [220, 223, 226], 20, false);
  const materialCache = new Map();
  const worldMaterial = (color, kind = 'concrete') => {
    const key = `${color}:${kind}`;
    if (!materialCache.has(key)) {
      materialCache.set(key, new THREE.MeshStandardMaterial({
        color,
        map: kind === 'concrete' ? concreteMaps.map : null,
        bumpMap: kind === 'concrete' ? concreteMaps.bumpMap : null,
        bumpScale: kind === 'concrete' ? 0.025 : 0,
        roughness: kind === 'metal' ? 0.48 : 0.88,
        metalness: kind === 'metal' ? 0.56 : 0.03,
        envMapIntensity: kind === 'metal' ? 1.25 : 0.45,
      }));
    }
    return materialCache.get(key);
  };

  const staticBox = (x, y, z, w, h, d, color, rx = 0, ry = 0, rz = 0, kind = 'concrete') => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.9), body);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      worldMaterial(color, kind)
    );
    m.position.set(x, y, z);
    m.quaternion.copy(q);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  };

  // perimeter walls
  const W = 42, H = 7;
  staticBox(0, H / 2, -W, W * 2 + 2, H, 1, 0x555b63);
  staticBox(0, H / 2, W, W * 2 + 2, H, 1, 0x555b63);
  staticBox(-W, H / 2, 0, 1, H, W * 2 + 2, 0x555b63);
  staticBox(W, H / 2, 0, 1, H, W * 2 + 2, 0x555b63);

  // launch ramp
  staticBox(14, 1.05, -10, 7, 0.4, 14, 0x8a6a3a, -0.17, 0, 0);

  // raised platform with stairs
  staticBox(-18, 2.2, -16, 11, 0.4, 10, 0x7a5c3a);
  for (let i = 0; i < 8; i++) {
    const hgt = 0.3 * (i + 1);
    staticBox(-18, hgt / 2, -10.5 + (7 - i) * 1.0 + 0.5, 3.2, hgt, 1.0, 0x9a7a52);
  }
  // railings so ragdolls can be dropped off the edge
  staticBox(-18, 2.9, -20.9, 11, 1.0, 0.2, 0x555b63, 0, 0, 0, 'metal');

  // cover & pillars
  staticBox(6, 0.75, 6, 4, 1.5, 0.6, 0x8a8f96);
  staticBox(-8, 0.75, 8, 0.6, 1.5, 4, 0x8a8f96);
  staticBox(20, 0.75, 12, 5, 1.5, 0.6, 0x8a8f96, 0, 0.5, 0);
  staticBox(0, 2.5, -26, 1.2, 5, 1.2, 0x666c74, 0, 0, 0, 'metal');
  staticBox(10, 2.5, -26, 1.2, 5, 1.2, 0x666c74, 0, 0, 0, 'metal');
  staticBox(5, 5.3, -26, 12, 0.6, 1.6, 0x666c74, 0, 0, 0, 'metal');

  // a tall block with a ramp up, to throw things off
  staticBox(26, 1.5, -22, 8, 3, 8, 0x5a6670);
  staticBox(16, 1.3, -22, 12.37, 0.4, 5, 0x7d8890, 0, 0, 0.245);

  // Painted floor markings and drainage grates provide scale and break up the large arena floor.
  const decalMat = new THREE.MeshStandardMaterial({ color: 0xd7b83e, roughness: 0.78, polygonOffset: true, polygonOffsetFactor: -2 });
  const stripeGeo = new THREE.PlaneGeometry(0.16, 5.2);
  for (let x = -33; x <= 33; x += 6) {
    const stripe = new THREE.Mesh(stripeGeo, decalMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(x, 0.006, 29);
    stripe.receiveShadow = true;
    scene.add(stripe);
  }
  const grateMat = worldMaterial(0x30363b, 'metal');
  for (const x of [-24, 0, 24]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.018, 0.7), grateMat);
    frame.position.set(x, 0.008, 18);
    frame.receiveShadow = true;
    scene.add(frame);
    for (let i = -7; i <= 7; i++) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.024, 0.56), worldMaterial(0x111518, 'metal'));
      slot.position.set(x + i * 0.21, 0.021, 18);
      scene.add(slot);
    }
  }
}
