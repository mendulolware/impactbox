import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';
import { makeSurfaces, boxWithWorldUVs } from './textures.js';
import { MAPS } from './maps.js';
import { Door } from './doors.js';

// The world is two things:
//   the air   - sky dome, sun, fog and the environment map. Made once; each map picks a time of day.
//   the map   - ground, walls, buildings. Built from a description in maps.js by MapBuilder, which
//               gives every box a collider and then joins the visible boxes into one mesh per
//               material, so a map of hundreds of pieces costs a handful of draw calls.
// loadMap() tears the old map down and puts the new one up.

const SKY_FRAG = `
  uniform vec3 sunDir; uniform float uTime; varying vec3 vDir;
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uCloud; uniform vec2 uCover;
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
    vec3 col = mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.5));
    col += uSun * vec3(0.35, 0.27, 0.16) * pow(s, 6.0) * (1.0 - clamp(d.y, 0.0, 1.0));     // warm haze around the sun
    // clouds: noise on a flat layer overhead, thinning toward the horizon
    if (d.y > 0.0) {
      vec2 uv = d.xz / (d.y + 0.12) * 0.9 + uTime * vec2(0.006, 0.002);
      float c = fbm(uv) * 0.65 + fbm(uv * 2.7 + 4.0) * 0.35;
      float cover = smoothstep(uCover.x, uCover.y, c) * smoothstep(0.0, 0.16, d.y);
      float shade = smoothstep(0.55, 0.9, fbm(uv + sunDir.xz * 0.35));              // darker on the side away from the sun
      vec3 cloud = uCloud * mix(vec3(1.0, 0.98, 0.95), vec3(0.62, 0.66, 0.74), shade) + uSun * 0.6 * pow(s, 4.0);
      col = mix(col, cloud, cover * 0.9);
    }
    col = mix(col, uHorizon * 0.3, smoothstep(0.0, -0.08, d.y));                      // below the horizon
    col += uSun * (pow(s, 500.0) * 9.0 + pow(s, 30.0) * 0.18);                        // the sun itself
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Times of day. sun = direction to it; cover = how much cloud (lower numbers, more cloud).
const SKIES = {
  day:      { sun: [34, 38, 22],   sunCol: [1.0, 0.9, 0.72],  light: 0xffeccf, power: 3.3, fill: 0.3,  zenith: [0.10, 0.26, 0.62], horizon: [0.58, 0.70, 0.84], cloud: [1, 1, 1],          cover: [0.50, 0.78], fog: 0.0065 },
  noon:     { sun: [12, 60, 20],   sunCol: [1.0, 0.95, 0.85], light: 0xfff4e0, power: 3.6, fill: 0.3,  zenith: [0.07, 0.22, 0.64], horizon: [0.60, 0.74, 0.90], cloud: [1, 1, 1],          cover: [0.64, 0.92], fog: 0.005 },
  overcast: { sun: [20, 50, 14],   sunCol: [0.5, 0.5, 0.5],   light: 0xdfe6f0, power: 1.3, fill: 0.85, zenith: [0.44, 0.48, 0.54], horizon: [0.66, 0.69, 0.72], cloud: [0.72, 0.74, 0.78], cover: [0.16, 0.5],  fog: 0.009 },
  golden:   { sun: [-44, 13, 24],  sunCol: [1.0, 0.62, 0.3],  light: 0xffa560, power: 3.4, fill: 0.32, zenith: [0.13, 0.22, 0.48], horizon: [0.95, 0.6, 0.36],  cloud: [1.0, 0.72, 0.55],  cover: [0.44, 0.8],  fog: 0.006 },
  night:    { sun: [-20, 42, 30],  sunCol: [0.22, 0.26, 0.4], light: 0x8fa8ff, power: 0.16, fill: 0.07, zenith: [0.003, 0.005, 0.016], horizon: [0.012, 0.018, 0.04], cloud: [0.04, 0.05, 0.08], cover: [0.5, 0.85], fog: 0.014 },   // the 'sun' is the moon
  dusk:     { sun: [-30, 7, -44],  sunCol: [0.55, 0.3, 0.3],  light: 0x8fa2e0, power: 0.75, fill: 0.5, zenith: [0.025, 0.04, 0.12], horizon: [0.34, 0.22, 0.3], cloud: [0.2, 0.17, 0.24],  cover: [0.46, 0.85], fog: 0.011 },
};

/** Make the sky, sun and fog (once), then put up a map. */
export function buildWorld(ctx, mapId = 'yard') {
  const { scene } = ctx;
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 },
      uZenith: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() },
      uSun: { value: new THREE.Vector3() }, uCloud: { value: new THREE.Vector3() }, uCover: { value: new THREE.Vector2() },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_FRAG,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(360, 32, 16), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
  ctx.sky = sky;

  // a small copy of the sky is baked into an environment map: it lights the shaded side of
  // everything and gives metal something to reflect
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), skyMat));

  scene.background = new THREE.Color();
  scene.fog = new THREE.FogExp2(0xffffff, 0.0065);       // distance fades into the sky colour
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x3a3632, 0.3);
  scene.add(hemi);
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
  ctx.sunOffset = new THREE.Vector3();

  ctx.setSky = (name) => {
    const k = SKIES[name] || SKIES.day;
    const u = skyMat.uniforms;
    u.sunDir.value.set(...k.sun).normalize();
    u.uZenith.value.set(...k.zenith);
    u.uHorizon.value.set(...k.horizon);
    u.uSun.value.set(...k.sunCol);
    u.uCloud.value.set(...k.cloud);
    u.uCover.value.set(...k.cover);
    scene.background.setRGB(...k.horizon);
    scene.fog.color.setRGB(...k.horizon);
    scene.fog.density = k.fog;
    hemi.intensity = k.fill;
    sun.color.set(k.light);
    sun.intensity = k.power;
    ctx.sunOffset.copy(u.sunDir.value).multiplyScalar(70);
    if (scene.environment) scene.environment.dispose();
    const pmrem = new THREE.PMREMGenerator(ctx.renderer);
    scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
    pmrem.dispose();
  };

  loadMap(ctx, mapId);
}

/** Take down the current map (if any) and build another. Leaves ctx.map describing it. */
export function loadMap(ctx, id) {
  const def = MAPS[id] || MAPS.yard;
  if (ctx.map) ctx.map.builder.dispose();
  ctx.setSky(ctx.night ? 'night' : ctx.rain ? 'overcast' : def.sky);
  const builder = new MapBuilder(ctx);
  def.build(builder);
  builder.finish();
  if (ctx.rain) builder.wet(true);
  ctx.map = {
    id: def.id, name: def.name, def, builder,
    bounds: def.bounds,             // { x0, x1, z0, z1 }: where NPCs keep to
    spawn: def.spawn, yaw: def.yaw || 0,
    killY: def.killY ?? -25,        // fall below this and you are dead
    populate: () => def.populate(ctx),
  };
  return ctx.map;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const BULB = new THREE.SphereGeometry(0.07, 10, 8);

/** A pane of glass: its own mesh and collider, so one round (or a blast) takes it out and the round carries on. */
class Pane {
  constructor(ctx, body, x, y, z, w, h, t, material, o = {}) {
    this.ctx = ctx;
    this.pos = new THREE.Vector3(x, y, z);
    this.area = w * h;
    this.geo = new THREE.BoxGeometry(w, h, t);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    this.mesh.receiveShadow = true;
    _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0));
    this.collider = ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, Math.max(t, 0.04) / 2)
      .setTranslation(x, y, z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }), body);
    ctx.owners.set(this.collider.handle, { kind: 'glass', pane: this });
    ctx.surfaces.set(this.collider.handle, 'glass');
    this.broken = false;
  }
  break(point) {
    if (this.broken) return;
    this.ctx.soundAt = this.pos;
    this.broken = true;
    this.ctx.owners.delete(this.collider.handle);
    this.ctx.surfaces.delete(this.collider.handle);
    this.ctx.world.removeCollider(this.collider, false);
    this.mesh.visible = false;
    const p = point || this.pos;
    this.ctx.gore.debris(p, 0xd8ecf6, Math.min(36, 8 + Math.round(this.area * 5)));
    this.ctx.sfx.glass();
    this.ctx.alert('violence', p, 14);
  }
  dispose() {
    this.geo.dispose();
    if (!this.broken) { this.ctx.owners.delete(this.collider.handle); this.ctx.surfaces.delete(this.collider.handle); }   // (the collider goes with the map's body)
  }
}

/** A lamp: a light, the bulb it comes from, and a collider so a round can put it out. */
class Lamp {
  constructor(ctx, body, x, y, z, color, power, reach) {
    this.ctx = ctx;
    this.pos = new THREE.Vector3(x, y, z);
    this.light = new THREE.PointLight(color, power, reach, 2);
    this.light.position.set(x, y, z);
    this.mat = new THREE.MeshStandardMaterial({ color: 0x202020, emissive: color, emissiveIntensity: 3, roughness: 0.3 });
    this.bulb = new THREE.Mesh(BULB, this.mat);
    this.bulb.position.set(x, y, z);
    this.collider = ctx.world.createCollider(RAPIER.ColliderDesc.ball(0.14).setTranslation(x, y, z), body);
    ctx.owners.set(this.collider.handle, { kind: 'lamp', lamp: this });
    ctx.surfaces.set(this.collider.handle, 'glass');
    this.off = false;
  }
  out(point) {
    if (this.off) return;
    this.ctx.soundAt = this.pos;
    this.off = true;
    this.light.intensity = 0;
    this.mat.emissiveIntensity = 0;
    this.ctx.owners.delete(this.collider.handle);
    this.ctx.surfaces.delete(this.collider.handle);
    this.ctx.world.removeCollider(this.collider, false);
    const p = point || this.pos;
    this.ctx.gore.sparks(p, new THREE.Vector3(0, -1, 0), 10);
    this.ctx.gore.debris(p, 0xd8ecf6, 6);
    this.ctx.sfx.glass();
  }
  dispose() {
    this.mat.dispose();
    if (!this.off) { this.ctx.owners.delete(this.collider.handle); this.ctx.surfaces.delete(this.collider.handle); }
  }
}

/** What a map description builds with. Everything it makes is static. */
export class MapBuilder {
  constructor(ctx) {
    this.ctx = ctx;
    this.S = makeSurfaces();
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.body = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());   // every collider of the map hangs off this
    this.batches = new Map();     // material -> geometries waiting to be joined
    this.mats = new Map();
    this.trash = [];              // what to dispose of when the map goes
    this.doors = [];
    ctx.doors = this.doors;
    this.panes = [];
    ctx.panes = this.panes;
    this.lamps = [];
    ctx.lamps = this.lamps;
    let s = 12345;
    /** The same "random" numbers every time, so a map is the same map on every visit. */
    this.rnd = (a = 0, b = 1) => { s = (s * 16807) % 2147483647; return a + (s / 2147483647) * (b - a); };
  }

  /**
   * A material. kind: 'concrete' | 'planks' | 'brick' | 'metal' | 'asphalt' (textured, sized in metres)
   * or 'plain'. extra = any other MeshStandardMaterial settings.
   */
  mat(kind, color = 0xffffff, extra = {}) {
    const key = kind + color + JSON.stringify(extra);
    let m = this.mats.get(key);
    if (!m) {
      const tex = this.S[kind];
      m = new THREE.MeshStandardMaterial(tex ? { ...tex, color, ...extra } : { color, roughness: 0.6, ...extra });
      m.userData.tile = this.S.tile[kind] || 4;
      m.userData.kind = kind;
      this.mats.set(key, m);
      this.trash.push(m);
    }
    return m;
  }

  _place(geo, x, y, z, o) {
    _q.setFromEuler(_e.set(o.rx || 0, o.ry || 0, o.rz || 0));
    geo.applyMatrix4(_m.compose(_p.set(x, y, z), _q, ONE));
    return _q;
  }

  _add(geo, material) {
    let list = this.batches.get(material);
    if (!list) this.batches.set(material, list = []);
    list.push(geo);
  }

  /** A box centred on (x, y, z). o: rx, ry, rz (radians), solid: false = scenery nothing can touch. */
  box(x, y, z, w, h, d, material, o = {}) {
    const g = boxWithWorldUVs(w, h, d, material.userData.tile);
    const q = this._place(g, x, y, z, o);
    this._add(g, material);
    if (o.solid !== false) {
      const c = this.ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.9), this.body);
      this.ctx.surfaces.set(c.handle, material.userData.kind || 'concrete');       // (what a round or a boot sounds like on it)
    }
  }

  /** An upright cylinder (tank, pipe, post) centred on (x, y, z). */
  cyl(x, y, z, r, h, material, o = {}) {
    const g = new THREE.CylinderGeometry(r, r, h, o.sides || 14);
    const q = this._place(g, x, y, z, o);
    this._add(g, material);
    if (o.solid !== false) {
      const c = this.ctx.world.createCollider(RAPIER.ColliderDesc.cylinder(h / 2, r)
        .setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.9), this.body);
      this.ctx.surfaces.set(c.handle, material.userData.kind || 'metal');
    }
  }

  /** The ground: a big asphalt plane at y = 0 with large soft blotches over it so the tiling does not show. */
  ground(size = 240, color = 0xffffff) {
    const S = this.S;
    const mat = new THREE.MeshStandardMaterial({ ...S.asphalt, color, normalScale: new THREE.Vector2(1.1, 1.1) });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tMacro = { value: S.macro };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMacroUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMacroUv = position.xy / 57.0;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tMacro; varying vec2 vMacroUv;')
        .replace('#include <map_fragment>',
          '#include <map_fragment>\ndiffuseColor.rgb *= 0.72 + 0.56 * texture2D(tMacro, vMacroUv).r;');
    };
    const geo = new THREE.PlaneGeometry(size, size);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / S.tile.asphalt, uv.getY(i) * size / S.tile.asphalt);
    this.groundMat = mat;
    this.groundColor = color;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.trash.push(geo, mat);
    const c = this.ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(size / 2, 0.5, size / 2).setTranslation(0, -0.5, 0).setFriction(0.9), this.body);
    this.ctx.surfaces.set(c.handle, 'asphalt');
  }

  /** A worn painted line on a flat surface. yaw 0 runs along z. */
  stripe(x, z, len, yaw = 0, width = 0.13, y = 0.012) {
    if (!this.paint) {
      this.paint = new THREE.MeshStandardMaterial({
        map: this.S.paint, transparent: true, roughness: 0.75, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.paint.userData.flat = true;
      this.trash.push(this.paint);
    }
    const g = new THREE.PlaneGeometry(width, len);
    g.attributes.uv.array.forEach((v, i, a) => { if (i % 2) a[i] = v * len / 1.4; else a[i] = v * 0.1 + x * 0.37; });
    g.rotateX(-Math.PI / 2);
    g.rotateY(yaw);
    g.translate(x, y, z);
    this._add(g, this.paint);
  }

  /**
   * Solid steps climbing from (x, y0, z) in direction (dx, dz), which must be along one axis.
   * Each step is a block down to y0, so there is nothing to fall through.
   */
  stairs(x, z, dx, dz, width, steps, rise, run, material, y0 = 0) {
    for (let i = 0; i < steps; i++) {
      const h = rise * (i + 1);
      const cx = x + dx * (i + 0.5) * run, cz = z + dz * (i + 0.5) * run;
      this.box(cx, y0 + h / 2, cz, dx ? run : width, h, dx ? width : run, material);
    }
  }

  /** A wall from (x0, z0) to (x1, z1) (axis-aligned), optionally with doorways: gaps = [[centre 0..1, width], ...]. */
  wall(x0, z0, x1, z1, h, t, material, gaps = [], y0 = 0) {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? x1 - x0 : z1 - z0;
    const cuts = gaps.map(([f, w]) => [f * len - w / 2, f * len + w / 2]).sort((a, b) => a[0] - b[0]);
    let from = 0;
    const seg = (a, b) => {
      if (b - a < 0.05) return;
      const mid = (a + b) / 2;
      if (alongX) this.box(x0 + mid, y0 + h / 2, z0, b - a, h, t, material);
      else this.box(x0, y0 + h / 2, z0 + mid, t, h, b - a, material);
    };
    for (const [a, b] of cuts) { seg(from, a); from = b; }
    seg(from, len);
  }

  /**
   * A door in a doorway centred on (x, z) in a wall running along yaw (0 = along x), with its frame.
   * o: locked, wallH and wallT (the wall it sits in, for the frame), gap (the doorway's width), y0 (the floor it stands on).
   */
  door(x, z, yaw, o = {}) {
    const wood = this.mat('planks', 0xc9a066);
    const frame = this.mat('planks', 0x6b4a2a);
    const gap = o.gap || 1.3, wallT = o.wallT || 0.12, wallH = o.wallH || 2.6, y0 = o.y0 || 0;
    const d = new Door(this.ctx, x, z, yaw, { w: gap - 0.1, y0, locked: !!o.locked, material: wood, handleMat: this.mat('plain', 0x8a8f94, { metalness: 0.8, roughness: 0.35 }) });
    this.doors.push(d);
    const ax = Math.cos(yaw), az = -Math.sin(yaw);                       // along the wall
    this.box(x, y0 + (wallH + d.h) / 2, z, gap, wallH - d.h, wallT, frame, { ry: yaw });        // lintel
    for (const s of [-1, 1]) this.box(x + ax * s * (gap / 2 - 0.025), y0 + d.h / 2, z + az * s * (gap / 2 - 0.025), 0.05, d.h, wallT + 0.02, frame, { ry: yaw });   // jambs
    return d;
  }

  /** A lamp: light that reaches `reach` metres, from a bulb a round can put out. (No shadows: they are dear, and the sun has the only one.) */
  light(x, y, z, color = 0xffd9a0, power = 40, reach = 20) {
    const l = new Lamp(this.ctx, this.body, x, y, z, color, power, reach);
    this.group.add(l.light, l.bulb);
    this.lamps.push(l);
    return l;
  }

  /** A pane of glass centred on (x, y, z): breaks when shot, and rounds carry on through it once it has. */
  pane(x, y, z, w, h, t, material, o = {}) {
    const p = new Pane(this.ctx, this.body, x, y, z, w, h, t, material, o);
    this.group.add(p.mesh);
    this.panes.push(p);
    return p;
  }

  /** Rain on, rain off: the ground goes dark and shiny, or back to how it was. */
  wet(on) {
    if (!this.groundMat) return;
    this.groundMat.roughness = on ? 0.22 : 1;
    this.groundMat.color.set(this.groundColor).multiplyScalar(on ? 0.55 : 1);
    this.groundMat.needsUpdate = true;
  }

  /** Join everything up. Called once the description has run. */
  finish() {
    for (const [material, list] of this.batches) {
      const geo = mergeGeometries(list);
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = !material.userData.flat;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.trash.push(geo);
    }
    this.batches.clear();
  }

  dispose() {
    for (const p of this.panes) p.dispose();
    for (const l of this.lamps) l.dispose();
    this.panes.length = this.lamps.length = 0;
    this.ctx.surfaces.clear();
    for (const d of this.doors) d.dispose();
    this.doors.length = 0;
    this.ctx.scene.remove(this.group);
    for (const t of this.trash) t.dispose();
    this.ctx.world.removeRigidBody(this.body);
  }
}
