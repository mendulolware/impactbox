import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#6b7075'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#62676c'; g.fillRect(0, 0, 128, 128); g.fillRect(128, 128, 128, 128);
  for (let i = 0; i < 1400; i++) {
    const v = 90 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.25)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(ctx) {
  const { scene, world } = ctx;

  scene.background = new THREE.Color(0x8fb8e0);
  scene.fog = new THREE.Fog(0x8fb8e0, 50, 170);

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4d4a45, 1.0));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -34; sc.right = sc.top = 34;
  sc.near = 1; sc.far = 140;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  ctx.sun = sun;

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  world.createCollider(RAPIER.ColliderDesc.cuboid(120, 0.5, 120).setTranslation(0, -0.5, 0).setFriction(0.9));

  const staticBox = (x, y, z, w, h, d, color, rx = 0, ry = 0, rz = 0) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.9), body);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
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
  staticBox(-18, 2.9, -20.9, 11, 1.0, 0.2, 0x555b63);

  // cover & pillars
  staticBox(6, 0.75, 6, 4, 1.5, 0.6, 0x8a8f96);
  staticBox(-8, 0.75, 8, 0.6, 1.5, 4, 0x8a8f96);
  staticBox(20, 0.75, 12, 5, 1.5, 0.6, 0x8a8f96, 0, 0.5, 0);
  staticBox(0, 2.5, -26, 1.2, 5, 1.2, 0x666c74);
  staticBox(10, 2.5, -26, 1.2, 5, 1.2, 0x666c74);
  staticBox(5, 5.3, -26, 12, 0.6, 1.6, 0x666c74);

  // a tall block with a ramp up, to throw things off
  staticBox(26, 1.5, -22, 8, 3, 8, 0x5a6670);
  staticBox(16, 1.3, -22, 12.37, 0.4, 5, 0x7d8890, 0, 0, 0.245);
}
