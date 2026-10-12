"""The modelling kit every IMPACTBOX model is built with. Loaded by build_models.py.

A model is assembled from primitives (boxes, lathed profiles, extruded outlines, swept tubes,
lofts, subdivision cages). Each primitive gets texture coordinates in metres as it is made, so
the game can lay fine tiling detail (steel, polymer, wood grain, cloth) over it at a true scale.

When a model is finished three things are baked into its vertices:
  normals  - area-weighted, so bevelled edges catch the light like machined or moulded parts
  shading  - ambient occlusion: creases, recesses and contact lines are darker   (colour RGB)
  wear     - exposed convex edges where paint and bluing rub off                 (colour alpha)
The game multiplies the material colour by the RGB and shows bare material where alpha is low.
"""
import bpy
import bmesh
import math
import os
import time
from math import pi, sin, cos, tan, radians, sqrt, atan2, hypot
from mathutils import Matrix, Euler, Vector, noise as mnoise
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(bpy.data.filepath))
ONLY = globals().get('ONLY')          # set of model names to (re)build, or None for everything
FAST = globals().get('FAST', False)   # skip the slow baking while shaping a model

AXIS_Y = (pi / 2, 0, 0)    # rotate a Z-axis primitive so it lies along Y (its +Z end faces -Y)
AXIS_YF = (-pi / 2, 0, 0)  # ... along Y with its +Z end facing +Y (forward)
AXIS_X = (0, pi / 2, 0)    # ... along X


def xf(loc=(0, 0, 0), rot=(0, 0, 0)):
    return Matrix.Translation(loc) @ Euler(rot).to_matrix().to_4x4()


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smoothstep(a, b, x):
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def collection(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


# ------------------------------------------------------------------ materials
MAT = {}   # name -> baking info


def material(name, color, rough=0.6, metal=0.0, emit=0.0, coat=0.0, detail=None, tile=0.1,
             wear=None, wearable=0.0, dirt=0.06, ao=0.75, bump=1.0):
    """detail   - which tiling surface the game lays over it (see textures.js), tile = its size in metres
    wear     - (r, g, b, metal, rough) of what shows where the surface is worn through
    wearable - how readily edges wear (0 = never)
    dirt     - how much the colour mottles; ao = how dark creases get; bump = normal-map strength"""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
            nt.nodes.remove(n)
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Coat Weight'].default_value = coat
    bsdf.inputs['Coat Roughness'].default_value = 0.06 if coat else 0.03   # 0.03 is Blender's default: no extension written
    bsdf.inputs['Emission Color'].default_value = (*color, 1) if emit else (0, 0, 0, 1)
    bsdf.inputs['Emission Strength'].default_value = emit
    m.diffuse_color = (*color, 1)
    # read by the game (glTF "extras")
    for k in ('detail', 'tile', 'wear', 'bump'):
        if k in m:
            del m[k]
    if detail:
        m['detail'] = detail
        m['tile'] = tile
        m['bump'] = bump
    if wear:
        m['wear'] = list(wear)
    MAT[name] = dict(color=color, rough=rough, metal=metal, wear=wear, wearable=wearable if wear else 0.0,
                     dirt=dirt, ao=ao)
    return m


def preview_nodes(on):
    """Wire the baked vertex colours into every material so Blender's viewport shows what the game
    will. They are unwired again for export, which wants plain numbers on the shader."""
    for name, info in MAT.items():
        m = bpy.data.materials.get(name)
        if not m:
            continue
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        for n in list(nt.nodes):
            if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
                nt.nodes.remove(n)
        if not on:
            continue
        col = nt.nodes.new('ShaderNodeVertexColor')
        col.layer_name = 'Col'
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs[0].default_value = 1.0
        mul.inputs[6].default_value = (*info['color'], 1)
        nt.links.new(col.outputs['Color'], mul.inputs[7])
        out = mul.outputs[2]
        if info['wear']:
            w = info['wear']
            inv = nt.nodes.new('ShaderNodeMath')
            inv.operation = 'SUBTRACT'
            inv.inputs[0].default_value = 1.0
            nt.links.new(col.outputs['Alpha'], inv.inputs[1])
            mixc = nt.nodes.new('ShaderNodeMix')
            mixc.data_type = 'RGBA'
            nt.links.new(inv.outputs[0], mixc.inputs[0])
            nt.links.new(out, mixc.inputs[6])
            mixc.inputs[7].default_value = (w[0], w[1], w[2], 1)
            out = mixc.outputs[2]
            for sock, a, b in (('Metallic', info['metal'], w[3]), ('Roughness', info['rough'], w[4])):
                mx = nt.nodes.new('ShaderNodeMix')
                mx.data_type = 'FLOAT'
                nt.links.new(inv.outputs[0], mx.inputs[0])
                mx.inputs[2].default_value = a
                mx.inputs[3].default_value = b
                nt.links.new(mx.outputs[0], bsdf.inputs[sock])
        nt.links.new(out, bsdf.inputs['Base Color'])


# ------------------------------------------------------------------ texture coordinates
def _uv_box(pb, uvl, grain=None):
    """Project each face along the axis it faces most. `grain` is the local axis (0, 1, 2) that the
    U direction should follow where it can - wood grain and brushing run along U."""
    if grain is None:
        xs = [v.co for v in pb.verts]
        ext = [max(c[i] for c in xs) - min(c[i] for c in xs) for i in range(3)]
        grain = ext.index(max(ext))
    for f in pb.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][ax]
        if b == grain:
            a, b = b, a
        for l in f.loops:
            l[uvl].uv = (l.vert.co[a], l.vert.co[b])


def _uv_round(pb, uvl, r=None):
    """Cylindrical mapping about local Z: U runs along the axis, V around it (in metres)."""
    if r is None:
        rs = [hypot(v.co.x, v.co.y) for v in pb.verts]
        r = max(0.002, sum(rs) / len(rs))
    for f in pb.faces:
        if abs(f.normal.z) > 0.92:
            for l in f.loops:
                l[uvl].uv = (l.vert.co.x, l.vert.co.y)
            continue
        c = f.calc_center_median()
        ca = atan2(c.y, c.x)
        for l in f.loops:
            a = atan2(l.vert.co.y, l.vert.co.x)
            if a - ca > pi:
                a -= 2 * pi
            elif a - ca < -pi:
                a += 2 * pi
            l[uvl].uv = (l.vert.co.z, a * r)


# ------------------------------------------------------------------ mesh builder
class Model:
    """Accumulates primitives into one mesh with per-face materials."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uvl = self.bm.loops.layers.uv.new('UVMap')
        self.tintl = self.bm.loops.layers.float_color.new('Tint')
        self.wearl = self.bm.faces.layers.float.new('wear')
        self.partl = self.bm.faces.layers.int.new('part')
        self.mats = []
        self.part = 0          # tag given to the faces of the primitives that follow
        self.verts_of = []     # (first vertex index, count) per primitive, for callers that deform later

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    # -- a primitive is built in its own little bmesh in local space, then copied in
    def _new(self):
        pb = bmesh.new()
        pb.loops.layers.uv.new('UVMap')
        return pb

    def _emit(self, pb, m, loc=(0, 0, 0), rot=(0, 0, 0), uv='box', grain=None, flat=False, tint=1.0, wear=1.0,
              matrix=None, uv_r=None):
        pb.normal_update()
        puv = pb.loops.layers.uv[0]
        if uv == 'box':
            _uv_box(pb, puv, grain)
        elif uv == 'round':
            _uv_round(pb, puv, uv_r)
        mx = matrix if matrix is not None else xf(loc, rot)
        if not isinstance(tint, (tuple, list)):
            tint = (tint, tint, tint)
        idx = self._mi(m)
        bm = self.bm
        first = len(bm.verts)
        new = [bm.verts.new(mx @ v.co) for v in pb.verts]
        pb.verts.index_update()
        flip = mx.determinant() < 0
        for f in pb.faces:
            vs = [new[v.index] for v in f.verts]
            uvs = [l[puv].uv.copy() for l in f.loops]
            if flip:
                vs.reverse()
                uvs.reverse()
            try:
                nf = bm.faces.new(vs)
            except ValueError:
                continue
            nf.material_index = idx
            nf.smooth = not flat and f.smooth
            nf[self.wearl] = wear
            nf[self.partl] = self.part
            for l, t in zip(nf.loops, uvs):
                l[self.uvl].uv = t
                l[self.tintl] = (tint[0], tint[1], tint[2], 1.0)
        pb.free()
        self.verts_of.append((first, len(new)))
        return self

    @staticmethod
    def _bevel(pb, edges, amount, seg=2):
        if amount > 0 and edges:
            r = bmesh.ops.bevel(pb, geom=list(edges), offset=amount, offset_type='OFFSET', segments=seg,
                                profile=0.5, affect='EDGES', clamp_overlap=True)
            for f in r['faces']:
                f.smooth = True
        for f in pb.faces:
            f.smooth = True

    # ---------------------------------------------------------------- primitives
    def box(self, size, loc, m, rot=(0, 0, 0), bevel=0.0, taper=(1, 1), seg=2, shear=0.0, **kw):
        """taper = (x, y) scale applied to the top (+Z) face; shear = how far the top slides along +Y."""
        pb = self._new()
        verts = bmesh.ops.create_cube(pb, size=1.0)['verts']
        for v in verts:
            top = v.co.z > 0
            v.co.x *= size[0] * (taper[0] if top else 1)
            v.co.y *= size[1] * (taper[1] if top else 1)
            v.co.y += shear * (0.5 if top else -0.5)
            v.co.z *= size[2]
        self._bevel(pb, pb.edges, bevel, seg)
        return self._emit(pb, m, loc, rot, **kw)

    def cyl(self, r, depth, loc, m, rot=(0, 0, 0), r2=None, seg=None, bevel=0.0, bseg=2, **kw):
        """Z-axis cylinder / cone. r = bottom radius, r2 = top radius."""
        seg = seg or int(clamp(max(r, r2 or 0) * 500 + 10, 10, 32))
        pb = self._new()
        verts = bmesh.ops.create_cone(pb, cap_ends=True, cap_tris=False, segments=seg,
                                      radius1=r, radius2=r if r2 is None else r2, depth=depth)['verts']
        rim = {e for e in pb.edges if (e.verts[0].co.z > 0) == (e.verts[1].co.z > 0)}
        self._bevel(pb, rim, bevel, bseg)
        kw.setdefault('uv', 'round')
        return self._emit(pb, m, loc, rot, **kw)

    def lathe(self, profile, loc, m, rot=(0, 0, 0), seg=24, closed=False, arc=None, **kw):
        """Spin a profile of (radius, z) points about Z. A radius of 0 at either end closes to a point;
        otherwise the ends are capped. closed=True joins the last point to the first (rings, tubes).
        arc = (start, end) in radians for a partial turn (left open)."""
        pb = self._new()
        n = len(profile)
        a0, a1 = arc if arc else (0.0, 2 * pi)
        steps = seg if not arc else seg + 1
        cols = []
        for i in range(steps):
            a = a0 + (a1 - a0) * i / seg
            col = []
            for r, z in profile:
                if r <= 1e-7:
                    col.append(None)
                else:
                    col.append(pb.verts.new((r * cos(a), r * sin(a), z)))
            cols.append(col)
        poles = {j: pb.verts.new((0, 0, z)) for j, (r, z) in enumerate(profile) if r <= 1e-7}
        span = n if closed else n - 1
        wrap = steps if not arc else steps - 1
        for i in range(wrap):
            c0, c1 = cols[i], cols[(i + 1) % steps]
            for j in range(span):
                k = (j + 1) % n
                quad = [c0[j] or poles[j], c1[j] or poles[j], c1[k] or poles[k], c0[k] or poles[k]]
                vs = []
                for v in quad:
                    if v not in vs:
                        vs.append(v)
                if len(vs) >= 3:
                    pb.faces.new(vs)
        if not closed and not arc:
            if profile[0][0] > 1e-7:
                pb.faces.new([c[0] for c in reversed(cols)])
            if profile[-1][0] > 1e-7:
                pb.faces.new([c[-1] for c in cols])
        bmesh.ops.recalc_face_normals(pb, faces=pb.faces)
        for f in pb.faces:
            f.smooth = True
        kw.setdefault('uv', 'round')
        return self._emit(pb, m, loc, rot, **kw)

    def tube(self, r, r_in, depth, loc, m, rot=(0, 0, 0), seg=None, chamfer=0.0, **kw):
        """A pipe with a real bore (gun barrels, rings, collars)."""
        seg = seg or int(clamp(r * 500 + 10, 10, 32))
        h = depth / 2
        c = min(chamfer, (r - r_in) * 0.45, h * 0.45)
        if c > 0:
            prof = [(r_in, -h), (r - c, -h), (r, -h + c), (r, h - c), (r - c, h), (r_in, h)]
        else:
            prof = [(r_in, -h), (r, -h), (r, h), (r_in, h)]
        return self.lathe(prof, loc, m, rot, seg=seg, closed=True, **kw)

    def sphere(self, r, loc, m, scale=(1, 1, 1), rot=(0, 0, 0), seg=20, rings=12, keep=None, warp=None, **kw):
        """keep = optional predicate on the unscaled vertex position; other verts are deleted.
        warp = optional function that reshapes each vertex position in place (sculpting)."""
        pb = self._new()
        verts = bmesh.ops.create_uvsphere(pb, u_segments=seg, v_segments=rings, radius=r)['verts']
        if keep:
            drop = [v for v in verts if not keep(v.co)]
            verts = [v for v in verts if keep(v.co)]
            bmesh.ops.delete(pb, geom=drop, context='VERTS')
        for v in verts:
            if warp:
                warp(v.co)
            v.co.x *= scale[0]; v.co.y *= scale[1]; v.co.z *= scale[2]
        for f in pb.faces:
            f.smooth = True
        return self._emit(pb, m, loc, rot, **kw)

    def capsule(self, r, h, loc, m, rot=(0, 0, 0), seg=16, taper_bottom=1.0, taper_top=1.0, rings=10, **kw):
        """Z-axis capsule, h = half length of the straight section (matches Rapier's capsule)."""
        pb = self._new()
        verts = bmesh.ops.create_uvsphere(pb, u_segments=seg, v_segments=rings, radius=r)['verts']
        for v in verts:
            if v.co.z > 0:
                v.co.x *= taper_top; v.co.y *= taper_top
                v.co.z = v.co.z * taper_top + h
            else:
                v.co.x *= taper_bottom; v.co.y *= taper_bottom
                v.co.z = v.co.z * taper_bottom - h
        for f in pb.faces:
            f.smooth = True
        kw.setdefault('uv', 'round')
        return self._emit(pb, m, loc, rot, **kw)

    def limb(self, p0, p1, r, m, r2=None, seg=12, rings=8, **kw):
        """Capsule between two points; r2 = radius at the p1 end."""
        a, b = Vector(p0), Vector(p1)
        d = b - a
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
        return self.capsule(r, d.length / 2, (a + b) / 2, m, rot=rot, seg=seg, rings=rings,
                            taper_top=(r2 / r) if r2 else 1.0, **kw)

    def torus(self, R, r, loc, m, rot=(0, 0, 0), seg=24, sub=8, arc=None, **kw):
        """arc = (start, end) in radians for a partial ring with capped ends."""
        pb = self._new()
        a0, a1 = arc if arc else (0.0, 2 * pi)
        steps = seg + 1 if arc else seg
        rings = []
        for i in range(steps):
            a = a0 + (a1 - a0) * i / seg
            rings.append([pb.verts.new(((R + r * cos(2 * pi * j / sub)) * cos(a),
                                        (R + r * cos(2 * pi * j / sub)) * sin(a),
                                        r * sin(2 * pi * j / sub))) for j in range(sub)])
        for i in range(steps - 1 if arc else steps):
            for j in range(sub):
                pb.faces.new((rings[i][j], rings[(i + 1) % steps][j],
                              rings[(i + 1) % steps][(j + 1) % sub], rings[i][(j + 1) % sub]))
        if arc:
            pb.faces.new(list(reversed(rings[0])))
            pb.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(pb, faces=pb.faces)
        for f in pb.faces:
            f.smooth = True
        kw.setdefault('uv', 'box')
        return self._emit(pb, m, loc, rot, **kw)

    def prism(self, pts, thick, loc, m, rot=(0, 0, 0), bevel=0.0, seg=2, side_bevel=None, taper=None, **kw):
        """Extrude a (y, z) outline along X by `thick`, centred. This is how receivers, grips, stocks
        and blades get their real side profile. bevel rounds the outline edges on both faces;
        side_bevel rounds the corners of the outline itself; taper = (y0, y1, scale): thickness is
        scaled toward `scale` between y0 and y1 (blades, wedges)."""
        pb = self._new()
        a = [pb.verts.new((-thick / 2, y, z)) for y, z in pts]
        b = [pb.verts.new((thick / 2, y, z)) for y, z in pts]
        n = len(pts)
        fa = pb.faces.new(a)
        fb = pb.faces.new(list(reversed(b)))
        for i in range(n):
            pb.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n]))
        pb.edges.ensure_lookup_table()
        if side_bevel:
            cross = [e for e in pb.edges if abs(e.verts[0].co.x - e.verts[1].co.x) > thick * 0.5]
            bmesh.ops.bevel(pb, geom=cross, offset=side_bevel, offset_type='OFFSET', segments=3,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
        if bevel > 0:
            pb.normal_update()
            rim = [e for e in pb.edges if abs(e.verts[0].co.x - e.verts[1].co.x) < 1e-7 and len(e.link_faces) == 2
                   and (abs(e.link_faces[0].normal.x) > 0.9) != (abs(e.link_faces[1].normal.x) > 0.9)]
            bmesh.ops.bevel(pb, geom=rim, offset=bevel, offset_type='OFFSET', segments=seg,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
        if taper:
            y0, y1, s = taper
            for v in pb.verts:
                v.co.x *= lerp(1.0, s, clamp((v.co.y - y0) / (y1 - y0)))
        bmesh.ops.recalc_face_normals(pb, faces=pb.faces)
        for f in pb.faces:
            f.smooth = True
        kw.setdefault('grain', 1)
        return self._emit(pb, m, loc, rot, **kw)

    def sweep(self, path, r, m, loc=(0, 0, 0), rot=(0, 0, 0), seg=8, closed=False, profile=None, smooth=0,
              up=(0, 0, 1), **kw):
        """Run a cross-section along a path of points (cables, handles, straps, guards, pipes).
        r is one radius or one per point. profile = [(a, b), ...] replaces the circle (a is across,
        b is along `up`), e.g. a flat rectangle for a strap. smooth = rounds of corner cutting."""
        pts = [Vector(p) for p in path]
        rs = list(r) if isinstance(r, (list, tuple)) else [r] * len(pts)
        for _ in range(smooth):
            np_, nr = [], []
            n = len(pts)
            rng = range(n) if closed else range(n - 1)
            if not closed:
                np_.append(pts[0]); nr.append(rs[0])
            for i in rng:
                p, q = pts[i], pts[(i + 1) % n]
                np_ += [p.lerp(q, 0.25), p.lerp(q, 0.75)]
                nr += [lerp(rs[i], rs[(i + 1) % n], 0.25), lerp(rs[i], rs[(i + 1) % n], 0.75)]
            if not closed:
                np_.append(pts[-1]); nr.append(rs[-1])
            pts, rs = np_, nr
        n = len(pts)
        pb = self._new()
        upv = Vector(up).normalized()
        rings = []
        prev_side = None
        for i in range(n):
            if closed:
                t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
            else:
                t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            side = t.cross(upv)
            if side.length < 1e-4:
                side = prev_side or t.orthogonal()
            side.normalize()
            if prev_side and side.dot(prev_side) < 0:
                side = -side
            prev_side = side
            nrm = side.cross(t).normalized()
            if profile:
                ring = [pb.verts.new(pts[i] + side * (a * rs[i]) + nrm * (b * rs[i])) for a, b in profile]
            else:
                ring = [pb.verts.new(pts[i] + (side * cos(2 * pi * k / seg) + nrm * sin(2 * pi * k / seg)) * rs[i])
                        for k in range(seg)]
            rings.append(ring)
        k = len(rings[0])
        for i in range(n if closed else n - 1):
            a, b = rings[i], rings[(i + 1) % n]
            for j in range(k):
                pb.faces.new((a[j], a[(j + 1) % k], b[(j + 1) % k], b[j]))
        if not closed:
            pb.faces.new(list(reversed(rings[0])))
            pb.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(pb, faces=pb.faces)
        for f in pb.faces:
            f.smooth = True
        # U along the path, V around the section
        pb.normal_update()
        puv = pb.loops.layers.uv[0]
        dist = [0.0]
        for i in range(1, n):
            dist.append(dist[-1] + (pts[i] - pts[i - 1]).length)
        where = {}
        for i, ring in enumerate(rings):
            for j, v in enumerate(ring):
                where[v] = (i, j)
        girth = 2 * pi * (sum(rs) / len(rs)) if not profile else 4 * (sum(rs) / len(rs))
        for f in pb.faces:
            ij = [where[l.vert] for l in f.loops]
            jmin = min(j for _, j in ij)
            jmax = max(j for _, j in ij)
            imin = min(i for i, _ in ij)
            imax = max(i for i, _ in ij)
            for l, (i, j) in zip(f.loops, ij):
                jj = j + k if (jmax - jmin > k / 2 and j < k / 2) else j
                ii = i + n if (closed and imax - imin > n / 2 and i < n / 2) else i
                u = dist[i] if ii == i else dist[-1] + (pts[0] - pts[-1]).length
                l[puv].uv = (u, jj / k * girth)
        return self._emit(pb, m, loc, rot, uv=None, **kw)

    def loft(self, rings, loc, m, rot=(0, 0, 0), seg=16, cap=True, wrap=True, **kw):
        """Skin a stack of sections along Z. Each ring is (z, rx, ry[, cx, cy]) for an ellipse, or a
        list of (x, y, z) points (every ring the same count). cap: True, False, 'top' or 'bottom'.
        wrap=False treats each ring as an open strip instead of a closed loop."""
        pb = self._new()
        loops = []
        for ring in rings:
            if isinstance(ring[0], (tuple, list, Vector)):
                loops.append([pb.verts.new(p) for p in ring])
                continue
            z, rx, ry = ring[:3]
            cx = ring[3] if len(ring) > 3 else 0.0
            cy = ring[4] if len(ring) > 4 else 0.0
            loops.append([pb.verts.new((cx + rx * cos(2 * pi * i / seg), cy + ry * sin(2 * pi * i / seg), z))
                          for i in range(seg)])
        k = len(loops[0])
        for a, b in zip(loops, loops[1:]):
            for i in range(k if wrap else k - 1):
                pb.faces.new((a[i], a[(i + 1) % k], b[(i + 1) % k], b[i]))
        if cap in (True, 'bottom'):
            pb.faces.new(list(reversed(loops[0])))
        if cap in (True, 'top'):
            pb.faces.new(loops[-1])
        bmesh.ops.recalc_face_normals(pb, faces=pb.faces)
        if cap == 'top' and len(pb.faces):                     # an open shell: make sure it faces away from its middle
            c = sum((v.co for v in pb.verts), Vector()) / len(pb.verts)
            pb.faces.ensure_lookup_table()
            pb.normal_update()
            top = pb.faces[len(pb.faces) - 1]
            if top.normal.dot(top.calc_center_median() - c) < 0:
                bmesh.ops.reverse_faces(pb, faces=pb.faces)
        for f in pb.faces:
            f.smooth = True
        kw.setdefault('uv', 'round')
        return self._emit(pb, m, loc, rot, **kw)

    def shaped(self, stations, m, n=16, power=2.5, x=0.0, ends=0.6, **kw):
        """A rounded solid that follows a path in the centre (YZ) plane: grips, stocks, handguards.
        stations = (y, z, width, depth[, power]) - width is across the gun (X), depth is in the plane,
        square to the path. power 2 = oval, higher = boxier. ends = how far the two ends are rounded
        over (0 leaves them cut flat)."""
        X = Vector((1, 0, 0))
        pts = [Vector((x, s[0], s[1])) for s in stations]
        cnt = len(pts)
        rings = []
        for i, s in enumerate(stations):
            t = (pts[min(i + 1, cnt - 1)] - pts[max(i - 1, 0)]).normalized()
            f = X.cross(t).normalized()
            w, d = s[2] / 2, s[3] / 2
            p = s[4] if len(s) > 4 else power
            ring = []
            for k in range(n):
                a = 2 * pi * k / n
                cx, sy = cos(a), sin(a)
                ring.append(pts[i] + X * (w * math.copysign(abs(cx) ** (2 / p), cx))
                            + f * (d * math.copysign(abs(sy) ** (2 / p), sy)))
            rings.append(ring)
        if ends:
            t0 = (pts[1] - pts[0]).normalized()
            t1 = (pts[-1] - pts[-2]).normalized()
            o0 = min(stations[0][2], stations[0][3]) * 0.2
            o1 = min(stations[-1][2], stations[-1][3]) * 0.2
            rings.insert(0, [pts[0] + (q - pts[0]) * ends - t0 * o0 for q in rings[0]])
            rings.append([pts[-1] + (q - pts[-1]) * ends + t1 * o1 for q in rings[-1]])
        kw.setdefault('uv', 'box')
        kw.setdefault('grain', 1)
        return self.loft(rings, (0, 0, 0), m, **kw)

    def blade(self, stations, m, x=0.0, flat=0.45, **kw):
        """A ground blade lying in the centre plane. stations = (y, z_spine, z_edge, thickness):
        full thickness from the spine down to `flat` of the way to the edge, then ground to nothing."""
        rings = []
        for y, zs, ze, t in stations:
            zb = lerp(ze, zs, flat)
            h = t / 2
            rings.append([(x - h, y, zs), (x + h, y, zs), (x + h, y, zb), (x, y, ze), (x - h, y, zb)])
        kw.setdefault('uv', 'box')
        kw.setdefault('grain', 1)
        return self.loft(rings, (0, 0, 0), m, **kw)

    def gear(self, r, depth, loc, m, rot=(0, 0, 0), teeth=18, cut=0.0009, bevel=0.0, **kw):
        """A knurled knob or toothed wheel: a cylinder whose rim alternates between r and r - cut."""
        pb = self._new()
        n = teeth * 2
        ring = [((r - (cut if (i // 1) % 2 else 0.0)) * cos(2 * pi * i / n),
                 (r - (cut if (i // 1) % 2 else 0.0)) * sin(2 * pi * i / n)) for i in range(n)]
        a = [pb.verts.new((x_, y_, -depth / 2)) for x_, y_ in ring]
        b = [pb.verts.new((x_, y_, depth / 2)) for x_, y_ in ring]
        pb.faces.new(list(reversed(a)))
        pb.faces.new(b)
        for i in range(n):
            pb.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
        if bevel:
            rim = [e for e in pb.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-7]
            bmesh.ops.bevel(pb, geom=rim, offset=bevel, offset_type='OFFSET', segments=1, profile=0.5,
                            affect='EDGES', clamp_overlap=True)
        bmesh.ops.recalc_face_normals(pb, faces=pb.faces)
        for f in pb.faces:
            f.smooth = False
        kw.setdefault('uv', 'round')
        return self._emit(pb, m, loc, rot, flat=True, **kw)

    def rail(self, y0, y1, z, m, w=0.0212, x=0.0, up=1):
        """A slotted accessory rail along Y with its top at z (up = -1 hangs it underneath)."""
        n = max(1, int((y1 - y0) / 0.01))
        self.box((w * 0.72, y1 - y0, 0.004), (x, (y0 + y1) / 2, z - up * 0.0062), m)
        for i in range(n):
            y = y0 + (i + 0.5) * (y1 - y0) / n
            self.box((w, 0.0052, 0.0044), (x, y, z - up * 0.0022), m, bevel=0.0007, seg=1, taper=(0.86, 1) if up > 0 else (1, 1),
                     wear=0.5)
        return self

    def chain(self, pts, r, m, seg=10, **kw):
        """A bent rod: one swept tube through the points with rounded ends."""
        return self.sweep(pts, r, m, seg=seg, smooth=1, **kw)

    def cage(self, build, loc, m, rot=(0, 0, 0), levels=2, crease=None, **kw):
        """Subdivision surface. `build(bm)` makes a coarse cage; it is smoothed `levels` times
        (Catmull-Clark). crease = predicate on an edge that keeps it sharp."""
        cb = bmesh.new()
        build(cb)
        bmesh.ops.recalc_face_normals(cb, faces=cb.faces)
        me = bpy.data.meshes.new('_cage')
        if crease:
            cl = cb.edges.layers.float.new('crease_edge')
            for e in cb.edges:
                if crease(e):
                    e[cl] = 1.0
        cb.to_mesh(me)
        cb.free()
        ob = bpy.data.objects.new('_cage', me)
        bpy.context.scene.collection.objects.link(ob)
        mod = ob.modifiers.new('s', 'SUBSURF')
        mod.levels = levels
        mod.render_levels = levels
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        tmp = bpy.data.meshes.new_from_object(ev)
        pb = self._new()
        pb.from_mesh(tmp)
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.meshes.remove(me)
        bpy.data.meshes.remove(tmp)
        for f in pb.faces:
            f.smooth = True
        return self._emit(pb, m, loc, rot, **kw)

    def raw(self, build, loc, m, rot=(0, 0, 0), **kw):
        """Escape hatch: `build(bm)` fills a bmesh directly."""
        pb = self._new()
        build(pb)
        bmesh.ops.recalc_face_normals(pb, faces=pb.faces)
        for f in pb.faces:
            f.smooth = True
        return self._emit(pb, m, loc, rot, **kw)

    # ---------------------------------------------------------------- finishing
    def finish(self, coll, loc=(0, 0, 0), sharp=38.0, ground=False, ao_dist=None, ao=True, wear=1.0):
        """sharp = edges steeper than this many degrees stay hard. ground = the model stands on a
        floor at its lowest point (props), which darkens what faces it."""
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        bm.verts.index_update()
        bm.faces.index_update()
        bm.normal_update()
        normals = weighted_normals(bm, radians(sharp))
        colors = bake_colors(bm, normals, self.mats, self.tintl, self.wearl, ground=ground, dist=ao_dist,
                             do_ao=ao and not FAST, wear_scale=wear)
        old = bpy.data.objects.get(self.name)
        if old:
            om = old.data
            bpy.data.objects.remove(old, do_unlink=True)
            if om.users == 0:
                bpy.data.meshes.remove(om)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        for junk in ('Tint', 'wear', 'part'):
            a = me.attributes.get(junk)
            if a:
                me.attributes.remove(a)
        me.normals_split_custom_set(normals)
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        ca.data.foreach_set('color', [c for col in colors for c in col])
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
        ob = bpy.data.objects.new(self.name, me)
        ob.location = loc
        coll.objects.link(ob)
        return ob


def weighted_normals(bm, angle):
    """One normal per face corner: the area-weighted average of the faces round that vertex that lie
    within `angle` of this face. Big flat faces win, so bevels read as bevels."""
    ca = cos(angle)
    area = [f.calc_area() for f in bm.faces]
    out = []
    for f in bm.faces:
        fn = f.normal
        for l in f.loops:
            if not f.smooth:
                out.append(fn.copy())
                continue
            n = Vector((0, 0, 0))
            for g in l.vert.link_faces:
                if g.smooth and g.normal.dot(fn) >= ca:
                    n += g.normal * area[g.index]
            out.append(n.normalized() if n.length > 1e-12 else fn.copy())
    return out


_AO_DIRS = []
for _i in range(28):                       # cosine-weighted directions over a hemisphere (z up)
    _u = (_i + 0.5) / 28
    _a = _i * 2.399963
    _r = sqrt(_u)
    _AO_DIRS.append((_r * cos(_a), _r * sin(_a), sqrt(1 - _u)))


def bake_colors(bm, normals, mats, tintl, wearl, ground=False, dist=None, do_ao=True, wear_scale=1.0):
    """Per face corner (r, g, b, a): rgb = tint * ambient occlusion * mottling, a = 1 - edge wear."""
    if not len(bm.faces):
        return []
    lo = Vector((min(v.co.x for v in bm.verts), min(v.co.y for v in bm.verts), min(v.co.z for v in bm.verts)))
    hi = Vector((max(v.co.x for v in bm.verts), max(v.co.y for v in bm.verts), max(v.co.z for v in bm.verts)))
    size = (hi - lo).length
    if dist is None:
        dist = clamp(size * 0.22, 0.03, 0.45)
    eps = max(1e-5, size * 2e-4)
    bvh = BVHTree.FromBMesh(bm) if do_ao else None
    info = [MAT.get(m.name, dict(wearable=0, dirt=0.05, ao=0.7)) for m in mats]

    # how exposed each vertex is: spread of the normals of the faces around it, convex only
    convex = [0.0] * len(bm.verts)
    for v in bm.verts:
        fs = v.link_faces
        if len(fs) < 2:
            continue
        s = Vector((0, 0, 0))
        tot = 0.0
        for f in fs:
            s += f.normal
            tot += 1
        spread = 1.0 - s.length / tot
        if spread < 1e-4:
            continue
        cx = sum(1 for e in v.link_edges if e.is_convex and len(e.link_faces) == 2) >= max(1, len(v.link_edges) - 1)
        convex[v.index] = spread if cx else 0.0

    cache = {}
    out = []
    li = 0
    for f in bm.faces:
        mi = info[f.material_index] if f.material_index < len(info) else info[0]
        fw = f[wearl] * mi['wearable'] * wear_scale
        for l in f.loops:
            n = normals[li]
            li += 1
            v = l.vert
            ao = 1.0
            if do_ao:
                key = (v.index, round(n.x, 1), round(n.y, 1), round(n.z, 1))
                ao = cache.get(key)
                if ao is None:
                    t = n.orthogonal().normalized()
                    b = n.cross(t)
                    o = v.co + n * eps
                    occ = 0.0
                    for dx, dy, dz in _AO_DIRS:
                        d = t * dx + b * dy + n * dz
                        hit = bvh.ray_cast(o, d, dist)
                        hd = hit[3] if hit[0] is not None else None
                        if ground and d.z < -1e-3:
                            g = (lo.z - o.z) / d.z
                            if g < dist and (hd is None or g < hd):
                                hd = max(g, 0.0)
                        if hd is not None:
                            occ += 1.0 - 0.7 * (hd / dist)
                    ao = 1.0 - occ / len(_AO_DIRS)
                    cache[key] = ao
            shade = lerp(1.0 - mi['ao'], 1.0, clamp(ao) ** 1.3)
            p = v.co
            if mi['dirt'] > 0:
                mott = mnoise.noise(p * 9.0) * 0.6 + mnoise.noise(p * 31.0) * 0.4
                shade *= 1.0 - mi['dirt'] * (0.5 + 0.5 * mott) - mi['dirt'] * 1.5 * (1 - clamp(ao)) ** 2
            w = 0.0
            if fw > 0:
                c = convex[v.index]
                if c > 0:
                    # worn in patches, not all the way along: broad noise picks the stretches, fine noise frays them
                    patch = 0.5 + 0.5 * mnoise.noise(p * 23.0) + 0.25 * mnoise.noise(p * 90.0)
                    edge = smoothstep(0.006, 0.05, c) + 0.6 * smoothstep(0.08, 0.3, c)     # corners wear first
                    w = clamp(edge * smoothstep(0.42, 0.85, patch + 0.25 * (fw - 1.0)) * min(fw, 1.0))
            tint = l[tintl]
            out.append((tint[0] * shade, tint[1] * shade, tint[2] * shade, 1.0 - w))
    return out


# ------------------------------------------------------------------ registering models
BUILT = []


def model(name, coll, loc=(0, 0, 0), **finish):
    """Decorator: the function receives a Model and adds primitives; it is then finished and placed."""
    def deco(fn):
        if ONLY is not None and name not in ONLY:
            return fn
        t0 = time.time()
        m = Model(name)
        fn(m)
        ob = m.finish(collection(coll), loc, **finish)
        BUILT.append((name, len(ob.data.polygons), round(time.time() - t0, 1)))
        return fn
    return deco


# ------------------------------------------------------------------ studio (preview renders only)
def studio():
    stage = collection('Stage')
    scn = bpy.context.scene
    for n in ('Sun', 'Fill', 'Camera'):
        o = bpy.data.objects.get(n)
        if o:
            bpy.data.objects.remove(o, do_unlink=True)
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.4
    sun.data.angle = radians(3)
    sun.rotation_euler = (radians(52), 0, radians(35))
    stage.objects.link(sun)
    fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'SUN'))
    fill.data.energy = 0.7
    fill.rotation_euler = (radians(65), 0, radians(-140))
    stage.objects.link(fill)
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    stage.objects.link(cam)
    scn.camera = cam
    world = scn.world or bpy.data.worlds.new('World')
    scn.world = world
    world.use_nodes = True
    nt = world.node_tree
    # the camera sees flat grey; reflections and fill light see a sky-to-ground gradient
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    mp = nt.nodes.new('ShaderNodeMapRange')
    mp.inputs[1].default_value = -1.0
    mp.inputs[2].default_value = 1.0
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.0, (0.10, 0.09, 0.08, 1)
    e[1].position, e[1].color = 1.0, (0.20, 0.36, 0.70, 1)
    for pos, colr in ((0.47, (0.16, 0.15, 0.14, 1)), (0.52, (0.80, 0.84, 0.90, 1)), (0.68, (0.42, 0.56, 0.82, 1))):
        el = e.new(pos)
        el.color = colr
    lp = nt.nodes.new('ShaderNodeLightPath')
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs[7].default_value = (0.30, 0.31, 0.33, 1)
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mp.inputs[0])
    nt.links.new(mp.outputs[0], ramp.inputs[0])
    nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs[0])
    nt.links.new(ramp.outputs[0], mix.inputs[6])
    nt.links.new(mix.outputs[2], bg.inputs[0])
    bg.inputs[1].default_value = 0.55
    nt.links.new(bg.outputs[0], out.inputs[0])
    return cam


def shot(names, path, view=(1, -1.4, 0.6), res=(960, 640), lens=70, margin=1.12, hide_others=True, focus=None):
    """Render the named objects from direction `view` (camera sits along it) into a PNG."""
    scn = bpy.context.scene
    cam = scn.camera or studio()
    bpy.context.view_layer.update()
    scn.view_settings.view_transform = 'Standard'
    obs = [bpy.data.objects[n] for n in names if n in bpy.data.objects]
    if hide_others:
        for o in bpy.data.objects:
            if o.type == 'MESH':
                o.hide_render = o not in obs
    pts = [o.matrix_world @ Vector(c) for o in obs for c in o.bound_box]
    if focus:                                  # (offset from the first object's origin, half size): frame just that
        fc = obs[0].matrix_world.translation + Vector(focus[0])
        pts = [fc + Vector((sx, sy, sz)) * focus[1] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    d = Vector(view).normalized()
    cam.data.lens = lens
    cam.data.sensor_width = 36
    cam.data.sensor_fit = 'HORIZONTAL'      # so tall pictures are framed by the same sum as wide ones
    rot = d.to_track_quat('Z', 'Y')
    cam.rotation_euler = rot.to_euler()
    right = rot @ Vector((1, 0, 0))
    upv = rot @ Vector((0, 1, 0))
    w = max(abs((p - c).dot(right)) for p in pts) * 2
    h = max(abs((p - c).dot(upv)) for p in pts) * 2
    aspect = res[0] / res[1]
    fov_w = 2 * math.atan(18 / lens)
    need = max(w, h * aspect) * margin
    distance = need / (2 * tan(fov_w / 2)) + max(abs((p - c).dot(d)) for p in pts)
    cam.location = c + d * distance
    cam.data.clip_start = max(0.001, distance * 0.01)
    cam.data.clip_end = distance * 10 + 10
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.resolution_percentage = 100
    scn.render.filepath = path
    scn.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    return path


# ------------------------------------------------------------------ export
def export_glb(objs, out):
    """Write the given objects to one GLB: positions, baked normals, UVs in metres, the 'Col'
    vertex colours, any custom attributes whose name starts with an underscore, and each
    material's custom properties (which is how the game learns its surface detail and wear)."""
    preview_nodes(False)
    for o in bpy.data.objects:
        o.hide_set(False)
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    import io, contextlib
    with contextlib.redirect_stdout(io.StringIO()):          # the exporter logs a line per mesh
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_apply=False,
                                  export_yup=True, export_normals=True, export_tangents=False,
                                  export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                                  export_active_vertex_color_when_no_material=True,
                                  export_attributes=True, export_extras=True, export_skins=False,
                                  export_animations=False, export_materials='EXPORT')
    preview_nodes(True)
    return os.path.getsize(out)
