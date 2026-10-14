import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// The Rope Tool and the Weld Tool (the Gear group). Click one thing, then another: a rope ties them together
// at the length they are apart, a weld holds them exactly as they sit now. Either end can be the world itself
// (a wall, the floor). Right-click takes every link off what you point at, or the newest one if you point at
// nothing. A person you tie up goes limp for a moment, so the rope can take them.
//
// Rapier drops a joint along with either of its bodies (a gib, a delete, a map change), so every frame each
// link checks both ends are still there before touching them, and lets go of itself if not.

const MAX_LINKS = 40;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Tools {
  constructor(ctx) {
    this.ctx = ctx;
    this.links = [];
    this.first = null;          // the end picked first: { body, local, at }
    this.ropeMat = new THREE.MeshStandardMaterial({ color: 0x8c6c42, roughness: 0.95 });
    this.weldMat = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xc04000, emissiveIntensity: 0.8, roughness: 0.4, metalness: 0.6 });
    this.ropeGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2);   // from the origin along +Z, 1 m
    this.weldGeo = new THREE.SphereGeometry(0.04, 10, 8);
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0x66ccff }));
    this.marker.visible = false;
    ctx.scene.add(this.marker);
  }

  alive(body) { return !!this.ctx.world.getRigidBody(body.handle); }

  toLocal(body, p, out) {
    const t = body.translation(), r = body.rotation();
    return out.set(p.x - t.x, p.y - t.y, p.z - t.z).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert());
  }

  toWorld(body, local, out) {
    const t = body.translation(), r = body.rotation();
    return out.copy(local).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(t);
  }

  /** What the aim hits, as one end of a link. */
  pick(origin, dir) {
    const hit = this.ctx.raycast(origin, dir, 30);
    const body = hit?.collider.parent();
    if (!body) return null;
    const owner = this.ctx.owners.get(hit.collider.handle);
    if (owner?.kind === 'part') owner.ragdoll.goLimp(2.5);
    const at = new THREE.Vector3().copy(origin).addScaledVector(dir, hit.timeOfImpact);
    return { body, local: this.toLocal(body, at, new THREE.Vector3()), at };
  }

  /** A click with a tool in hand. */
  use(kind, origin, dir) {
    const end = this.pick(origin, dir);
    if (!end) return;
    const a = this.first;
    if (!a || !this.alive(a.body)) {
      this.first = end;
      this.ctx.sfx.tick();
      this.ctx.toast(`${kind === 'rope' ? 'ROPE' : 'WELD'}: now the other end`);
      return;
    }
    this.first = null;
    if (a.body.handle === end.body.handle || (a.body.isFixed() && end.body.isFixed())) { this.ctx.toast('NOTHING TO TIE'); return; }
    this.link(kind, a, end);
    this.ctx.sfx[kind === 'rope' ? 'slash' : 'crack']();
  }

  link(kind, a, b) {
    const { world, scene } = this.ctx;
    let data;
    if (kind === 'rope') data = RAPIER.JointData.rope(Math.max(0.05, a.at.distanceTo(b.at)), a.local, b.local);
    else {
      // the joint's frame is the world's, at the second point: each body keeps how it sits against it now
      const ra = a.body.rotation(), rb = b.body.rotation();
      data = RAPIER.JointData.fixed(this.toLocal(a.body, b.at, new THREE.Vector3()), { x: -ra.x, y: -ra.y, z: -ra.z, w: ra.w },
        b.local, { x: -rb.x, y: -rb.y, z: -rb.z, w: rb.w });
    }
    const joint = world.createImpulseJoint(data, a.body, b.body, true);
    joint.setContactsEnabled(false);          // (welded things would otherwise fight where they touch)
    const mesh = new THREE.Mesh(kind === 'rope' ? this.ropeGeo : this.weldGeo, kind === 'rope' ? this.ropeMat : this.weldMat);
    mesh.castShadow = kind === 'rope';
    scene.add(mesh);
    this.links.push({ kind, joint, a: { body: a.body, local: a.local }, b: { body: b.body, local: b.local }, mesh });
    while (this.links.length > MAX_LINKS) this.drop(0);
  }

  drop(i) {
    const l = this.links[i];
    if (this.ctx.world.getImpulseJoint(l.joint.handle)) this.ctx.world.removeImpulseJoint(l.joint, true);
    this.ctx.scene.remove(l.mesh);
    this.links.splice(i, 1);
  }

  /** Right-click: every link on what you point at, or the newest. */
  unlink(origin, dir) {
    const hit = this.ctx.raycast(origin, dir, 30);
    const body = hit?.collider.parent();
    const before = this.links.length;
    // (the whole map is one body: there, only the links tied near where you point)
    const at = body?.isFixed() ? this.toLocal(body, _a.copy(origin).addScaledVector(dir, hit.timeOfImpact), new THREE.Vector3()) : null;
    const on = (end) => end.body.handle === body.handle && (!at || end.local.distanceTo(at) < 0.6);
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i];
      if (body && (on(l.a) || on(l.b))) this.drop(i);
    }
    if (this.links.length === before && before) this.drop(before - 1);
    this.first = null;
    if (this.links.length !== before) { this.ctx.sfx.pop(); this.ctx.toast('UNTIED'); }
  }

  clear() {
    while (this.links.length) this.drop(0);
    this.first = null;
  }

  /** After the physics step: drop links that lost an end, and draw the rest where their ends are now. */
  update() {
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i];
      if (!this.alive(l.a.body) || !this.alive(l.b.body) || !this.ctx.world.getImpulseJoint(l.joint.handle)) { this.drop(i); continue; }
      this.toWorld(l.a.body, l.a.local, _a);
      this.toWorld(l.b.body, l.b.local, _b);
      if (l.kind === 'rope') {
        l.mesh.position.copy(_a);
        l.mesh.lookAt(_b);
        l.mesh.scale.set(1, 1, Math.max(0.01, _a.distanceTo(_b)));
      } else l.mesh.position.copy(_b);
    }
    const f = this.first;
    this.marker.visible = !!f && this.alive(f.body);
    if (this.marker.visible) this.toWorld(f.body, f.local, this.marker.position);
  }
}
