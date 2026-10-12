"""Headwear. Origin = the centre of the head (the head's ragdoll body), same axes as the body.
Every hat is shaped on the head model itself (skull_point in character.py), so it fits the skull,
clears the hair, and shows the nose and brow through a knitted mask."""
HAT_COLS = [pi * (i + 0.5) / 28 * 2 - pi for i in range(56)]     # 56 columns round the head


def on_head(a, z, extra):
    """A point `extra` metres off the scalp, in the head's own space."""
    return skull_point(a, z, extra) - HEAD


def crown_rows(edge, top, rows, extra, cols=HAT_COLS, lift=None):
    """Rings from a brim line edge(a) up to height `top`, standing `extra` off the scalp."""
    out = []
    for j in range(rows):
        t = j / (rows - 1)
        ring = []
        for a in cols:
            z = lerp(edge(a), top, t ** 0.9)
            e = extra(a, t) if callable(extra) else extra
            p = on_head(a, z, e)
            if lift:
                p.z += lift(t)
            ring.append(p)
        out.append(ring)
    return out


def shell_hat(m, mat, edge, top, extra, rows=11, wall=0.004, lift=None, **kw):
    """A domed shell with a little thickness at the rim (so you can look up under it)."""
    outer = crown_rows(edge, top, rows, extra, lift=lift)
    inner = crown_rows(edge, top, 8, (lambda a, t: (extra(a, t) if callable(extra) else extra) - wall), lift=lift)
    inner = [inner[1], inner[0]]
    tip = sum(outer[-1], Vector()) / len(outer[-1])
    cap = [tip + (p - tip) * 0.05 + Vector((0, 0, 0.002)) for p in outer[-1]]
    m.loft(inner + outer + [cap], (0, 0, 0), mat, cap='top', uv='box', **kw)
    return outer


# ================================================================== BALACLAVA (knitted, one opening for the eyes)
@model('Balaclava', 'Accessories', (0.0, -3.8, 1.0))
def _(m):
    zs = levels(-0.126, 0.030, 0.0048, must=(-0.0180, 0.0130)) + levels(0.030, 0.1190, 0.011)[1:]
    cols = sorted(set(face_columns(64)) | {-0.80, 0.80})       # as fine as the face, or the nose pokes through
    n = len(cols)
    grid = [[on_head(a, z, 0.0060) for a in cols] for z in zs]

    def build(pb):
        vs = [[pb.verts.new(p) for p in row] for row in grid]
        for j in range(len(zs) - 1):
            for i in range(n):
                k = (i + 1) % n
                a0, a1 = cols[i], cols[k]
                if -0.0180 <= zs[j] and zs[j + 1] <= 0.0130 and abs(a0) <= 0.80 and abs(a1) <= 0.80:
                    continue                                                    # the opening
                pb.faces.new((vs[j][i], vs[j][k], vs[j + 1][k], vs[j + 1][i]))
        top = pb.verts.new(on_head(0, 0.1195, 0.0060) + Vector((0, 0, 0.001)))
        for i in range(n):
            pb.faces.new((vs[-1][i], vs[-1][(i + 1) % n], top))

    m.raw(build, (0, 0, 0), Knit)
    m.lathe([(0.0640, -0.200), (0.0670, -0.150), (0.0660, -0.100), (0.0580, -0.082), (0.0540, -0.082), (0.0620, -0.100),
             (0.0630, -0.150), (0.0600, -0.200)], (0, -0.012, 0), Knit, seg=28, closed=True)             # the neck of the mask
    rim = [on_head(a, -0.0180, 0.0070) for a in cols if abs(a) <= 0.80]
    rim += [on_head(a, 0.0130, 0.0070) for a in reversed(cols) if abs(a) <= 0.80]
    m.sweep(rim, 0.0024, Knit, closed=True, seg=6, tint=0.7)                     # rolled edge of the opening
    m.torus(0.0690, 0.0070, (0, -0.012, -0.200), Knit, seg=28, sub=6, tint=0.8)  # hem


# ================================================================== COMBAT HELMET
@model('CombatHelmet', 'Accessories', (0.5, -3.8, 1.0))
def _(m):
    def edge(a):                              # above the brow, down over the ears, low at the nape
        a = abs(a)
        return 0.048 - 0.062 * smoothstep(0.75, 1.55, a) - 0.018 * smoothstep(1.9, 2.8, a)

    outer = shell_hat(m, HelmetShell, edge, 0.1190, lambda a, t: 0.021 + 0.004 * sin(t * pi), rows=12, wall=0.007)
    m.sweep([p + (p - Vector((0, 0, 0.03))).normalized() * 0.0012 for p in outer[0]], 0.0042, Rubber, closed=True, seg=6)   # edge trim
    band = crown_rows(lambda a: edge(a) + 0.030, 0.1190, 2, 0.0262)[0]
    m.sweep(band, 1.0, Webbing, closed=True, profile=[(-0.0012, -0.009), (0.0012, -0.009), (0.0012, 0.009), (-0.0012, 0.009)],
            up=(0, 0, 1))                                                         # cover band
    m.box((0.036, 0.010, 0.040), (0, 0, 0), Anodized, bevel=0.003, seg=1,
          matrix=Matrix.Translation(on_head(0, 0.070, 0.0285)) @ Matrix.Rotation(-0.28, 4, 'X'))   # night-vision mount
    for sx in (-1, 1):
        m.box((0.006, 0.075, 0.016), (0, 0, 0), Anodized, bevel=0.002, seg=1,
              matrix=Matrix.Translation(on_head(sx * 1.57, 0.030, 0.0275)) @ Matrix.Rotation(sx * 0.08, 4, 'Z'))   # side rails
        # chin strap: from the shell by the ear, down under the jaw
        strap = [on_head(sx * 1.30, -0.010, 0.016), on_head(sx * 1.05, -0.060, 0.006), on_head(sx * 0.70, -0.108, 0.004),
                 on_head(sx * 0.30, -0.124, 0.004), on_head(0, -0.126, 0.004)]
        m.sweep(strap, 1.0, Webbing, profile=[(-0.0010, -0.008), (0.0010, -0.008), (0.0010, 0.008), (-0.0010, 0.008)],
                up=(0, 1, 0), smooth=1)
        m.box((0.008, 0.016, 0.020), on_head(sx * 1.02, -0.064, 0.008), Polymer, bevel=0.002, seg=1)   # buckle
    m.sphere(1.0, on_head(0, -0.126, 0.006), Webbing, scale=(0.030, 0.016, 0.010), seg=12, rings=8)     # chin cup


# ================================================================== HARD HAT
@model('HardHat', 'Accessories', (1.0, -3.8, 1.0))
def _(m):
    def edge(a):
        return 0.046 - 0.008 * smoothstep(1.2, 2.6, abs(a))

    def stand(a, t):                          # three ridges run front to back over the crown
        ridge = 0.0045 * sum(g(sin(a) * 0.09 - x, 0.008) for x in (-0.030, 0.0, 0.030)) * sin(clamp(t * 1.15) * pi)
        return 0.024 + 0.008 * sin(t * pi * 0.9) + ridge

    outer = shell_hat(m, YellowPaint, edge, 0.1195, stand, rows=12, wall=0.004, lift=lambda t: 0.006 * t)
    brim = []                                 # a narrow lip all round, drawn out into a peak at the front
    for p, a in zip(outer[0], HAT_COLS):
        d = Vector((p.x, p.y, 0)).normalized()
        w = 0.010 + 0.042 * max(0.0, cos(a)) ** 3
        brim.append(p + d * w + Vector((0, 0, -0.004 - 0.012 * max(0.0, cos(a)) ** 3)))
    lower = [p + Vector((0, 0, -0.0035)) for p in outer[0]]
    under = [p + Vector((0, 0, -0.0035)) for p in brim]
    m.loft([lower, under, brim, outer[0]], (0, 0, 0), YellowPaint, cap=False, uv='box')
    for sx in (-1, 1):                        # accessory slots and the suspension pegs
        m.box((0.004, 0.022, 0.008), on_head(sx * 1.57, 0.062, 0.0262), Bore, wear=0)
    m.sweep([on_head(a, 0.050, 0.0030) for a in HAT_COLS], 1.0, Webbing, closed=True,
            profile=[(-0.0010, -0.011), (0.0010, -0.011), (0.0010, 0.011), (-0.0010, 0.011)], up=(0, 0, 1))   # headband


# ================================================================== POLICE CAP
@model('PoliceCap', 'Accessories', (1.5, -3.8, 1.0))
def _(m):
    band_lo = [on_head(a, 0.046 - 0.006 * smoothstep(1.2, 2.6, abs(a)), 0.0125) for a in HAT_COLS]
    band_hi = [p + Vector((0, 0, 0.034)) for p in band_lo]
    c = sum(band_hi, Vector()) / len(band_hi)
    flare, top = [], []
    for p, a in zip(band_hi, HAT_COLS):       # the crown flares out over the band and tips up at the front
        d = Vector((p.x - c.x, p.y - c.y, 0))
        up = 0.030 + 0.016 * max(0.0, cos(a))
        flare.append(p + d * 0.24 + Vector((0, 0, up)))
        top.append(c + d * 0.80 + Vector((0, 0, up + 0.014)))
    inner = [p * 0.97 + Vector((0, 0, 0.004)) for p in band_lo]
    m.loft([inner, band_lo, band_hi], (0, 0, 0), HazardBlack, cap=False, uv='box')                       # band
    tip = c + Vector((0, 0.004, 0.058))
    m.loft([band_hi, flare, top, [tip + (p - tip) * 0.05 for p in top]], (0, 0, 0), PoliceNavy, cap='top', uv='box')
    m.sweep(flare, 0.0030, PoliceNavy, closed=True, seg=6, tint=0.75)                                     # piping
    peak_in, peak_out = [], []
    for a in [x * 0.05 for x in range(-19, 20)]:                                                         # the peak
        p = on_head(a, 0.046, 0.0125)
        d = Vector((p.x * 0.35, p.y, 0)).normalized()
        w = 0.058 * cos(a * 1.55) ** 0.7
        peak_in.append(p)
        peak_out.append(p + d * w + Vector((0, 0, -0.020 * cos(a * 1.55))))
    m.loft([[p + Vector((0, 0, 0.0030)) for p in peak_in], [p + Vector((0, 0, 0.0030)) for p in peak_out],
            [p + Vector((0, 0, -0.0010)) for p in peak_out], [p + Vector((0, 0, -0.0010)) for p in peak_in]],
           (0, 0, 0), Visor, cap=False, wrap=False, uv='box')
    b = on_head(0, 0.064, 0.0140)
    m.box((0.026, 0.005, 0.034), (0, 0, 0), Badge, bevel=0.005, seg=2, taper=(1.0, 1.0),
          matrix=Matrix.Translation(b + Vector((0, 0.001, 0.002))) @ Matrix.Rotation(-0.10, 4, 'X'))       # badge
    m.sphere(0.0060, b + Vector((0, 0.004, 0.004)), Badge, scale=(1, 0.5, 1), seg=10, rings=6)
    m.sweep([on_head(a, 0.047, 0.0142) + Vector((0, 0, 0.003)) for a in [x * 0.1 for x in range(-8, 9)]], 0.0026, Badge, seg=6)   # chin strap over the peak
    for sx in (-1, 1):
        m.sphere(0.0045, on_head(sx * 0.82, 0.050, 0.0150), Badge, scale=(1, 1, 1), seg=10, rings=6)       # strap buttons
