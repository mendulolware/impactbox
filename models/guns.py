"""Firearms. Origin = the grip, barrel along +Y, sights on the centre line (x = 0).

REF records the points the game needs for each weapon (weapons.js VIEW): the height of the sight
line, where the muzzle is (y, z), and where the two hands go (y, z, pitch). build_models.py prints them.
"""
WZ = 1.0  # display height in the .blend
REF = globals().get('REF', {})


def rect_profile(w, t, c=None):
    """Cross-section for sweep(): a w-wide, t-thick bar with chamfered corners (use r = 1)."""
    c = min(w, t) * 0.25 if c is None else c
    a, b = t / 2, w / 2
    return [(-a + c, -b), (a - c, -b), (a, -b + c), (a, b - c), (a - c, b), (-a + c, b), (-a, b - c), (-a, -b + c)]


def barrel(m, r, r_in, y0, y1, z, mat, x=0.0, seg=None, chamfer=0.0008):
    """A barrel from y0 (breech end, buried in the gun) to y1 (muzzle) with a real bore you can look down."""
    m.tube(r, r_in, y1 - y0, (x, (y0 + y1) / 2, z), mat, rot=AXIS_YF, seg=seg, chamfer=chamfer)
    depth = min(0.05, (y1 - y0) * 0.8)
    m.cyl(r_in * 1.02, 0.001, (x, y1 - depth, z), Bore, rot=AXIS_YF, seg=10, wear=0)


def guard(m, pts, mat, w=0.011, t=0.0042, smooth=2):
    """Trigger guard: a flat bar bent through (y, z) points in the gun's centre plane."""
    m.sweep([(0, y, z) for y, z in pts], 1.0, mat, profile=rect_profile(w, t), up=(1, 0, 0), smooth=smooth)


def trigger(m, y, z, mat=None, h=0.024, curve=0.006, w=0.0062):
    """A curved trigger blade hanging down from (y, z)."""
    pts = [(y + 0.004, z), (y + 0.0045, z - h * 0.45), (y + 0.001 + curve, z - h), (y - 0.003 + curve, z - h),
           (y - 0.002, z - h * 0.5), (y - 0.003, z)]
    m.prism(pts, w, (0, 0, 0), mat or Gunmetal, bevel=0.0012, seg=1)


def pin(m, y, z, half_w, r=0.0022, mat=None):
    """A cross pin showing on both sides of a receiver."""
    m.cyl(r, half_w * 2 + 0.0006, (0, y, z), mat or Steel, rot=AXIS_X, seg=10, wear=0)


def screw(m, x, y, z, r=0.0022, mat=None):
    """A screw head on a side face (x picks the side)."""
    s = 1 if x > 0 else -1
    m.cyl(r, 0.0012, (x, y, z), mat or Steel, rot=AXIS_X, seg=10, bevel=0.0003, bseg=1)
    m.box((0.0004, r * 1.5, r * 0.3), (x + s * 0.0005, y, z), Bore, wear=0)


def serrations(m, y0, n, z, h, w, mat, pitch=0.0042, slant=-0.14):
    for i in range(n):
        m.box((w, 0.0017, h), (0, y0 + i * pitch, z), mat, rot=(slant, 0, 0), bevel=0.0004, seg=1, wear=0.35)


# ================================================================== PISTOL (striker-fired 9 mm)
@model('Pistol', 'Weapons', (0.0, -1.5, WZ))
def _(m):
    BZ = 0.034                                                                    # bore axis
    # -- slide
    m.prism([(-0.086, 0.0222), (-0.086, 0.0435), (-0.0835, 0.046), (0.1005, 0.046), (0.104, 0.0425),
             (0.104, 0.0245), (0.1015, 0.0222)], 0.0255, (0, 0, 0), Gunmetal, bevel=0.003, seg=2)
    serrations(m, -0.079, 8, 0.0345, 0.018, 0.0263, Gunmetal)
    serrations(m, 0.068, 5, 0.0345, 0.018, 0.0263, Gunmetal)
    m.box((0.0147, 0.041, 0.0105), (0.0060, 0.022, 0.0411), Bore, bevel=0.0006, seg=1, wear=0)       # ejection port
    m.box((0.0136, 0.036, 0.0102), (0.0064, 0.0215, 0.0414), Steel, bevel=0.0008, seg=1)             # barrel hood
    m.box((0.0014, 0.020, 0.0030), (0.0128, -0.006, 0.0385), Steel, bevel=0.0004, seg=1)             # extractor
    m.box((0.0235, 0.0014, 0.017), (0, -0.0864, 0.0330), Polymer, bevel=0.0005, seg=1)               # rear cover plate
    barrel(m, 0.0072, 0.0045, 0.086, 0.1062, BZ, Gunmetal)
    m.cyl(0.0030, 0.004, (0, 0.1028, 0.0256), Steel, rot=AXIS_YF, seg=10, bevel=0.0006)              # guide rod
    # -- sights: rear notch and front post, three white dots
    m.box((0.019, 0.011, 0.0035), (0, -0.0755, 0.0475), Gunmetal, bevel=0.0008, seg=1)
    for sx in (-1, 1):
        m.box((0.0058, 0.0085, 0.0048), (sx * 0.0064, -0.0765, 0.0506), Gunmetal, bevel=0.0005, seg=1, wear=0.3)
        m.cyl(0.0011, 0.0005, (sx * 0.0064, -0.0809, 0.0508), SightDot, rot=AXIS_Y, seg=8)
    m.box((0.0036, 0.0085, 0.007), (0, 0.0935, 0.0495), Gunmetal, bevel=0.0005, seg=1, taper=(1, 0.75), wear=0.3)
    m.cyl(0.0012, 0.0005, (0, 0.0891, 0.0506), SightDot, rot=AXIS_Y, seg=8)
    # -- frame with a single accessory slot under the dust cover
    m.prism([(-0.094, 0.0222), (0.097, 0.0222), (0.0985, 0.018), (0.0985, 0.0095), (0.096, 0.007),
             (0.043, 0.006), (0.037, 0.002), (-0.021, 0.002), (-0.029, 0.006), (-0.086, 0.0085),
             (-0.0985, 0.0125), (-0.0995, 0.0175)], 0.0285, (0, 0, 0), Polymer, bevel=0.0026, seg=2)
    m.box((0.0205, 0.048, 0.0045), (0, 0.069, 0.0042), Polymer, bevel=0.0009, seg=1)
    m.box((0.0212, 0.0042, 0.0030), (0, 0.073, 0.0030), Bore, wear=0)
    # -- grip: raked back, rounded section, stippled panels
    m.shaped([(-0.058, 0.012, 0.027, 0.060), (-0.0535, -0.004, 0.0285, 0.046), (-0.0570, -0.024, 0.0300, 0.045),
              (-0.0620, -0.046, 0.0305, 0.0465), (-0.0670, -0.068, 0.0300, 0.047),
              (-0.0710, -0.087, 0.0295, 0.0475)], Polymer, n=20, power=3.2, ends=0)
    m.box((0.0312, 0.026, 0.056), (0, -0.0620, -0.047), PolymerGrip, rot=(-0.226, 0, 0), bevel=0.005, seg=2)
    m.box((0.0315, 0.0500, 0.0080), (0, -0.0720, -0.091), Polymer, rot=(-0.226, 0, 0), bevel=0.0022, seg=2)   # baseplate
    m.box((0.024, 0.008, 0.004), (0, -0.0450, -0.0955), Polymer, rot=(-0.226, 0, 0), bevel=0.001, seg=1)      # its toe
    guard(m, [(0.040, 0.005), (0.0405, -0.026), (0.033, -0.0345), (-0.014, -0.0355), (-0.030, -0.029),
              (-0.0335, -0.018)], Polymer)
    trigger(m, 0.006, 0.003, Polymer, h=0.026)
    m.box((0.0022, 0.003, 0.012), (0, 0.0105, -0.012), PolymerGrip, rot=(0.12, 0, 0))                # trigger safety
    # -- controls
    m.box((0.0018, 0.026, 0.0042), (-0.0146, -0.047, 0.0172), Gunmetal, bevel=0.0006, seg=1)        # slide stop
    m.box((0.0034, 0.008, 0.0042), (-0.0150, -0.059, 0.0180), Gunmetal, bevel=0.001, seg=1)
    m.box((0.0296, 0.0085, 0.0036), (0, 0.016, 0.0130), Gunmetal, bevel=0.0008, seg=1)              # takedown tabs
    m.box((0.0042, 0.0085, 0.0065), (-0.0152, -0.0265, -0.0040), PolymerGrip, bevel=0.0012, seg=1)   # magazine release
    pin(m, -0.0015, 0.0105, 0.01425)
    pin(m, 0.016, 0.0185, 0.01425, r=0.0016)
    pin(m, -0.071, 0.0125, 0.01425, r=0.0018)
    REF['Pistol'] = dict(sight=0.053, muzzle=(0.1062, BZ), handR=(-0.0625, -0.046, -0.226), handL=(-0.080, -0.110, -0.226))


# ================================================================== REVOLVER (.357, 6 inch, full underlug)
@model('Revolver', 'Weapons', (3.0, -1.5, WZ))
def _(m):
    BZ, CZ, CR = 0.038, 0.0245, 0.0198                                            # bore, cylinder axis, cylinder radius
    m.prism([(-0.033, 0.0505), (-0.029, 0.0540), (0.030, 0.0540), (0.036, 0.0505), (0.036, 0.018),
             (0.033, 0.003), (0.022, -0.002), (-0.022, -0.004), (-0.044, -0.008), (-0.052, 0.002),
             (-0.046, 0.016), (-0.038, 0.030)], 0.0165, (0, 0, 0), Gunmetal, bevel=0.003, seg=2)   # frame
    # fluted cylinder: six scallops cut between the chambers
    rings = []
    for y, d in ((-0.0160, 0.0), (-0.0150, 0.0), (0.0020, 0.0), (0.0075, 0.0030), (0.0240, 0.0030), (0.0250, 0.0030)):
        ring = []
        for i in range(72):
            a = 2 * pi * i / 72
            s = ((a + pi / 6) % (pi / 3)) - pi / 6                                # angle from the nearest flute centre
            cut = d * max(0.0, 1 - (s / 0.33) ** 2)
            inset = 0.0006 if y in (-0.0160, 0.0250) else 0.0
            r = CR - cut - inset
            ring.append((r * cos(a), y, CZ + r * sin(a)))
        rings.append(ring)
    m.loft(rings, (0, 0, 0), Gunmetal, uv='box', grain=1)
    for k in range(6):                                                           # chamber mouths and cartridge rims
        a = pi / 2 + k * pi / 3
        m.cyl(0.0050, 0.0006, (0.0135 * cos(a), 0.0251, CZ + 0.0135 * sin(a)), Bore, rot=AXIS_YF, seg=12, wear=0)
        m.cyl(0.0056, 0.0012, (0.0135 * cos(a), -0.0166, CZ + 0.0135 * sin(a)), Brass, rot=AXIS_YF, seg=12, wear=0)
    for k in range(6):                                                           # locking notches
        a = pi / 2 + (k + 0.5) * pi / 3 + 0.2
        m.box((0.0034, 0.0055, 0.0012), (CR * cos(a), -0.009, CZ + CR * sin(a)), Bore, rot=(0, -(a - pi / 2), 0), wear=0)
    m.cyl(0.0030, 0.012, (0, 0.030, CZ), Steel, rot=AXIS_YF, seg=10)              # ejector rod stub
    # barrel: round on top, full-length lug underneath, ribbed sighting plane
    m.shaped([(0.036, 0.0318, 0.0186, 0.0325), (0.110, 0.0318, 0.0186, 0.0325), (0.1775, 0.0318, 0.0186, 0.0325)],
             Gunmetal, n=24, power=2.7, ends=0.82)
    barrel(m, 0.0080, 0.0046, 0.165, 0.1808, BZ, Gunmetal)
    m.box((0.0086, 0.140, 0.0040), (0, 0.106, 0.0495), Gunmetal, bevel=0.0008, seg=1)
    for i in range(22):
        m.box((0.0074, 0.0012, 0.0006), (0, 0.040 + i * 0.006, 0.0517), Gunmetal, wear=0.2)
    m.prism([(0.156, 0.0512), (0.1785, 0.0512), (0.1785, 0.058), (0.1735, 0.058)], 0.0032, (0, 0, 0), Gunmetal,
            bevel=0.0004, seg=1)                                                 # front ramp
    m.box((0.0022, 0.0008, 0.0040), (0, 0.1727, 0.0556), SightRed, rot=(-0.63, 0, 0), wear=0)
    # adjustable rear sight
    m.box((0.011, 0.030, 0.0030), (0, -0.014, 0.0552), Gunmetal, bevel=0.0008, seg=1)
    for sx in (-1, 1):
        m.box((0.0048, 0.0026, 0.0052), (sx * 0.0044, -0.0288, 0.0554), Gunmetal, bevel=0.0004, seg=1, wear=0.3)
    m.cyl(0.0019, 0.0125, (0, -0.022, 0.0560), Steel, rot=AXIS_X, seg=8)          # windage screw
    # hammer, trigger, guard
    m.prism([(-0.030, 0.034), (-0.033, 0.050), (-0.041, 0.0570), (-0.0480, 0.0570), (-0.0475, 0.0540),
             (-0.041, 0.048), (-0.039, 0.030)], 0.0072, (0, 0, 0), Steel, bevel=0.0012, seg=1)
    m.box((0.0085, 0.0075, 0.0022), (0, -0.0450, 0.0572), Steel, rot=(0.15, 0, 0), bevel=0.0005, seg=1)
    guard(m, [(0.025, -0.002), (0.0265, -0.026), (0.017, -0.0365), (-0.014, -0.0375), (-0.027, -0.030),
              (-0.031, -0.012)], Gunmetal, w=0.0105)
    trigger(m, -0.003, -0.004, Steel, h=0.025, w=0.0072)
    m.box((0.0032, 0.0115, 0.0085), (-0.0096, -0.0260, 0.0300), Gunmetal, bevel=0.0012, seg=1)      # cylinder latch
    for i in range(4):
        m.box((0.0036, 0.0011, 0.0078), (-0.0098, -0.0300 + i * 0.0028, 0.0300), Gunmetal, wear=0.3)
    for y, z in ((-0.006, 0.0005), (-0.034, 0.012), (0.026, 0.006)):
        screw(m, 0.0085, y, z)
    # walnut grips
    m.shaped([(-0.0430, 0.0060, 0.0240, 0.0400), (-0.0470, -0.0100, 0.0290, 0.0400), (-0.0550, -0.0320, 0.0325, 0.0440),
              (-0.0640, -0.0560, 0.0340, 0.0480), (-0.0730, -0.0800, 0.0335, 0.0520),
              (-0.0800, -0.0970, 0.0310, 0.0500)], Wood, n=20, power=2.4, ends=0.7)
    for sx in (-1, 1):
        m.cyl(0.0052, 0.0012, (sx * 0.0162, -0.0500, -0.0170), Brass, rot=AXIS_X, seg=14, bevel=0.0004, bseg=1)   # medallion
        screw(m, sx * 0.0172, -0.0660, -0.0560, r=0.0024, mat=Steel)
    REF['Revolver'] = dict(sight=0.058, muzzle=(0.1808, BZ), handR=(-0.062, -0.048, -0.35), handL=(-0.088, -0.118, -0.30))


# ================================================================== SMG (roller-delayed 9 mm, retractable stock)
@model('SMG', 'Weapons', (3.5, -1.5, WZ))
def _(m):
    BZ = 0.006
    # receiver: stamped box with a tube pressed into the top, strengthening ribs down the sides
    m.prism([(-0.115, -0.014), (-0.115, 0.030), (0.070, 0.030), (0.070, -0.006), (0.058, -0.014)], 0.0355,
            (0, 0, 0), Parkerized, bevel=0.004, seg=2)
    m.cyl(0.0185, 0.185, (0, -0.0225, 0.030), Parkerized, rot=AXIS_YF, seg=24)
    m.cyl(0.0132, 0.132, (0, 0.134, 0.0345), Parkerized, rot=AXIS_YF, seg=20, bevel=0.0015)        # cocking tube
    for z in (0.004, 0.017):
        m.box((0.0368, 0.120, 0.0036), (0, -0.040, z), Parkerized, bevel=0.0012, seg=1, wear=0.6)
    m.box((0.0020, 0.044, 0.0130), (0.0178, 0.022, 0.0240), Bore, bevel=0.0005, seg=1, wear=0)       # ejection port
    m.box((0.0020, 0.038, 0.0095), (0.0182, 0.020, 0.0240), Steel, bevel=0.0008, seg=1)              # bolt
    m.box((0.0022, 0.088, 0.0042), (-0.0125, 0.132, 0.0390), Bore, rot=(0, 0.6, 0), wear=0)          # cocking slot
    m.cyl(0.0050, 0.022, (-0.0225, 0.158, 0.0450), Polymer, rot=(0, -pi / 2 + 0.6, 0), seg=12, bevel=0.0012)
    m.box((0.0360, 0.016, 0.050), (0, -0.1215, 0.010), Parkerized, bevel=0.004, seg=2)               # end cap
    # handguard, barrel, three-lug muzzle
    m.shaped([(0.066, 0.006, 0.0400, 0.0460), (0.120, 0.005, 0.0410, 0.0470), (0.186, 0.006, 0.0370, 0.0430)],
             Polymer, n=20, power=3.0, ends=0.75)
    for i in range(5):
        for sx in (-1, 1):
            m.box((0.0020, 0.0110, 0.0040), (sx * 0.0200, 0.090 + i * 0.018, 0.012), Bore, wear=0)   # vents
    barrel(m, 0.0078, 0.0046, 0.170, 0.2650, BZ, Parkerized)
    for k in range(3):
        a = pi / 2 + k * 2 * pi / 3
        m.box((0.0040, 0.0070, 0.0030), (0.0085 * cos(a), 0.246, BZ + 0.0085 * sin(a)), Parkerized,
              rot=(0, -(a - pi / 2), 0), bevel=0.0006, seg=1)
    # front sight tower with a protective ring, rear drum sight
    m.box((0.0115, 0.0140, 0.0260), (0, 0.196, 0.046), Parkerized, bevel=0.002, seg=1)
    m.torus(0.0098, 0.0021, (0, 0.196, 0.0615), Parkerized, rot=AXIS_Y, seg=24, sub=8)
    m.box((0.0019, 0.0019, 0.0105), (0, 0.196, 0.0568), Parkerized, wear=0.2)
    m.box((0.0220, 0.0300, 0.0060), (0, -0.085, 0.0500), Parkerized, bevel=0.0015, seg=1)
    m.gear(0.0098, 0.0125, (0, -0.085, 0.0590), Parkerized, teeth=16, cut=0.0008)
    m.box((0.0034, 0.0210, 0.0050), (0, -0.085, 0.0640), Bore, wear=0)                               # sighting notch
    # magazine: curved, ribbed
    m.box((0.0300, 0.0440, 0.0300), (0, 0.036, -0.024), Parkerized, bevel=0.003, seg=1)              # magazine well
    m.sweep([(0, 0.0355, -0.030), (0, 0.0375, -0.075), (0, 0.0440, -0.118), (0, 0.0560, -0.160)], 1.0, Gunmetal,
            profile=rect_profile(0.0235, 0.0335, 0.004), up=(1, 0, 0), smooth=2)
    for z, y in ((-0.062, 0.0368), (-0.094, 0.0402), (-0.126, 0.0455)):
        for sx in (-1, 1):
            m.box((0.0012, 0.0220, 0.0040), (sx * 0.0118, y, z), Gunmetal, rot=(-0.14, 0, 0), bevel=0.0005, seg=1, wear=0.5)
    m.box((0.0260, 0.0380, 0.0050), (0, 0.0575, -0.1630), Gunmetal, rot=(-0.28, 0, 0), bevel=0.0012, seg=1)
    m.box((0.0060, 0.0100, 0.0220), (0, 0.0100, -0.0300), Parkerized, rot=(0.2, 0, 0), bevel=0.0012, seg=1)   # paddle release
    # trigger housing and pistol grip (one polymer moulding)
    m.box((0.0340, 0.1100, 0.0230), (0, -0.0500, -0.0250), Polymer, bevel=0.0045, seg=2)
    m.shaped([(-0.0575, -0.030, 0.0300, 0.0440), (-0.0640, -0.055, 0.0310, 0.0450), (-0.0720, -0.085, 0.0310, 0.0470),
              (-0.0790, -0.112, 0.0300, 0.0480)], Polymer, n=20, power=3.0, ends=0.75)
    m.box((0.0316, 0.0240, 0.0520), (0, -0.0690, -0.0760), PolymerGrip, rot=(-0.25, 0, 0), bevel=0.005, seg=2)
    guard(m, [(0.0100, -0.0340), (0.0105, -0.0570), (0.0020, -0.0655), (-0.0300, -0.0660), (-0.0420, -0.0570)], Polymer)
    trigger(m, -0.0170, -0.0345, Steel, h=0.024)
    m.cyl(0.0052, 0.0030, (-0.0180, -0.0380, -0.0200), Polymer, rot=AXIS_X, seg=14)                  # selector
    m.box((0.0024, 0.0200, 0.0052), (-0.0190, -0.0300, -0.0190), Polymer, rot=(0.35, 0, 0), bevel=0.0008, seg=1)
    m.cyl(0.0014, 0.0006, (-0.0173, -0.0560, -0.0160), SightDot, rot=AXIS_X, seg=8)
    m.cyl(0.0014, 0.0006, (-0.0173, -0.0520, -0.0225), SightRed, rot=AXIS_X, seg=8)
    pin(m, 0.0050, -0.0080, 0.0178)
    pin(m, -0.0900, -0.0080, 0.0178)
    # retractable stock
    for sx in (-1, 1):
        m.cyl(0.0042, 0.2300, (sx * 0.0205, -0.2200, 0.0120), Parkerized, rot=AXIS_YF, seg=10)
    m.prism([(-0.330, 0.058), (-0.346, 0.054), (-0.348, -0.048), (-0.332, -0.052), (-0.326, -0.020), (-0.326, 0.030)],
            0.0440, (0, 0, 0), Rubber, bevel=0.005, seg=2)
    for z in (-0.030, -0.010, 0.010, 0.030):
        m.box((0.0380, 0.0020, 0.0060), (0, -0.3485, z), Rubber, wear=0)
    m.torus(0.0070, 0.0016, (-0.0190, 0.2020, 0.0340), Steel, rot=AXIS_X, seg=14, sub=6)             # sling loop
    REF['SMG'] = dict(sight=0.0615, muzzle=(0.265, BZ), handR=(-0.068, -0.072, -0.25), handL=(0.125, -0.021, 0.0))


# ================================================================== SHOTGUN (12 gauge pump, wood furniture)
@model('Shotgun', 'Weapons', (0.5, -1.5, WZ))
def _(m):
    BZ, TZ = 0.016, -0.014                                                        # bore, magazine tube
    m.prism([(-0.100, -0.020), (-0.100, 0.026), (-0.086, 0.034), (0.100, 0.034), (0.100, -0.033), (-0.020, -0.033),
             (-0.062, -0.030)], 0.0410, (0, 0, 0), Parkerized, bevel=0.0075, seg=3)                 # receiver
    m.box((0.0020, 0.0640, 0.0210), (0.0198, 0.024, 0.0150), Bore, bevel=0.0006, seg=1, wear=0)     # ejection port
    m.box((0.0020, 0.0600, 0.0165), (0.0201, 0.022, 0.0150), Chrome, bevel=0.0012, seg=1)           # bolt
    m.box((0.0010, 0.0100, 0.0040), (0.0212, 0.046, 0.0190), Bore, wear=0)                          # extractor cut
    m.box((0.0240, 0.0760, 0.0020), (0, 0.048, -0.0325), Bore, wear=0)                              # loading port
    m.box((0.0200, 0.0700, 0.0015), (0, 0.047, -0.0322), Steel, rot=(0.04, 0, 0))                   # shell lifter
    m.box((0.0230, 0.0900, 0.0070), (0, -0.040, -0.0340), Parkerized, bevel=0.002, seg=1)           # trigger plate
    guard(m, [(0.003, -0.0360), (0.0035, -0.0580), (-0.0070, -0.0670), (-0.0500, -0.0670), (-0.0650, -0.0570),
              (-0.0710, -0.0400)], Parkerized, w=0.0120)
    trigger(m, -0.0360, -0.0365, Steel, h=0.023)
    m.cyl(0.0034, 0.0260, (0, -0.0640, -0.0400), Steel, rot=AXIS_X, seg=10, bevel=0.0006)           # safety button
    pin(m, 0.0100, -0.0170, 0.0205)
    pin(m, -0.0520, -0.0200, 0.0205)
    # barrel, magazine tube, bead
    barrel(m, 0.0128, 0.0092, 0.090, 0.630, BZ, Parkerized)
    m.cyl(0.0012, 0.0080, (0, 0.6180, 0.0325), Parkerized, seg=6)
    m.sphere(0.0030, (0, 0.6180, 0.0370), Brass, seg=10, rings=8)
    m.cyl(0.0118, 0.4100, (0, 0.3050, TZ), Parkerized, rot=AXIS_YF, seg=18)
    m.gear(0.0130, 0.0240, (0, 0.5200, TZ), Parkerized, rot=AXIS_YF, teeth=20, cut=0.0008, bevel=0.0012)
    m.tube(0.0158, 0.0125, 0.0130, (0, 0.4700, BZ), Parkerized, rot=AXIS_YF, chamfer=0.001)          # barrel clamp
    m.tube(0.0148, 0.0115, 0.0130, (0, 0.4700, TZ), Parkerized, rot=AXIS_YF, chamfer=0.001)
    # pump: ribbed wooden forend riding the tube on two steel bars
    prof = [(0.0125, -0.098), (0.0215, -0.094)]
    for i in range(13):
        z0 = -0.090 + i * 0.014
        prof += [(0.0242, z0), (0.0242, z0 + 0.0088), (0.0222, z0 + 0.0100), (0.0222, z0 + 0.0128)]
    prof += [(0.0215, 0.094), (0.0125, 0.098)]
    m.lathe(prof, (0, 0.270, TZ), Wood, rot=AXIS_YF, seg=24)
    for sx in (-1, 1):
        m.box((0.0022, 0.1500, 0.0085), (sx * 0.0150, 0.1500, -0.0040), Steel, bevel=0.0006, seg=1)
    # stock and recoil pad
    m.shaped([(-0.094, 0.0020, 0.0400, 0.0580), (-0.128, -0.0080, 0.0360, 0.0470), (-0.168, -0.0170, 0.0360, 0.0490),
              (-0.250, -0.0290, 0.0400, 0.0780), (-0.340, -0.0400, 0.0420, 0.1060), (-0.424, -0.0480, 0.0430, 0.1220)],
             Wood, n=24, power=2.6, ends=0)
    m.shaped([(-0.424, -0.0480, 0.0432, 0.1225), (-0.446, -0.0500, 0.0430, 0.1220)], Rubber, n=24, power=2.6, ends=0.82)
    m.box((0.0420, 0.0015, 0.1180), (0, -0.4255, -0.0482), Bore, rot=(-0.10, 0, 0), wear=0)          # pad spacer line
    for y, z in ((-0.360, -0.0990), (0.5050, -0.0270)):
        m.cyl(0.0030, 0.0100, (0, y, z), Steel, seg=8)
        m.torus(0.0090, 0.0014, (0, y, z - 0.0120), Steel, rot=AXIS_X, seg=16, sub=6)
    REF['Shotgun'] = dict(sight=0.040, muzzle=(0.630, BZ), handR=(-0.135, -0.038, -0.70), handL=(0.270, -0.040, 0.0))
