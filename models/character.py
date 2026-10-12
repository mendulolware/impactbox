"""The NPC body: one continuous, skinned figure in T-shirt, jeans and trainers.

It is modelled standing at rest (feet at the origin, facing +Y, arms at the sides) as a set of
shells - torso, arms, legs, neck, head - whose surfaces run unbroken through the elbows, knees,
waist, shoulders, hips and neck. Every vertex is weighted to at most two of the game's eleven
ragdoll bodies, so the surface bends with them instead of showing a row of separate parts.

The figure is then cut into eleven objects (Body_pelvis, Body_torso, ...) along the joint planes,
because the game treats each ragdoll body separately: it can be shot full of holes, severed, or
blown off. Each cut is closed with a cap of flesh and bone that is hidden until the joint parts.

Exported per vertex, besides the usual: _skin = (bone A, bone B, weight of A). Bone order = BONES,
the same order as PARTS in ragdoll.js. "L" is the +X side, as in the game.
"""
import random

BONES = ['pelvis', 'torso', 'head', 'uarmL', 'farmL', 'uarmR', 'farmR', 'thighL', 'shinL', 'thighR', 'shinR']
B = {n: i for i, n in enumerate(BONES)}
MIRROR = {B['uarmL']: B['uarmR'], B['farmL']: B['farmR'], B['thighL']: B['thighR'], B['shinL']: B['shinR']}
CHAR_AT = (-3.0, 0.0, 0.0)
AX, LX = 0.21, 0.10                         # arm and leg axes (x)
SPINE, NECK, SHOULDER, ELBOW, HIP, KNEE = 1.10, 1.56, 1.45, 1.16, 0.95, 0.46      # joint heights
HEAD = Vector((0, 0, 1.70))


# ------------------------------------------------------------------ small tools
def spline(ctrl, z):
    """Smooth interpolation through rows of (z, a, b, ...) sorted by z."""
    n = len(ctrl)
    if z <= ctrl[0][0]:
        return list(ctrl[0][1:])
    if z >= ctrl[-1][0]:
        return list(ctrl[-1][1:])
    i = 0
    while ctrl[i + 1][0] < z:
        i += 1
    p0, p1, p2, p3 = ctrl[max(i - 1, 0)], ctrl[i], ctrl[i + 1], ctrl[min(i + 2, n - 1)]
    d = p2[0] - p1[0]
    t = (z - p1[0]) / d
    out = []
    for k in range(1, len(p1)):
        m1 = (p2[k] - p0[k]) / (p2[0] - p0[0]) * d
        m2 = (p3[k] - p1[k]) / (p3[0] - p1[0]) * d
        out.append((2 * t ** 3 - 3 * t ** 2 + 1) * p1[k] + (t ** 3 - 2 * t ** 2 + t) * m1
                   + (-2 * t ** 3 + 3 * t ** 2) * p2[k] + (t ** 3 - t ** 2) * m2)
    return out


def levels(z0, z1, step, must=()):
    """Heights from z0 to z1 about `step` apart that include every joint height in `must` exactly."""
    marks = sorted({z0, z1, *[z for z in must if z0 < z < z1]})
    out = []
    for a, b in zip(marks, marks[1:]):
        k = max(1, round((b - a) / step))
        out += [a + (b - a) * i / k for i in range(k)]
    return out + [z1]


def sring(cx, cy, z, rx, ry, n, p=2.0):
    """A horizontal superellipse: p = 2 is an ellipse, higher is boxier."""
    pts = []
    for i in range(n):
        a = 2 * pi * i / n
        c, s = cos(a), sin(a)
        pts.append(Vector((cx + rx * math.copysign(abs(c) ** (2 / p), c), cy + ry * math.copysign(abs(s) ** (2 / p), s), z)))
    return pts


def rigid(b):
    return lambda co: (b, b, 1.0)


def blend(lo, hi, z0, z1, top=1.0):
    """Weight that passes from bone `lo` below z0 to `hi` above z1 (reaching at most `top` of hi)."""
    def f(co):
        w = smoothstep(z0, z1, co.z) * top
        return (hi, lo, w)
    return f


def joint(lo, hi, z, half=0.05):
    return blend(lo, hi, z - half, z + half)


# ------------------------------------------------------------------ the shell builder
def setup(m):
    bm = m.bm
    return dict(ba=bm.verts.layers.int.new('ba'), bb=bm.verts.layers.int.new('bb'), wa=bm.verts.layers.float.new('wa'),
                aog=bm.faces.layers.int.new('aog'), mir=bm.faces.layers.int.new('mir'))


def shell(m, L, rings, mat, parts, weight, cuts=(), ends=('fan', 'fan'), group=0, tint=None, mir=False, inside=False):
    """Skin a stack of rings (lowest first) into m.
    parts(i)  -> which ragdoll body the band above ring i belongs to
    weight(co)-> (bone A, bone B, weight of A)
    cuts      -> ring numbers where a joint passes: both sides get a hidden cap of flesh and bone
    ends      -> 'fan' closes an end, 'open' leaves it
    tint(co)  -> colour multiplier for a vertex (r, g, b)
    inside    -> the surface is seen from within (the turned-in hem of a sleeve)"""
    bm = m.bm
    n = len(rings[0])
    mi = m._mi(mat)

    def vert(p, like=None):
        v = bm.verts.new(p)
        ba, bb, wa = weight(v.co) if like is None else (like[L['ba']], like[L['bb']], like[L['wa']])
        v[L['ba']], v[L['bb']], v[L['wa']] = ba, bb, wa
        return v

    vs = [[vert(p) for p in r] for r in rings]
    cen = [sum(r, Vector()) / n for r in rings]
    along = [0.0]
    for a, b in zip(cen, cen[1:]):
        along.append(along[-1] + (b - a).length)
    girth = max(sum((r[i] - r[i - 1]).length for i in range(n)) for r in rings)

    def face(verts, uvs, matidx, part, want, col=None):
        try:
            f = bm.faces.new(verts)
        except ValueError:
            return
        f.material_index = matidx
        f.smooth = True
        f[m.partl] = part
        f[m.wearl] = 0.0
        f[L['aog']] = group
        f[L['mir']] = 1 if mir else 0
        f.normal_update()
        if f.normal.dot(want) < 0:
            f.normal_flip()
        lut = dict(zip(verts, uvs))
        for l in f.loops:
            l[m.uvl].uv = lut[l.vert]
            c = col or (tint(l.vert.co) if tint else (1, 1, 1))
            l[m.tintl] = (c[0], c[1], c[2], 1.0)

    for j in range(len(rings) - 1):
        mid = (cen[j] + cen[j + 1]) / 2
        for i in range(n):
            k = (i + 1) % n
            quad = [vs[j][i], vs[j][k], vs[j + 1][k], vs[j + 1][i]]
            u0, u1 = i / n * girth, (i + 1) / n * girth
            fc = sum((v.co for v in quad), Vector()) / 4
            face(quad, [(along[j], u0), (along[j], u1), (along[j + 1], u1), (along[j + 1], u0)], mi, parts(j),
                 (mid - fc) if inside else (fc - mid))

    def cap(j, part, want, flesh):
        c = cen[j]
        if not flesh:
            cv = vert(c, vs[j][0])
            for i in range(n):
                k = (i + 1) % n
                face([vs[j][i], vs[j][k], cv], [(0, i / n), (0, k / n), (0.02, i / n)], mi, part, want)
            return
        inner = [vert(c + (v.co - c) * 0.42, v) for v in vs[j]]
        cv = vert(c, vs[j][0])
        fm, bone = m._mi(Flesh), m._mi(BoneEnd)
        for i in range(n):
            k = (i + 1) % n
            shade = 0.75 + 0.5 * mnoise.noise(vs[j][i].co * 60.0)
            face([vs[j][i], vs[j][k], inner[k], inner[i]], [(0, i * 0.01), (0, k * 0.01), (0.03, k * 0.01), (0.03, i * 0.01)],
                 fm, part, want, col=(shade, shade, shade))
            face([inner[i], inner[k], cv], [(0, 0), (0.01, 0), (0, 0.01)], bone, part, want, col=(1, 1, 1))

    last = len(rings) - 1
    for j in cuts:
        axis = (cen[min(j + 1, last)] - cen[max(j - 1, 0)]).normalized()
        cap(j, parts(j - 1), axis, True)        # the lower piece is closed on top
        cap(j, parts(j), -axis, True)           # the upper piece underneath
    if ends[0] == 'fan':
        cap(0, parts(0), (cen[0] - cen[1]).normalized(), False)
    if ends[1] == 'fan':
        cap(last, parts(last - 1), (cen[last] - cen[last - 1]).normalized(), False)


def mark(m):
    return len(m.bm.verts), len(m.bm.faces)


def tag(m, L, since, bone, group, part=None, mir=False):
    """Give everything added since `since` (kit primitives: hands, shoes, ears) one bone and one shading group."""
    bm = m.bm
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    for v in bm.verts[since[0]:]:
        v[L['ba']], v[L['bb']], v[L['wa']] = bone, bone, 1.0
    for f in bm.faces[since[1]:]:
        f[m.partl] = bone if part is None else part
        f[L['aog']] = group
        f[L['mir']] = 1 if mir else 0
        f[m.wearl] = 0.0


def creased(co, amp, seed, vertical=5.0, around=13.0):
    """Cloth wrinkles: how far to push a point out or in."""
    return amp * (mnoise.noise(Vector((co.x * around + seed, co.y * around, co.z * vertical)))
                  + 0.5 * mnoise.noise(Vector((co.x * around * 2.3, co.y * around * 2.3 + seed, co.z * vertical * 2.6))))


def puff(ring, d):
    """Move a ring's points outward from its centre by d (a number or a function of the point)."""
    c = sum(ring, Vector()) / len(ring)
    out = []
    for p in ring:
        r = (p - c)
        r.z = 0
        if r.length > 1e-9:
            r.normalize()
        out.append(p + r * (d(p) if callable(d) else d))
    return out


# ================================================================== BODY
def build_body(m, L):
    rnd = random.Random(4)
    # ---------------------------------------------------------------- torso: the T-shirt, hem to collar
    #          z      rx     ry     cy     power
    TORSO = [(0.900, 0.186, 0.130, 0.000, 2.25), (0.960, 0.182, 0.125, 0.000, 2.25), (1.040, 0.168, 0.113, 0.002, 2.20),
             (1.120, 0.162, 0.109, 0.004, 2.20), (1.220, 0.168, 0.115, 0.006, 2.25), (1.320, 0.180, 0.125, 0.008, 2.35),
             (1.400, 0.190, 0.126, 0.006, 2.40), (1.445, 0.194, 0.118, 0.002, 2.35), (1.475, 0.184, 0.108, -0.002, 2.25),
             (1.497, 0.150, 0.095, -0.004, 2.15), (1.513, 0.112, 0.083, -0.006, 2.05), (1.524, 0.086, 0.076, -0.008, 2.00),
             (1.532, 0.074, 0.074, -0.008, 2.00)]
    NT = 36
    rings = []
    zs = levels(0.900, 1.532, 0.021, must=(SPINE,))
    for z in zs:
        rx, ry, cy, p = spline(TORSO, z)
        loose = 1.0 - clamp((z - 1.25) / 0.2)                      # the shirt hangs loose below the chest
        ring = sring(0, cy, z, rx, ry, NT, p)
        rings.append(puff(ring, lambda q: creased(q, 0.0030 + 0.0035 * loose, 3.0)))
    hem = [Vector((q.x * 0.965, q.y * 0.965, q.z + 0.012)) for q in rings[0]]      # the hem turns in and up
    cut = zs.index(SPINE)
    dark = lambda co: (0.55, 0.55, 0.55)
    shell(m, L, [hem, rings[0]], Shirt, lambda i: B['pelvis'], rigid(B['pelvis']), ends=('open', 'open'), tint=dark, inside=True)
    shell(m, L, rings, Shirt, lambda i: B['torso'] if i >= cut else B['pelvis'], joint(B['pelvis'], B['torso'], SPINE, 0.075),
          cuts=(cut,), ends=('open', 'fan'))
    since = mark(m)
    m.torus(0.066, 0.0080, (0, 0, 0), Shirt, seg=28, sub=8, matrix=xf((0, -0.009, 1.529), (0.10, 0, 0)))   # ribbed collar
    tag(m, L, since, B['torso'], 0)

    # ---------------------------------------------------------------- hips: the jeans above the legs
    HIPS = [(0.800, 0.050, 0.064, 0.000, 2.0), (0.830, 0.116, 0.094, 0.000, 2.1), (0.870, 0.164, 0.112, -0.002, 2.3),
            (0.920, 0.172, 0.116, -0.002, 2.3), (0.980, 0.166, 0.110, 0.000, 2.25), (1.010, 0.160, 0.106, 0.000, 2.2)]
    rings = []
    for z in levels(0.800, 1.010, 0.022):
        rx, ry, cy, p = spline(HIPS, z)
        rings.append(sring(0, cy, z, rx, ry, NT, p))
    shell(m, L, rings, Pants, lambda i: B['pelvis'], rigid(B['pelvis']))

    # ---------------------------------------------------------------- one leg (the +X one; the other is its mirror)
    #        z      rx     ry     cy
    LEG = [(0.985, 0.036, 0.050, 0.000, -0.012), (0.950, 0.066, 0.088, 0.000, -0.011), (0.900, 0.074, 0.097, 0.000, -0.009),
           (0.840, 0.077, 0.098, 0.000, -0.006), (0.750, 0.075, 0.093, 0.002, -0.003), (0.620, 0.069, 0.083, 0.004, 0.000),
           (0.520, 0.063, 0.071, 0.006, 0.000), (0.460, 0.060, 0.067, 0.008, 0.000), (0.400, 0.056, 0.063, 0.002, 0.000),
           (0.300, 0.056, 0.065, -0.008, 0.000), (0.200, 0.051, 0.057, -0.006, 0.000), (0.120, 0.048, 0.053, -0.002, 0.000),
           (0.075, 0.050, 0.056, 0.002, 0.000)]
    LEG = sorted(LEG)
    NL = 22
    zs = levels(0.075, 0.985, 0.021, must=(KNEE, HIP))
    rings = []
    for z in zs:
        rx, ry, cy, dx = spline(LEG, z)
        ring = sring(LX + dx, cy, z, rx, ry, NL, 2.15)
        knee = math.exp(-((z - 0.47) / 0.07) ** 2)                 # the cloth bunches behind the knee
        stack = clamp((0.22 - z) / 0.15)                           # ... and stacks up over the shoe

        def d(q, z=z, knee=knee, stack=stack):
            back = clamp(-(q.y - 0.0) / 0.06)
            return (creased(q, 0.0030, 7.0, vertical=4.0) + 0.0045 * knee * back * sin(z * 150.0)
                    + 0.0040 * stack * sin(z * 190.0 + 3.0 * mnoise.noise(q * 9.0)))
        rings.append(puff(ring, d))
    kc, hc = zs.index(KNEE), zs.index(HIP)

    def leg_w(co):
        if co.z > 0.70:
            w = smoothstep(HIP - 0.06, HIP + 0.045, co.z) * 0.9
            return (B['pelvis'], B['thighL'], w)
        return joint(B['shinL'], B['thighL'], KNEE, 0.055)(co)

    hem = [Vector((LX + (q.x - LX) * 0.94, q.y * 0.94, q.z + 0.012)) for q in rings[0]]
    shell(m, L, [hem, rings[0]], Pants, lambda i: B['shinL'], rigid(B['shinL']), ends=('open', 'open'), group=2, mir=True,
          tint=dark, inside=True)
    shell(m, L, rings, Pants, lambda i: B['pelvis'] if i >= hc else B['thighL'] if i >= kc else B['shinL'], leg_w,
          cuts=(kc, hc), ends=('open', 'fan'), group=2, mir=True)

    # ---------------------------------------------------------------- one shoe
    since = mark(m)
    m.part = B['shinL']
    m.shaped([(-0.078, 0.052, 0.066, 0.070), (-0.040, 0.060, 0.082, 0.098), (0.030, 0.052, 0.094, 0.074),
              (0.100, 0.041, 0.100, 0.052), (0.160, 0.034, 0.092, 0.038), (0.192, 0.030, 0.070, 0.028)], Shoe, n=18, power=2.4,
             x=LX, ends=0.7)                                                       # upper
    m.shaped([(-0.082, 0.014, 0.074, 0.028), (-0.030, 0.014, 0.090, 0.028), (0.060, 0.014, 0.102, 0.028),
              (0.140, 0.014, 0.104, 0.028), (0.196, 0.016, 0.080, 0.030)], Sole, n=18, power=3.0, x=LX, ends=0.8)   # sole
    m.shaped([(0.150, 0.030, 0.094, 0.032), (0.180, 0.028, 0.084, 0.030), (0.199, 0.026, 0.066, 0.026)], Sole, n=16,
             power=2.4, x=LX, ends=0.7)                                            # toe cap
    m.lathe([(0.046, 0.070), (0.050, 0.100), (0.049, 0.112), (0.044, 0.116), (0.040, 0.108), (0.040, 0.070)], (LX, -0.012, 0),
            Shoe, seg=16, closed=True)                                             # padded collar
    for i in range(5):                                                             # laces
        y = 0.012 + i * 0.021
        m.box((0.054 - i * 0.003, 0.0045, 0.0045), (LX, y, 0.0895 - i * 0.0075), Lace, rot=(0.34, 0, (0.25 if i % 2 else -0.25)),
              bevel=0.0012, seg=1)
    m.box((0.040, 0.085, 0.006), (LX, 0.050, 0.0730), Shoe, rot=(-0.34, 0, 0), bevel=0.002, seg=1, tint=0.8)   # tongue
    for sx in (-1, 1):
        m.box((0.004, 0.090, 0.020), (LX + sx * 0.047, 0.060, 0.040), Lace, rot=(0, 0, -sx * 0.10), bevel=0.001, seg=1)   # side stripe
    tag(m, L, since, B['shinL'], 2, mir=True)

    # ---------------------------------------------------------------- one arm: sleeve, then bare skin to the wrist
    SLEEVE = [(1.290, 0.055, 0.061, 0.002), (1.340, 0.056, 0.062, 0.002), (1.400, 0.057, 0.063, 0.000),
              (1.430, 0.057, 0.063, 0.000), (1.455, 0.051, 0.057, 0.000), (1.472, 0.040, 0.046, 0.000),
              (1.482, 0.026, 0.030, 0.000), (1.487, 0.009, 0.011, 0.000)]
    NA = 18
    zs = levels(1.290, 1.487, 0.015, must=(SHOULDER,))
    rings = []
    for z in zs:
        rx, ry, cy = spline(SLEEVE, z)
        ring = sring(AX, cy, z, rx, ry, NA, 2.1)
        rings.append(puff(ring, lambda q: creased(q, 0.0028, 11.0)))
    sc = zs.index(SHOULDER)

    def sleeve_w(co):
        return (B['torso'], B['uarmL'], smoothstep(1.385, 1.487, co.z) * 0.92)

    hem = [Vector((AX + (q.x - AX) * 0.90, q.y * 0.90, q.z + 0.014)) for q in rings[0]]
    shell(m, L, [hem, rings[0]], Shirt, lambda i: B['uarmL'], rigid(B['uarmL']), ends=('open', 'open'), group=1, mir=True,
          tint=dark, inside=True)
    shell(m, L, rings, Shirt, lambda i: B['torso'] if i >= sc else B['uarmL'], sleeve_w, cuts=(sc,), ends=('open', 'fan'),
          group=1, mir=True)

    ARM = [(0.885, 0.0240, 0.0320, 0.004), (0.930, 0.0285, 0.0340, 0.004), (0.990, 0.0365, 0.0390, 0.003),
           (1.060, 0.0440, 0.0455, 0.000), (1.115, 0.0455, 0.0475, -0.002), (1.160, 0.0430, 0.0460, -0.003),
           (1.200, 0.0430, 0.0470, -0.002), (1.260, 0.0470, 0.0530, 0.000), (1.320, 0.0490, 0.0560, 0.002)]
    zs = levels(0.885, 1.320, 0.020, must=(ELBOW,))
    rings = [sring(AX, spline(ARM, z)[2], z, spline(ARM, z)[0], spline(ARM, z)[1], NA, 2.1) for z in zs]
    ec = zs.index(ELBOW)

    def skin_tone(co):                                                             # elbows and knuckles are a little darker
        k = 1.0 - 0.08 * math.exp(-((co.z - ELBOW) / 0.03) ** 2) * clamp(-co.y / 0.03)
        return (k, k * 0.985, k * 0.975)

    shell(m, L, rings, Skin, lambda i: B['uarmL'] if i >= ec else B['farmL'], joint(B['farmL'], B['uarmL'], ELBOW, 0.048),
          cuts=(ec,), ends=('fan', 'fan'), group=1, mir=True, tint=skin_tone)

    # ---------------------------------------------------------------- one hand, hanging relaxed, palm to the thigh
    since = mark(m)
    m.part = B['farmL']
    M = basis((0, -1, 0), (0, 0, -1), (1, 0, 0), (AX + 0.001, 0.006, 0.832))
    build_hand(m, M, {'index': (16, 26, 16, -3), 'middle': (22, 32, 20), 'ring': (27, 36, 22, 2), 'pinky': (32, 38, 24, 5)},
               [(-0.0640, 0.0220, -0.0200), (-0.0660, 0.0460, -0.0300)], skin=Skin, scale=1.0, cuff=False)
    tag(m, L, since, B['farmL'], 1, mir=True)
    m.part = 0


# ================================================================== HEAD
#       z       W      F      B     power     half width, front depth, back depth (from the head's centre line)
SKULL = [(-0.126, 0.010, 0.036, 0.014, 2.0), (-0.121, 0.024, 0.062, 0.026, 2.0), (-0.112, 0.036, 0.079, 0.036, 2.1),
         (-0.098, 0.047, 0.086, 0.047, 2.2), (-0.080, 0.057, 0.090, 0.060, 2.3), (-0.060, 0.064, 0.091, 0.073, 2.35),
         (-0.035, 0.070, 0.091, 0.085, 2.35), (-0.010, 0.074, 0.089, 0.093, 2.3), (0.010, 0.076, 0.092, 0.097, 2.25),
         (0.030, 0.077, 0.092, 0.099, 2.2), (0.060, 0.074, 0.084, 0.094, 2.15), (0.085, 0.065, 0.070, 0.082, 2.1),
         (0.105, 0.048, 0.049, 0.059, 2.05), (0.116, 0.026, 0.026, 0.032, 2.0), (0.1195, 0.008, 0.008, 0.010, 2.0)]


def g(d, s):
    return math.exp(-(d * d) / (2 * s * s))


def face_relief(x, z):
    """How far the face stands forward of the smooth skull at (x, z): brow, sockets, nose, lips, chin."""
    ax = abs(x)
    d = 0.0045 * g(z - 0.016, 0.0070) * g(ax - 0.028, 0.022)                       # brow ridge
    d -= 0.0100 * g(z + 0.004, 0.0090) * g(ax - 0.0310, 0.0130)                    # eye sockets
    if z > -0.0440:                                                                # bridge of the nose down to the tip
        t = clamp((0.010 - z) / 0.054)
        d += (0.0025 + 0.0240 * t ** 1.5) * g(x, 0.0062 + 0.0058 * t ** 1.2) * smoothstep(0.018, 0.002, z)
    else:                                                                          # rounding under the tip
        d += 0.0265 * (1 - smoothstep(0.0, 1.0, (-0.0440 - z) / 0.016)) * g(x, 0.0120)
    d += 0.0020 * g(z + 0.0410, 0.0060) * g(x, 0.0080)                             # the bulb of the tip
    d += 0.0080 * g(z + 0.0465, 0.0052) * g(ax - 0.0138, 0.0052)                   # nostrils
    d += 0.0030 * g(z + 0.030, 0.020) * g(ax - 0.046, 0.020)                       # cheekbones
    d += 0.0045 * g(z + 0.078, 0.016) * g(x, 0.027)                                # muzzle
    d += 0.0040 * g(z + 0.0712, 0.0040) * g(x, 0.0185)                             # upper lip
    d += 0.0048 * g(z + 0.0868, 0.0046) * g(x, 0.0160)                             # lower lip
    d -= 0.0036 * g(z + 0.0788, 0.0017) * g(x, 0.0230)                             # the line of the mouth
    d -= 0.0018 * g(z + 0.0788, 0.0040) * g(ax - 0.0245, 0.0045)                   # its corners
    d -= 0.0012 * g(z + 0.0620, 0.0055) * g(x, 0.0034)                             # philtrum
    d -= 0.0028 * g(z + 0.0985, 0.0042) * g(x, 0.0200)                             # groove above the chin
    d += 0.0062 * g(z + 0.1100, 0.0100) * g(x, 0.0180)                             # chin
    return d


def skull_point(a, z, extra=0.0):
    """A point on the head: a = angle round it (0 = straight ahead, + toward +X), z = height above its centre."""
    W, F, Bk, p = spline(SKULL, z)
    c, s = cos(a), sin(a)
    x = W * math.copysign(abs(s) ** (2 / p), s)
    y = (F if c > 0 else Bk) * math.copysign(abs(c) ** (2 / p), c)
    if c > 0:
        y += face_relief(x, z) * smoothstep(0.0, 0.35, c)
    q = Vector((x, y - 0.004, z))
    if extra:
        r = Vector((x, y * 0.9, z * 0.75))
        q += r.normalized() * extra
    return HEAD + q


def face_tint(co):
    """Colour variation painted into the skin: lips, flushed cheeks and nose, shadowed sockets, stubble."""
    p = co - HEAD
    x, z, ax = p.x, p.z, abs(p.x)
    if p.y < 0.02:
        return (1, 1, 1)
    r = gg = b = 1.0
    lip = clamp(g(z + 0.0712, 0.0042) * g(x, 0.020) + g(z + 0.0868, 0.0048) * g(x, 0.017)) * smoothstep(0.070, 0.085, p.y)
    r, gg, b = lerp(r, 0.86, lip), lerp(gg, 0.60, lip), lerp(b, 0.60, lip)
    slit = g(z + 0.0788, 0.0016) * g(x, 0.022)
    r, gg, b = r * (1 - 0.38 * slit), gg * (1 - 0.45 * slit), b * (1 - 0.45 * slit)
    flush = 0.10 * g(z + 0.035, 0.018) * g(ax - 0.045, 0.018) + 0.08 * g(z + 0.038, 0.010) * g(x, 0.012)
    gg, b = gg * (1 - flush), b * (1 - flush * 1.1)
    sock = 0.16 * g(z + 0.004, 0.010) * g(ax - 0.031, 0.014)
    r, gg, b = r * (1 - sock), gg * (1 - sock * 1.05), b * (1 - sock)
    nost = 0.38 * g(z + 0.0545, 0.0026) * g(ax - 0.0085, 0.0034)
    r, gg, b = r * (1 - nost), gg * (1 - nost), b * (1 - nost)
    beard = 0.11 * smoothstep(-0.050, -0.085, z) * smoothstep(0.03, 0.06, p.y) * (1 - lip)
    r, gg, b = r * (1 - beard), gg * (1 - beard * 0.95), b * (1 - beard * 0.85)
    return (r, gg, b)


def hair_edge(a):
    """Height of the hairline at angle a from straight ahead: forehead, temple, over the ear, nape."""
    a = abs(a)
    if a < 1.05:
        lim = 0.070 + 0.010 * cos(a * 3.0) - 0.040 * smoothstep(0.55, 1.05, a)
    elif a < 1.75:
        lim = 0.020 - 0.012 * smoothstep(1.05, 1.75, a)
    else:
        lim = 0.008 - 0.090 * smoothstep(1.75, 2.45, a)
    return lim - 0.022 * g(a - 1.28, 0.075)                                        # sideburn


def face_columns(n):
    """Angles round the head, closer together across the face than round the back."""
    out = []
    for i in range(n):
        t = (i + 0.5) / n * 2 - 1                                                # -1 .. 1, 0 = front
        out.append(pi * (0.45 * t + 0.55 * math.copysign(abs(t) ** 2.2, t)))
    return out


def build_head(m, L):
    HB = B['head']
    NC = 72                                 # columns round the head
    cols = face_columns(NC)
    zs = levels(-0.126, 0.030, 0.0030) + levels(0.030, 0.1195, 0.0075)[1:]
    rings = [[skull_point(a, z) for a in cols] for z in zs]
    shell(m, L, rings, Skin, lambda i: HB, rigid(HB), tint=face_tint)

    # ---- hair: a second skin over the scalp, from the hairline to the crown
    hm = m._mi(Hair)
    bm = m.bm
    ROWS = 16
    grid = []
    for j in range(ROWS):
        t = j / (ROWS - 1)
        row = []
        for a in cols:
            z = lerp(hair_edge(a), 0.1190, t ** 0.85)
            thick = 0.0005 + 0.0095 * smoothstep(0.0, 0.30, t) + 0.0030 * t
            thick += 0.0020 * smoothstep(0.1, 0.4, t) * mnoise.noise(Vector((a * 7.0, z * 60.0, 1.0)))
            v = bm.verts.new(skull_point(a, z, thick))
            v[L['ba']], v[L['bb']], v[L['wa']] = HB, HB, 1.0
            row.append(v)
        grid.append(row)
    crown = bm.verts.new(HEAD + Vector((0, -0.004, 0.1195 + 0.0125)))
    crown[L['ba']], crown[L['bb']], crown[L['wa']] = HB, HB, 1.0
    hair_c = HEAD + Vector((0, -0.004, 0.02))

    def hair_face(vs_):
        f = bm.faces.new(vs_)
        f.material_index, f.smooth = hm, True
        f[m.partl], f[L['aog']] = HB, 0
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - hair_c) < 0:
            f.normal_flip()
        for l in f.loops:
            p = l.vert.co - HEAD
            l[m.uvl].uv = (p.z, atan2(p.x, p.y) * 0.08)                             # strands run down from the crown
            s_ = 0.80 + 0.35 * mnoise.noise(Vector((atan2(p.x, p.y) * 9.0, p.z * 14.0, 2.0)))
            l[m.tintl] = (s_, s_, s_, 1.0)

    for j in range(ROWS - 1):
        for i in range(NC):
            k = (i + 1) % NC
            hair_face([grid[j][i], grid[j][k], grid[j + 1][k], grid[j + 1][i]])
    for i in range(NC):
        hair_face([grid[ROWS - 1][i], grid[ROWS - 1][(i + 1) % NC], crown])

    # ---- neck: skin from inside the collar up into the skull; the neck joint passes through it
    NECK_R = [(1.440, 0.064, 0.068, -0.014), (1.530, 0.060, 0.064, -0.012), (1.560, 0.058, 0.062, -0.011),
              (1.590, 0.058, 0.062, -0.011), (1.630, 0.054, 0.058, -0.012)]
    zs2 = levels(1.440, 1.630, 0.014, must=(NECK,))
    rings = []
    for z in zs2:
        rx, ry, cy = spline(NECK_R, z)
        ring = sring(0, cy, z, rx, ry, 20, 2.1)
        for q in ring:                                                             # windpipe at the front, muscles each side
            q.y += 0.0035 * g(q.x, 0.012) * (q.y > 0) * g(z - 1.565, 0.03)
        rings.append(ring)
    nc = zs2.index(NECK)
    shell(m, L, rings, Skin, lambda i: HB if i >= nc else B['torso'], blend(B['torso'], HB, 1.515, 1.605), cuts=(nc,))

    # ---- eyes: ball, iris, pupil, and lids cut from a slightly larger ball
    since = mark(m)
    m.part = HB
    for sx in (-1, 1):
        e = skull_point(sx * 0.345, -0.0040) + Vector((0, -0.0088, 0))
        e.x = sx * 0.0312
        m.sphere(0.0122, e, EyeWhite, seg=16, rings=12)
        m.sphere(1.0, e + Vector((0, 0.0108, 0)), EyeIris, scale=(0.0056, 0.0020, 0.0056), seg=14, rings=8)
        m.sphere(1.0, e + Vector((0, 0.0118, 0)), EyeDark, scale=(0.0025, 0.0014, 0.0025), seg=10, rings=6)
        m.sphere(0.0138, e, Skin, seg=18, rings=14, tint=(0.94, 0.90, 0.90),
                 keep=lambda c: c.y > -0.003 and c.z > 0.0012 + 0.0030 * (c.x / 0.0138) ** 2)           # upper lid
        m.sphere(0.0136, e, Skin, seg=18, rings=14, tint=(0.95, 0.91, 0.91),
                 keep=lambda c: c.y > -0.003 and c.z < -0.0062)                                         # lower lid
        # eyebrow: a tuft following the brow ridge
        brow = [skull_point(sx * a, z, 0.0010) for a, z in ((0.130, 0.0110), (0.300, 0.0150), (0.470, 0.0150), (0.620, 0.0090))]
        m.sweep(brow, [0.0034, 0.0040, 0.0034, 0.0020], Hair, profile=[(-0.3, -1), (0.3, -1), (0.3, 1), (-0.3, 1)], smooth=1,
                up=(0, 0, 1))
        # ear: a plate hinged to the head along its front edge, rolled rim, lobe
        back = Vector((sx * 0.42, -0.91, 0)).normalized()         # from the hinge toward the ear's free edge
        out = Vector((sx * 0.91, 0.42, 0)).normalized()           # the way the ear's face points
        upv = Vector((0, -0.12, 0.99)).normalized()
        hinge = HEAD + Vector((sx * 0.0725, -0.0030, -0.0120))
        C = hinge + back * 0.0135
        frame = Matrix((back, out, upv)).transposed().to_4x4()
        m.sphere(1.0, (0, 0, 0), Skin, seg=16, rings=12, tint=(0.97, 0.87, 0.85),
                 matrix=Matrix.Translation(C) @ frame @ Matrix.Diagonal((0.0140, 0.0034, 0.0290, 1.0)))
        rim = [C + back * (0.0138 * cos(radians(f_))) + upv * (0.0300 * sin(radians(f_))) + out * 0.0028
               for f_ in range(155, -80, -15)]
        m.sweep(rim, [0.0030] + [0.0042] * (len(rim) - 3) + [0.0050, 0.0055], Skin, seg=8, tint=(1.0, 0.91, 0.89))
        m.sphere(1.0, (0, 0, 0), Skin, seg=10, rings=8, tint=(0.60, 0.48, 0.46),
                 matrix=Matrix.Translation(C + out * 0.0030 - back * 0.0045 - upv * 0.0040) @ frame
                 @ Matrix.Diagonal((0.0058, 0.0014, 0.0090, 1.0)))                                       # hollow of the ear
        m.sphere(0.0054, C - upv * 0.0270 - back * 0.0075, Skin, scale=(0.9, 0.7, 1.15), seg=10, rings=8,
                 tint=(1.0, 0.90, 0.88))                                                                 # lobe
        m.sphere(0.0030, hinge + out * 0.0018 - upv * 0.0040, Skin, seg=8, rings=6, tint=(1.0, 0.92, 0.90))   # tragus
    tag(m, L, since, HB, 0)
    m.part = 0


# ================================================================== putting it together
def finish_body(m, L):
    bm = m.bm
    # the far side's arm and leg are mirror images
    bm.verts.ensure_lookup_table()
    new = {}
    for f in [f for f in bm.faces if f[L['mir']]]:
        vs = []
        for v in f.verts:
            w = new.get(v)
            if w is None:
                w = bm.verts.new((-v.co.x, v.co.y, v.co.z))
                w[L['ba']] = MIRROR.get(v[L['ba']], v[L['ba']])
                w[L['bb']] = MIRROR.get(v[L['bb']], v[L['bb']])
                w[L['wa']] = v[L['wa']]
                new[v] = w
            vs.append(w)
        vs.reverse()
        nf = bm.faces.new(vs)
        nf.material_index = f.material_index
        nf.smooth = f.smooth
        nf[m.partl] = MIRROR.get(f[m.partl], f[m.partl])
        nf[m.wearl] = 0.0
        nf[L['aog']] = f[L['aog']] + 10
        src = {new[l.vert]: l for l in f.loops}
        for l in nf.loops:
            l[m.uvl].uv = src[l.vert][m.uvl].uv
            l[m.tintl] = src[l.vert][m.tintl]
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.verts.index_update()
    bm.faces.index_update()
    bm.normal_update()
    normals = weighted_normals(bm, radians(44))

    # shading: each limb only shades itself, so a raised arm does not carry a shadow of the ribs up with it
    info = [MAT.get(mt.name, dict(ao=0.6, dirt=0.04)) for mt in m.mats]
    trees = {}
    if not FAST:
        coords = [v.co.copy() for v in bm.verts]
        for gid in {f[L['aog']] for f in bm.faces}:
            polys = [[v.index for v in f.verts] for f in bm.faces if f[L['aog']] == gid]
            trees[gid] = BVHTree.FromPolygons(coords, polys)
    colors = []
    cache = {}
    li = 0
    dist = 0.16
    for f in bm.faces:
        mi = info[f.material_index]
        tree = trees.get(f[L['aog']])
        for l in f.loops:
            n = normals[li]
            li += 1
            ao = 1.0
            if tree and mi['ao'] > 0:
                key = (l.vert.index, f[L['aog']], round(n.x, 1), round(n.y, 1), round(n.z, 1))
                ao = cache.get(key)
                if ao is None:
                    t = n.orthogonal().normalized()
                    b = n.cross(t)
                    o = l.vert.co + n * 0.0004
                    occ = 0.0
                    for dx, dy, dz in _AO_DIRS:
                        hit = tree.ray_cast(o, t * dx + b * dy + n * dz, dist)
                        if hit[0] is not None:
                            occ += 1.0 - 0.7 * (hit[3] / dist)
                    ao = 1.0 - occ / len(_AO_DIRS)
                    cache[key] = ao
            shade = lerp(1.0 - mi['ao'], 1.0, clamp(ao) ** 1.2)
            if mi['dirt'] > 0:
                shade *= 1.0 - mi['dirt'] * (0.5 + 0.5 * mnoise.noise(l.vert.co * 11.0))
            tn = l[m.tintl]
            colors.append((tn[0] * shade, tn[1] * shade, tn[2] * shade, 1.0))

    # cut into one object per ragdoll body
    coll = collection('Character')
    for o in list(coll.objects):
        me_old = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if me_old.users == 0:
            bpy.data.meshes.remove(me_old)
    loop_start = {}
    li = 0
    for f in bm.faces:
        loop_start[f.index] = li
        li += len(f.verts)
    built = []
    for bi, bname in enumerate(BONES):
        faces = [f for f in bm.faces if f[m.partl] == bi]
        if not faces:
            continue
        vmap, verts, polys, mats_used = {}, [], [], []
        nrm, col, uvs, pmat, smooth, skin = [], [], [], [], [], []
        for f in faces:
            idx = []
            s0 = loop_start[f.index]
            for k, l in enumerate(f.loops):
                v = l.vert
                if v not in vmap:
                    vmap[v] = len(verts)
                    verts.append(v.co.copy())
                    skin.append((float(v[L['ba']]), float(v[L['bb']]), v[L['wa']]))
                idx.append(vmap[v])
                nrm.append(normals[s0 + k])
                col.append(colors[s0 + k])
                uvs.append(l[m.uvl].uv.copy())
            polys.append(idx)
            mt = m.mats[f.material_index]
            if mt not in mats_used:
                mats_used.append(mt)
            pmat.append(mats_used.index(mt))
        name = 'Body_' + bname
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], polys)
        for mt in mats_used:
            me.materials.append(mt)
        me.polygons.foreach_set('material_index', pmat)
        me.polygons.foreach_set('use_smooth', [True] * len(polys))
        uv = me.uv_layers.new(name='UVMap')
        uv.data.foreach_set('uv', [c for t in uvs for c in t])
        me.normals_split_custom_set(nrm)
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        ca.data.foreach_set('color', [c for t in col for c in t])
        me.color_attributes.active_color = me.color_attributes['Col']
        me.color_attributes.render_color_index = me.color_attributes.find('Col')
        sk = me.attributes.new('_skin', 'FLOAT_VECTOR', 'POINT')
        sk.data.foreach_set('vector', [c for t in skin for c in t])
        me.update()
        ob = bpy.data.objects.new(name, me)
        ob.location = CHAR_AT
        coll.objects.link(ob)
        built.append((name, len(polys)))
    bm.free()
    return built


if ONLY is None or 'Body' in ONLY:
    _t0 = time.time()
    _m = Model('Body')
    _L = setup(_m)
    build_body(_m, _L)
    build_head(_m, _L)
    _parts = finish_body(_m, _L)
    BUILT.append(('Body', sum(n for _, n in _parts), round(time.time() - _t0, 1)))
