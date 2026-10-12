"""Hands. One builder makes every hand in the game from a pose: the gloved first-person hands
and the bare hands of the NPCs.

A hand is described in its own space: palm centre at the origin, fingers pointing +Y when
straight, back of the hand +Z (palm -Z), thumb on the -X side (a right hand). A pose gives each
finger three joint angles; the builder works out where the bones go, skins them, and places the
result with a matrix. Left hands are the same thing mirrored.
"""
# name, knuckle position, bone lengths, radius
FINGERS = [('index', (-0.0300, 0.0420, 0.0000), (0.046, 0.027, 0.023), 0.0100),
           ('middle', (-0.0095, 0.0460, 0.0010), (0.050, 0.031, 0.024), 0.0102),
           ('ring', (0.0110, 0.0420, 0.0000), (0.046, 0.029, 0.023), 0.0097),
           ('pinky', (0.0300, 0.0330, -0.0020), (0.036, 0.022, 0.021), 0.0088)]
THUMB_CMC = (-0.0300, -0.0360, -0.0080)     # where the thumb leaves the wrist
THUMB_MCP = (-0.0500, -0.0060, -0.0060)     # its big knuckle
PALM = [(-0.058, 0.060, 0.038, 0.000), (-0.036, 0.074, 0.036, -0.001), (-0.008, 0.084, 0.032, -0.001),
        (0.022, 0.088, 0.029, 0.000), (0.043, 0.084, 0.026, 0.001)]         # y, width, thickness, z


def wrap_angles(knuckle, lengths, centre, rho):
    """Joint angles (degrees) that curl a finger round a handle. Worked in the finger's own plane
    (y forward, z up): `centre` is the handle's centre there and rho its radius plus the finger's."""
    y, z = knuckle
    total = 0.0
    out = []
    for i, L in enumerate(lengths):
        dy, dz = centre[0] - y, centre[1] - z
        dist = hypot(dy, dz)
        beta = math.degrees(atan2(-dz, dy)) % 360
        if beta > 300:
            beta -= 360
        phi = math.degrees(math.asin(min(1.0, rho / max(dist, 1e-6))))
        want = beta - phi
        step = clamp(want - total, 0.0, (90.0, 100.0, 70.0)[i])
        total += step
        out.append(step)
        y += L * cos(radians(total))
        z -= L * sin(radians(total))
    return tuple(out)


def build_hand(m, M, curls, thumb, mirror=False, skin=None, scale=1.0, guard=True, cuff=True, thumb_local=True,
               thumb_mcp=None):
    """M places the hand in the model. curls = {finger: (mcp, pip, dip[, spread])} in degrees.
    thumb = the thumb's last two points (middle joint, tip), in hand space or model space; thumb_mcp
    moves its big knuckle too, for grips where the thumb swings round to face the fingers.
    skin = a material for a bare hand (no glove details). Returns a function mapping hand space to model space."""
    fab = skin or Glove
    k = scale

    def P(v):
        v = Vector(v) * k
        if mirror:
            v.x = -v.x
        return M @ v

    def blob(r, at, sc, mat):
        a = Vector(at) * k
        if mirror:
            a.x = -a.x
        m.sphere(r * k, (0, 0, 0), mat, seg=14, rings=10, matrix=M @ Matrix.Translation(a) @ Matrix.Diagonal((*sc, 1.0)))

    # palm
    n = 18
    rings = []
    for y, w, t, zc in PALM:
        ring = []
        for i in range(n):
            a = 2 * pi * i / n
            cx, sy = cos(a), sin(a)
            ring.append(P((w / 2 * math.copysign(abs(cx) ** 0.8, cx), y, zc + t / 2 * math.copysign(abs(sy) ** 0.8, sy))))
        rings.append(ring)
    m.loft(rings, (0, 0, 0), fab, uv='box')
    blob(0.0190, (-0.0240, -0.0240, -0.0100), (1.0, 1.35, 0.85), fab)                  # ball of the thumb
    blob(0.0160, (0.0270, -0.0260, -0.0080), (0.8, 1.7, 0.9), fab)                     # heel of the hand
    # fingers
    for name, kn, lens, r in FINGERS:
        c = curls[name]
        spread = radians(c[3]) if len(c) > 3 else 0.0
        p = Vector(kn)
        pts = [p.copy()]
        total = 0.0
        for a, L in zip(c[:3], lens):
            total += radians(a)
            p = p + Vector((sin(spread) * cos(total), cos(spread) * cos(total), -sin(total))) * L
            pts.append(p.copy())
        root = pts[0] - Vector((0, 0.016, 0))
        m.sweep([P(root)] + [P(q) for q in pts], [r * 1.08 * k, r * 1.08 * k, r * k, r * 0.94 * k, r * 0.86 * k], fab,
                seg=10, smooth=1)
        m.sphere(r * 0.86 * k, P(pts[3]), fab, seg=10, rings=8)
        for q, s in ((pts[1], 1.02), (pts[2], 0.96)):
            m.sphere(r * s * k, P(q), fab, seg=10, rings=8)
        blob(r * 1.22, (kn[0], kn[1] - 0.002, kn[2] + 0.0025), (1.0, 1.1, 0.9), fab)    # knuckle
        if guard and not skin:
            blob(0.0118, (kn[0], kn[1] - 0.004, kn[2] + 0.0090), (0.92, 1.15, 0.5), GloveHard)
    # thumb
    t0, t1 = Vector(THUMB_CMC), Vector(THUMB_MCP)
    tail = [P(q) for q in thumb] if thumb_local else [Vector(q) for q in thumb]
    tp = [P(t0), P(t1)] + tail
    if thumb_mcp is not None:
        tp[1] = P(thumb_mcp) if thumb_local else Vector(thumb_mcp)
    m.sweep(tp, [0.0140 * k, 0.0128 * k, 0.0112 * k, 0.0098 * k], fab, seg=10, smooth=1)
    m.sphere(0.0098 * k, tp[3], fab, seg=10, rings=8)
    m.sphere(0.0130 * k, tp[1], fab, seg=10, rings=8)
    m.sphere(0.0114 * k, tp[2], fab, seg=10, rings=8)
    if not skin:
        if guard:
            m.box((0.070 * k, 0.020 * k, 0.0045 * k), (0, 0, 0), GloveHard, bevel=0.002, seg=2,
                  matrix=M @ Matrix.Translation(((0.001 if not mirror else -0.001) * k, 0.031 * k, 0.0118 * k)))
        m.box((0.032 * k, 0.024 * k, 0.003 * k), (0, 0, 0), GlovePad, bevel=0.001, seg=1,
              matrix=M @ Matrix.Translation(((0.004 if not mirror else -0.004) * k, -0.012 * k, 0.0168 * k)))   # logo patch
    if cuff and not skin:
        rings = []
        for y, w, t in ((-0.050, 0.064, 0.042), (-0.062, 0.066, 0.044), (-0.066, 0.064, 0.042)):
            rings.append([P((w / 2 * cos(2 * pi * i / n), y, t / 2 * sin(2 * pi * i / n))) for i in range(n)])
        m.loft(rings, (0, 0, 0), GlovePad, uv='box')                                     # wrist strap
        m.box((0.030 * k, 0.014 * k, 0.003 * k), (0, 0, 0), GloveHard, bevel=0.001, seg=1,
              matrix=M @ Matrix.Translation(((-0.008 if not mirror else 0.008) * k, -0.058 * k, 0.0222 * k)))   # its tab
        rings = []
        for y, w, t in ((-0.060, 0.060, 0.038), (-0.078, 0.066, 0.044), (-0.096, 0.070, 0.048), (-0.098, 0.064, 0.042)):
            rings.append([P((w / 2 * cos(2 * pi * i / n), y, t / 2 * sin(2 * pi * i / n))) for i in range(n)])
        m.loft(rings, (0, 0, 0), fab, uv='box')                                          # gauntlet
    return P


def sleeve(m, wrist, elbow, mat=None, r0=0.040, r1=0.056):
    """A jacket sleeve from the wrist back to the elbow, bunched into folds near the cuff."""
    w, e = Vector(wrist), Vector(elbow)
    axis = (e - w).normalized()
    side = axis.cross(Vector((0, 0, 1))).normalized()
    up = side.cross(axis)
    L = (e - w).length
    n, rows = 22, 44
    rings = []
    for j in range(rows + 1):
        t = j / rows
        s = -0.03 + 1.03 * t                                   # starts a little inside the glove
        base = lerp(r0, r1, clamp(s)) * (0.82 if j == 0 else 1.0)
        fade = 0.25 + 0.75 * (1 - clamp(s * 1.6)) ** 1.5       # folds are deepest at the cuff
        ring = []
        for i in range(n):
            a = 2 * pi * i / n
            fold = sin(s * L * 62 + 2.4 * sin(a + s * 7.0)) * 0.5 + sin(s * L * 31 - a * 2 + 1.3) * 0.5
            r = base * (1 + 0.075 * fade * fold)
            ring.append(w + axis * (s * L) + (side * cos(a) + up * (0.86 * sin(a))) * r)
        rings.append(ring)
    m.loft(rings, (0, 0, 0), mat or Sleeve, uv='box')
    prof = [(cos(2 * pi * i / 16), 0.86 * sin(2 * pi * i / 16)) for i in range(16)]
    m.sweep([w.lerp(e, -0.012), w.lerp(e, 0.012)], [r0 * 1.07, r0 * 1.07], mat or Sleeve, profile=prof)   # hem


def basis(x, y, z, t):
    """Matrix whose columns say where hand-space X, Y and Z point in the model, then moved to t."""
    mx = Matrix((x, y, z)).transposed().to_4x4()
    return Matrix.Translation(t) @ mx


# ================================================================== HandR: fist round a vertical grip
# The grip stands at the origin (about 30 mm wide, 45 mm front to back). Index finger laid straight
# along the frame, the other three wrapped round the front, thumb forward along the left side.
@model('HandR', 'Hands', (0.0, -2.6, 1.0))
def _(m):
    M = basis((0, 0, -1), (0, 1, 0), (1, 0, 0), (0.026, -0.011, -0.004))
    P = build_hand(m, M, {'index': (4, 8, 8, -36), 'middle': (80, 95, 30), 'ring': (80, 95, 32), 'pinky': (82, 98, 36)},
                   [(-0.021, -0.006, 0.060), (-0.0235, 0.022, 0.064)], thumb_local=False, thumb_mcp=(0.002, -0.034, 0.048))
    m.sphere(0.0190, (0.012, -0.030, 0.038), Glove, scale=(0.95, 1.1, 1.0), seg=14, rings=10)       # web of the thumb
    sleeve(m, P((0, -0.088, 0)), (0.190, -0.680, -0.300))


# ================================================================== HandL: cupping a forend from below
# The origin is the point on the underside that the palm presses up against.
@model('HandL', 'Hands', (0.6, -2.6, 1.0))
def _(m):
    lam, tilt = radians(35), radians(18)
    y_ = Vector((cos(lam), sin(lam), 0))                      # fingers: to the right and forward
    x_ = Vector((-sin(lam), cos(lam), 0))                     # thumb side: forward and left
    z_ = Vector((0, 0, -1))
    R = Matrix.Rotation(-tilt, 3, x_)                         # heel of the hand lower than the fingers
    y_, z_ = R @ y_, R @ z_
    M = basis(x_, y_, z_, Vector((-0.016, -0.004, -0.0150)))
    P = build_hand(m, M, {'index': (58, 34, 20, -4), 'middle': (62, 38, 22), 'ring': (64, 38, 22, 3),
                          'pinky': (62, 42, 25, 6)},
                   [(-0.0400, 0.0520, 0.0160), (-0.0340, 0.0600, 0.0410)], mirror=True, thumb_local=False)
    sleeve(m, P((0, -0.088, 0)), (-0.370, -0.640, -0.260))


# ================================================================== KnifeHand: sabre grip, blade forward
# The handle lies along +Y through the origin, running diagonally across the palm from the base of the
# index finger to the heel of the hand, thumb on the spine. No forearm: the game draws one from WRIST.
@model('KnifeHand', 'Hands', (1.2, -2.6, 1.0))
def _(m):
    al, psi = radians(60), radians(-25)
    x_, y_, z_ = Vector((0, -cos(al), -sin(al))), Vector((0, sin(al), -cos(al))), Vector((1, 0, 0))
    R = Matrix.Rotation(psi, 3, 'Y')
    x_, y_, z_ = R @ x_, R @ y_, R @ z_
    HR = 0.0145                                                # handle radius
    c0 = Vector((-0.0095, 0.024, -(0.014 + HR)))               # a point on the handle's centre line, hand space
    T = Vector((0, 0.008, 0)) - (x_ * c0.x + y_ * c0.y + z_ * c0.z)
    M = basis(x_, y_, z_, T)
    curls = {}
    for name, kn, lens, r in FINGERS:
        t = (c0.x - kn[0]) / cos(al)
        curls[name] = wrap_angles((kn[1], kn[2]), lens, (c0.y + sin(al) * t, c0.z), HR + r)
    P = build_hand(m, M, curls, [(-0.0030, 0.0330, 0.0290), (-0.0040, 0.0560, 0.0262)], thumb_local=False)
    w = P((0, -0.098, 0))
    REF['KnifeHand'] = dict(wrist=tuple(round(c, 4) for c in w))


# ================================================================== HandSupport: the other hand in a two-handed pistol hold
# HandR's mirror image, moved outward so it closes over the gripping hand's fingers, both thumbs forward.
@model('HandSupport', 'Hands', (1.8, -2.6, 1.0))
def _(m):
    M = basis((0, 0, 1), (0, 1, 0), (-1, 0, 0), (-0.041, 0.001, -0.019))
    P = build_hand(m, M, {'index': (62, 88, 28), 'middle': (64, 90, 28), 'ring': (66, 92, 30), 'pinky': (68, 94, 34)},
                   [(-0.0350, 0.0120, 0.0400), (-0.0340, 0.0400, 0.0450)], mirror=True, thumb_local=False,
                   thumb_mcp=(-0.0300, -0.0180, 0.0300))
    sleeve(m, P((0, -0.088, 0)), (-0.320, -0.600, -0.280))


# ================================================================== SleeveArm: the knife arm's forearm
# 0.3 m of sleeve from the origin back along -Y. The game stretches it between the wrist and the elbow.
@model('SleeveArm', 'Hands', (2.4, -2.6, 1.0))
def _(m):
    sleeve(m, (0, 0, 0), (0, -0.30, 0), r0=0.040, r1=0.050)
