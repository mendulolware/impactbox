"""Things in the yard. Origin = centre of the physics collider (sizes are in props.js TYPES).
ground=True tells the bake that the model stands on a floor, so its underside is shaded."""
import random

T = Matrix.Translation


def RX(a):
    return Matrix.Rotation(a, 4, 'X')


def RY(a):
    return Matrix.Rotation(a, 4, 'Y')


def RZ(a):
    return Matrix.Rotation(a, 4, 'Z')


def label(m, r, z0, z1, a0, a1, mat, seg=6, **kw):
    """A painted patch wrapped round a cylinder of radius r (a thin sliver, so it has a definite outside)."""
    m.lathe([(r, z0), (r, z1), (r - 0.004, z1), (r - 0.004, z0)], (0, 0, 0), mat, seg=seg, arc=(a0, a1), closed=True, **kw)


# ================================================================== CRATE (0.6 m shipping crate)
@model('Crate', 'Props', (0.0, 0, 0.3), ground=True)
def _(m):
    rnd = random.Random(3)
    S, t = 0.560, 0.018                                         # panel size, plank thickness
    m.box((S - 0.02, S - 0.02, S - 0.02), (0, 0, 0), Bore, wear=0)   # the dark inside, seen through the gaps

    def face(M, brace):
        n = 5
        w = (S - 0.010) / n
        for i in range(n):
            x = -S / 2 + 0.005 + w * (i + 0.5)
            m.box((w - 0.005, S - 0.008, t), (0, 0, 0), CrateWood, bevel=0.0025, seg=1, grain=1,
                  tint=rnd.uniform(0.78, 1.1), matrix=M @ T((x, rnd.uniform(-0.002, 0.002), S / 2 - t / 2)))
        z = S / 2 + 0.010
        for s in (-1, 1):
            m.box((S + 0.036, 0.072, 0.020), (0, 0, 0), CrateFrame, bevel=0.003, seg=1, grain=0,
                  tint=rnd.uniform(0.85, 1.1), matrix=M @ T((0, s * (S / 2 - 0.018), z)))
            m.box((0.072, S - 0.108, 0.020), (0, 0, 0), CrateFrame, bevel=0.003, seg=1, grain=1,
                  tint=rnd.uniform(0.85, 1.1), matrix=M @ T((s * (S / 2 - 0.018), 0, z)))
            for s2 in (-1, 1):
                for inset in (0.020, 0.050):
                    m.cyl(0.0042, 0.003, (0, 0, 0), Iron, seg=6, wear=0,
                          matrix=M @ T((s * (S / 2 - inset), s2 * (S / 2 - 0.020), z + 0.0105)))
        if brace:
            m.box((0.068, S * 1.12, 0.019), (0, 0, 0), CrateFrame, bevel=0.003, seg=1, grain=1,
                  tint=rnd.uniform(0.85, 1.05), matrix=M @ T((0, 0, z - 0.0008)) @ RZ(pi / 4 * brace))

    face(Matrix.Identity(4), 0)
    face(RX(pi), 0)
    face(RX(pi / 2), 1)
    face(RX(-pi / 2), -1)
    face(RY(pi / 2), 1)
    face(RY(-pi / 2), -1)
    for i, wd in enumerate((0.16, 0.10, 0.13)):                 # stencilled marking on the lid
        m.box((wd, 0.022, 0.0012), (-0.06 + i * 0.01, 0.06 - i * 0.045, S / 2 + 0.0004), HazardBlack, wear=0)


# ================================================================== STEEL DRUMS
def drum(m, paint, band=False):
    m.lathe([(0.0, -0.432), (0.270, -0.432), (0.274, -0.448), (0.280, -0.430), (0.280, -0.170), (0.2885, -0.160),
             (0.2885, -0.150), (0.280, -0.140), (0.280, 0.140), (0.2885, 0.150), (0.2885, 0.160), (0.280, 0.170),
             (0.280, 0.430), (0.274, 0.448), (0.270, 0.432), (0.0, 0.432)], (0, 0, 0), paint, seg=32)
    for z in (-0.441, 0.441):
        m.torus(0.279, 0.0095, (0, 0, z), BarrelRim, seg=32, sub=8)                # chimes
    m.torus(0.200, 0.004, (0, 0, 0.432), paint, seg=28, sub=6)                     # pressed ring in the lid
    m.gear(0.038, 0.014, (0.170, 0, 0.438), BarrelRim, teeth=8, cut=0.004, bevel=0.002)    # bungs
    m.cyl(0.020, 0.010, (0.170, 0, 0.447), BarrelRim, seg=12, bevel=0.002)
    m.gear(0.020, 0.012, (-0.185, 0.03, 0.437), BarrelRim, teeth=6, cut=0.003, bevel=0.002)
    if band:
        m.tube(0.2814, 0.2790, 0.210, (0, 0, 0), Hazard, seg=32)
        for k in range(10):                                                         # black bars round the band
            a = k * 2 * pi / 10
            label(m, 0.2822, -0.100, 0.100, a, a + 0.26, HazardBlack, seg=3, wear=0)
        label(m, 0.2816, 0.215, 0.395, -0.32, 0.32, WhitePaint)                     # warning label
        label(m, 0.2824, 0.300, 0.380, -0.22, 0.22, RedPaint, seg=4, wear=0)
        for z in (0.275, 0.255, 0.235):
            label(m, 0.2824, z, z + 0.008, -0.24, 0.20 - (z < 0.25) * 0.15, HazardBlack, seg=4, wear=0)


@model('Barrel', 'Props', (1.0, 0, 0.45), ground=True)
def _(m):
    drum(m, BarrelBlue)


@model('ExplosiveBarrel', 'Props', (2.0, 0, 0.45), ground=True)
def _(m):
    drum(m, BarrelRed, band=True)


# ================================================================== HEAVY BLOCK (1 m cast concrete, lifting loops)
@model('Block', 'Props', (3.3, 0, 0.5), ground=True)
def _(m):
    m.box((1.0, 1.0, 1.0), (0, 0, 0), Concrete, bevel=0.035, seg=2)
    for sx in (-1, 1):                                                              # forklift pockets
        for sy in (-1, 1):
            m.box((0.24, 0.012, 0.11), (sx * 0.24, sy * 0.4995, -0.42), Bore, wear=0)
            m.box((0.012, 0.24, 0.11), (sy * 0.4995, sx * 0.24, -0.42), Bore, wear=0)
    for s in (-1, 1):                                                               # formwork seams
        m.box((1.004, 0.010, 0.006), (0, 0, s * 0.18), ConcreteDark, wear=0)
        m.box((0.010, 1.004, 0.006), (0, 0, s * 0.18), ConcreteDark, wear=0)
    for sx in (-1, 1):                                                              # rebar lifting loops
        pts = [(sx * 0.25 - 0.07, 0, 0.46)]
        for i in range(9):
            a = pi - i * pi / 8
            pts.append((sx * 0.25 + 0.07 * cos(a), 0, 0.50 + 0.075 * sin(a)))
        pts.append((sx * 0.25 + 0.07, 0, 0.46))
        m.sweep(pts, 0.011, Rebar, seg=8)
    for i, (x, w) in enumerate(((-0.2, 0.22), (0.08, 0.14))):                       # stencilled weight
        m.box((w, 0.002, 0.05), (x, -0.5008, 0.28), HazardBlack, wear=0)


# ================================================================== PLANK (scaffold board)
@model('Plank', 'Props', (1.5, 1.5, 0.05), ground=True)
def _(m):
    m.box((2.2, 0.28, 0.095), (0, 0, 0), CrateWood, bevel=0.006, seg=2, grain=0)
    for sx in (-1, 1):
        m.box((0.045, 0.284, 0.099), (sx * 1.065, 0, 0), Galvanized, bevel=0.002, seg=1)   # end bands
        for sy in (-1, 0, 1):
            m.cyl(0.006, 0.004, (sx * 1.065, sy * 0.09, 0.0505), Iron, seg=6, wear=0)
    for x, y, r in ((-0.55, 0.05, 0.02), (0.3, -0.07, 0.014), (0.72, 0.03, 0.017)):         # knots
        m.cyl(r, 0.0006, (x, y, 0.0478), CrateFrame, seg=10, wear=0, tint=0.7)


# ================================================================== CHAIR (wooden)
@model('Chair', 'Props', (0.0, 3.5, 0.45), ground=True)
def _(m):
    rnd = random.Random(5)
    Z0 = -0.45
    for sx in (-1, 1):                                                              # front legs
        m.box((0.038, 0.038, 0.44), (sx * 0.195, 0.180, Z0 + 0.22), WoodPale, bevel=0.005, seg=1, taper=(1.25, 1.25),
              grain=2, tint=rnd.uniform(0.9, 1.05))
        # back legs run straight up into the backrest posts, raked back
        m.shaped([(-0.195 + 0.012, Z0, 0.036, 0.040), (-0.190, Z0 + 0.44, 0.040, 0.044), (-0.205, Z0 + 0.68, 0.036, 0.038),
                  (-0.222, Z0 + 0.90, 0.032, 0.030)], WoodPale, n=10, power=4.0, x=sx * 0.195, ends=0.8,
                 tint=rnd.uniform(0.9, 1.05), grain=2)
        m.box((0.022, 0.340, 0.030), (sx * 0.195, -0.005, Z0 + 0.17), WoodPale, bevel=0.004, seg=1, grain=1)   # side stretchers
        m.box((0.026, 0.350, 0.060), (sx * 0.195, -0.005, Z0 + 0.405), WoodPale, bevel=0.004, seg=1, grain=1)  # seat rails
    for y in (0.180, -0.190):
        m.box((0.360, 0.026, 0.060), (0, y, Z0 + 0.405), WoodPale, bevel=0.004, seg=1, grain=0)
    m.box((0.360, 0.022, 0.030), (0, 0.180, Z0 + 0.12), WoodPale, bevel=0.004, seg=1, grain=0)
    m.box((0.450, 0.420, 0.026), (0, 0.005, Z0 + 0.450), WoodPale, bevel=0.010, seg=3, grain=1, tint=1.04)     # seat
    m.box((0.400, 0.030, 0.075), (0, -0.2200, Z0 + 0.855), WoodPale, rot=(-0.07, 0, 0), bevel=0.008, seg=2, grain=0)   # top rail
    m.box((0.400, 0.024, 0.040), (0, -0.2040, Z0 + 0.620), WoodPale, rot=(-0.07, 0, 0), bevel=0.006, seg=2, grain=0)
    for x in (-0.11, 0.0, 0.11):                                                    # slats
        m.box((0.050, 0.014, 0.210), (x, -0.2120, Z0 + 0.735), WoodPale, rot=(-0.07, 0, 0), bevel=0.004, seg=1, grain=2,
              tint=rnd.uniform(0.9, 1.05))


# ================================================================== TABLE (wooden)
@model('Table', 'Props', (1.6, 3.5, 0.38), ground=True)
def _(m):
    rnd = random.Random(9)
    Z0 = -0.38
    for i in range(5):                                                              # top: five boards
        m.box((1.200, 0.1585, 0.034), (0, -0.320 + i * 0.160, Z0 + 0.743), WoodPale, bevel=0.004, seg=1, grain=0,
              tint=rnd.uniform(0.86, 1.06))
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.box((0.070, 0.070, 0.726), (sx * 0.535, sy * 0.335, Z0 + 0.363), WoodPale, bevel=0.006, seg=1,
                  taper=(1.0, 1.0), grain=2, tint=rnd.uniform(0.86, 1.02))
        m.box((0.024, 0.600, 0.095), (sx * 0.535, 0, Z0 + 0.672), WoodPale, bevel=0.004, seg=1, grain=1)        # apron
    for sy in (-1, 1):
        m.box((1.000, 0.024, 0.095), (0, sy * 0.335, Z0 + 0.672), WoodPale, bevel=0.004, seg=1, grain=0)
    m.box((1.060, 0.050, 0.030), (0, 0, Z0 + 0.20), WoodPale, bevel=0.004, seg=1, grain=0)                       # stretcher
    for sx in (-1, 1):
        m.box((0.030, 0.640, 0.050), (sx * 0.535, 0, Z0 + 0.20), WoodPale, bevel=0.004, seg=1, grain=1)


# ================================================================== TRAFFIC CONE
@model('TrafficCone', 'Props', (2.7, 3.5, 0.35), ground=True)
def _(m):
    Z0 = -0.35

    def r_at(z):
        return 0.128 - (z - 0.040) * (0.098 / 0.650)

    m.box((0.340, 0.340, 0.028), (0, 0, Z0 + 0.014), Rubber, bevel=0.008, seg=2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.cyl(0.020, 0.006, (sx * 0.135, sy * 0.135, Z0 + 0.003), Rubber, seg=10)                # feet
    m.lathe([(0.150, 0.026), (0.150, 0.034), (0.132, 0.040), (r_at(0.69), 0.690), (r_at(0.69) - 0.004, 0.700),
             (0.014, 0.700), (0.014, 0.660), (0.0, 0.660)], (0, 0, Z0), TrafficOrange, seg=28)
    for z0, z1 in ((0.330, 0.450), (0.520, 0.590)):
        m.lathe([(r_at(z0) + 0.0012, z0), (r_at(z1) + 0.0012, z1)], (0, 0, Z0), Reflective, seg=28)   # reflective sleeves


# ================================================================== PROPANE TANK
@model('PropaneTank', 'Props', (3.6, 3.5, 0.26), ground=True)
def _(m):
    m.lathe([(0.0, -0.212), (0.060, -0.210), (0.110, -0.197), (0.141, -0.170), (0.152, -0.135), (0.152, 0.085),
             (0.143, 0.120), (0.114, 0.150), (0.062, 0.168), (0.030, 0.172), (0.0, 0.172)], (0, 0, 0), WhitePaint, seg=28)
    m.torus(0.1525, 0.0025, (0, 0, -0.030), WhitePaint, seg=28, sub=6, wear=1.5)                     # weld seam
    m.lathe([(0.104, -0.260), (0.108, -0.258), (0.108, -0.190), (0.102, -0.190), (0.102, -0.254), (0.098, -0.256),
             (0.098, -0.260)], (0, 0, 0), WhitePaint, seg=28, closed=True)                           # foot ring
    for a in (0.35, 0.35 + pi):                                                                      # collar: two guards
        m.lathe([(0.100, 0.135), (0.104, 0.135), (0.104, 0.250), (0.108, 0.254), (0.108, 0.260), (0.100, 0.260)],
                (0, 0, 0), WhitePaint, seg=12, arc=(a, a + 2.4), closed=True)
    m.cyl(0.017, 0.050, (0, 0, 0.192), Brass, seg=12, bevel=0.002)                                    # valve
    m.cyl(0.011, 0.045, (0.030, 0, 0.196), Brass, rot=AXIS_X, seg=10, bevel=0.0015)
    m.gear(0.017, 0.012, (0.056, 0, 0.196), Brass, rot=AXIS_X, teeth=6, cut=0.002)
    m.cyl(0.006, 0.020, (0, 0, 0.225), Brass, seg=8)
    m.gear(0.034, 0.012, (0, 0, 0.240), Polymer, teeth=5, cut=0.008, bevel=0.003)                    # hand wheel
    label(m, 0.1528, -0.040, 0.060, -0.42, 0.42, RedPaint, wear=0.5)                                  # label
    label(m, 0.1536, 0.010, 0.045, -0.30, 0.30, WhitePaint, seg=4, wear=0)
    for z in (-0.005, -0.020):
        label(m, 0.1536, z, z + 0.007, -0.30, 0.12, WhitePaint, seg=4, wear=0)


# ================================================================== PALLET
@model('WoodenPallet', 'Props', (5.0, 3.5, 0.072), ground=True)
def _(m):
    rnd = random.Random(11)
    for y in (-0.3775, 0.0, 0.3775):                                                # stringers
        m.box((1.200, 0.045, 0.100), (0, y, 0), CrateFrame, bevel=0.003, seg=1, grain=0, tint=rnd.uniform(0.85, 1.1))
        for x in (-0.33, 0.33):
            m.box((0.230, 0.047, 0.036), (x, y, -0.033), Bore, wear=0)              # fork notches
    for i in range(7):                                                              # top deck
        x = -0.5525 + i * (1.105 / 6)
        m.box((0.095, 0.800, 0.022), (x, rnd.uniform(-0.003, 0.003), 0.061), CrateWood, bevel=0.003, seg=1, grain=1,
              tint=rnd.uniform(0.75, 1.1), rot=(0, 0, rnd.uniform(-0.006, 0.006)))
        for y in (-0.3775, 0.0, 0.3775):
            for dx in (-0.022, 0.022):
                m.cyl(0.0038, 0.002, (x + dx, y, 0.0725), Iron, seg=6, wear=0)
    for x in (-0.5525, 0.0, 0.5525):                                                # bottom boards
        m.box((0.095, 0.800, 0.022), (x, 0, -0.061), CrateWood, bevel=0.003, seg=1, grain=1, tint=rnd.uniform(0.7, 1.0))


# ================================================================== DUMPSTER
@model('Dumpster', 'Props', (7.1, 3.5, 0.74), ground=True, ao_dist=0.45)
def _(m):
    m.prism([(-0.480, -0.600), (0.440, -0.600), (0.500, 0.360), (-0.480, 0.620)], 1.720, (0, 0, 0), DumpsterGreen,
            bevel=0.012, seg=2, grain=1)                                            # body
    slope = atan2(-0.260, 0.980)
    for sx in (-1, 1):
        # fork pockets down each side
        m.box((0.075, 0.800, 0.190), (sx * 0.8625, 0.020, 0.060), DumpsterGreen, bevel=0.010, seg=2)
        m.box((0.055, 0.010, 0.150), (sx * 0.8625, 0.4215, 0.060), Bore, wear=0)
        m.box((0.055, 0.010, 0.150), (sx * 0.8625, -0.3815, 0.060), Bore, wear=0)
        for y in (-0.300, 0.250):                                                   # side ribs
            m.box((0.030, 0.050, 0.560), (sx * 0.872, y, -0.310), DumpsterGreen, bevel=0.006, seg=1)
        # lids: two plastic panels hinged at the back
        m.box((0.850, 1.030, 0.026), (sx * 0.432, 0.012, 0.512), LidPlastic, rot=(slope, 0, 0), bevel=0.008, seg=2)
        for k in range(4):
            d = -0.330 + k * 0.230                                                  # distance down the lid
            m.box((0.760, 0.030, 0.016), (sx * 0.432, 0.012 + d * cos(slope) - 0.018 * sin(slope),
                                          0.512 + d * sin(slope) + 0.018 * cos(slope)),
                  LidPlastic, rot=(slope, 0, 0), bevel=0.005, seg=1)                # lid ribs
        m.box((0.120, 0.060, 0.030), (sx * 0.432, 0.012 + 0.500 * cos(slope), 0.512 + 0.500 * sin(slope) + 0.004),
              LidPlastic, rot=(slope, 0, 0), bevel=0.008, seg=2)                    # lid handle
        for sy in (-1, 1):                                                          # casters
            y = sy * 0.380
            m.box((0.070, 0.090, 0.012), (sx * 0.720, y, -0.606), Iron, bevel=0.002, seg=1)
            for s2 in (-1, 1):
                m.box((0.006, 0.060, 0.090), (sx * 0.720 + s2 * 0.030, y - 0.012, -0.655), Iron, bevel=0.001, seg=1,
                      rot=(0.25, 0, 0))
            m.cyl(0.062, 0.042, (sx * 0.720, y - 0.024, -0.678), Rubber, rot=AXIS_X, seg=18, bevel=0.008)
            m.cyl(0.026, 0.046, (sx * 0.720, y - 0.024, -0.678), Iron, rot=AXIS_X, seg=10)
    for x in (-0.560, 0.0, 0.560):                                                  # front ribs
        m.box((0.050, 0.030, 0.900), (x, 0.4855, -0.125), DumpsterGreen, rot=(-0.0624, 0, 0), bevel=0.006, seg=1)
    m.box((1.740, 0.050, 0.050), (0, 0.500, 0.362), DumpsterGreen, bevel=0.008, seg=1)               # front lip
    m.cyl(0.020, 1.760, (0, -0.492, 0.626), Iron, rot=AXIS_X, seg=10)                                 # hinge bar
    m.box((0.560, 0.004, 0.200), (-0.250, 0.4690 + 0.030, -0.040), WhitePaint, rot=(-0.0624, 0, 0), wear=1.2)   # label panel
    for i, w in enumerate((0.42, 0.30)):
        m.box((w, 0.004, 0.040), (-0.250 - (0.42 - w) / 2 * 0 - 0.02 * i, 0.4720 + 0.030, 0.005 - i * 0.075), HazardBlack,
              rot=(-0.0624, 0, 0), wear=0)
    m.cyl(0.022, 0.030, (0.700, 0.455, -0.560), Iron, rot=AXIS_YF, seg=10, bevel=0.003)               # drain plug


# ================================================================== STREET LAMP
@model('StreetLamp', 'Props', (9.0, 4.5, 2.1), ground=True, ao_dist=0.3)
def _(m):
    Z0 = -2.1
    m.box((0.300, 0.300, 0.022), (0, 0, Z0 + 0.011), Galvanized, bevel=0.004, seg=1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.gear(0.017, 0.016, (sx * 0.110, sy * 0.110, Z0 + 0.030), Iron, teeth=3, cut=0.0025)     # anchor nuts
            m.cyl(0.009, 0.040, (sx * 0.110, sy * 0.110, Z0 + 0.040), Iron, seg=8)
    m.lathe([(0.105, 0.022), (0.092, 0.060), (0.086, 0.500), (0.078, 0.540), (0.072, 1.200), (0.050, 4.000),
             (0.050, 4.060), (0.0, 4.060)], (0, 0, Z0), Galvanized, seg=16)                            # tapered pole
    m.box((0.090, 0.012, 0.240), (0, 0.0850, Z0 + 0.800), Galvanized, bevel=0.003, seg=1)              # access door
    m.cyl(0.006, 0.008, (0, 0.0920, Z0 + 0.800), Iron, rot=AXIS_YF, seg=6)
    arm = []
    for i in range(11):
        a = i / 10 * pi / 2
        arm.append((0, 0.800 * (1 - cos(a)), Z0 + 3.900 + 0.300 * sin(a)))
    m.sweep(arm, [0.038] * 3 + [0.034] * 5 + [0.030] * 3, Galvanized, seg=12)
    m.torus(0.052, 0.012, (0, 0, Z0 + 3.905), Galvanized, seg=16, sub=6)                               # collar
    m.shaped([(0.740, Z0 + 4.200, 0.110, 0.070), (0.860, Z0 + 4.195, 0.250, 0.100), (1.120, Z0 + 4.185, 0.290, 0.105),
              (1.300, Z0 + 4.180, 0.210, 0.070)], Galvanized, n=18, power=2.6, ends=0.6)               # lamp head
    m.sphere(0.5, (0, 1.060, Z0 + 4.140), LampGlass, scale=(0.230, 0.420, 0.080), seg=18, rings=10, wear=0)
    m.cyl(0.022, 0.040, (0, 0.900, Z0 + 4.262), Polymer, seg=10, bevel=0.004)                          # photocell


# ================================================================== SANDBAGS (three courses)
@model('SandbagWall', 'Props', (10.8, 3.5, 0.2675), ground=True, ao_dist=0.25)
def _(m):
    rnd = random.Random(21)
    H = 0.178                                                                       # course height

    def bag(x, z, L, seed):
        r = random.Random(seed)
        ph = r.uniform(0, 6.28)

        def squash(c):                                                              # unit sphere -> sagging pillow
            x_, y_, z_ = c.x, c.y, c.z
            sx = math.copysign(abs(x_) ** 0.55, x_)
            sy = math.copysign(abs(y_) ** 0.62, y_)
            sz = math.copysign(abs(z_) ** 0.78, z_)
            bulge = 1 + 0.07 * sin(x_ * 5 + ph) * (1 - abs(sz))
            pinch = 1 - 0.55 * abs(sx) ** 5                       # the sewn ends are flattened
            c.x = sx * (L / 2)
            c.y = sy * 0.180 * bulge * (1 - 0.12 * abs(sx) ** 5) + 0.012 * sin(x_ * 3.1 + ph * 2)
            c.z = sz * (H / 2 + 0.008) * pinch + 0.010 * sin(x_ * 4.3 + y_ * 3.0 + ph)

        M = T((x, r.uniform(-0.008, 0.008), z)) @ RZ(r.uniform(-0.05, 0.05)) @ RX(r.uniform(-0.04, 0.04))
        m.sphere(1.0, (0, 0, 0), SandCanvas, seg=20, rings=12, warp=squash, tint=r.uniform(0.82, 1.08), matrix=M)

    for row in range(3):
        z = -0.2675 + H / 2 + row * H
        if row == 1:
            for i in range(3):
                bag(-0.475 + i * 0.475, z, 0.490, row * 10 + i)
            for s in (-1, 1):
                bag(s * 0.830, z, 0.250, row * 10 + 5 + s)
        else:
            for i in range(4):
                bag(-0.7125 + i * 0.475, z, 0.490, row * 10 + i)


# ================================================================== TOILET
@model('Toilet', 'Props', (0.0, 5.5, 0.4), ground=True)
def _(m):
    Z0 = -0.40
    m.shaped([(0.020, Z0, 0.230, 0.440), (0.030, Z0 + 0.060, 0.200, 0.380), (0.040, Z0 + 0.200, 0.215, 0.360),
              (0.055, Z0 + 0.330, 0.340, 0.470), (0.060, Z0 + 0.385, 0.372, 0.520), (0.060, Z0 + 0.400, 0.376, 0.524)],
             Ceramic, n=28, power=2.25, ends=0)                                     # pedestal and bowl
    m.shaped([(0.060, Z0 + 0.400, 0.380, 0.528), (0.060, Z0 + 0.418, 0.380, 0.528)], PlasticWhite, n=28, power=2.25,
             ends=0.9)                                                              # seat
    m.shaped([(0.062, Z0 + 0.420, 0.372, 0.520), (0.062, Z0 + 0.438, 0.360, 0.508)], PlasticWhite, n=28, power=2.25,
             ends=0.75)                                                             # lid
    for sx in (-1, 1):
        m.cyl(0.015, 0.022, (sx * 0.080, -0.185, Z0 + 0.425), PlasticWhite, rot=AXIS_X, seg=12, bevel=0.003)   # hinges
        m.sphere(0.013, (sx * 0.090, 0.060, Z0 + 0.030), PlasticWhite, scale=(1, 1, 0.6), seg=12, rings=8)     # bolt caps
    m.box((0.370, 0.170, 0.345), (0, -0.2200, Z0 + 0.590), Ceramic, bevel=0.022, seg=3)               # cistern
    m.box((0.390, 0.190, 0.036), (0, -0.2180, Z0 + 0.781), Ceramic, bevel=0.012, seg=3)               # its lid
    m.box((0.300, 0.110, 0.070), (0, -0.2100, Z0 + 0.385), Ceramic, bevel=0.020, seg=2)               # shelf joining them
    m.cyl(0.011, 0.012, (-0.130, -0.130, Z0 + 0.700), Chrome, rot=AXIS_YF, seg=12, bevel=0.002)       # flush lever
    m.box((0.070, 0.008, 0.014), (-0.100, -0.122, Z0 + 0.700), Chrome, bevel=0.003, seg=1)
    m.sweep([(0.150, -0.270, Z0 + 0.420), (0.165, -0.290, Z0 + 0.300), (0.160, -0.300, Z0 + 0.120), (0.150, -0.305, Z0 + 0.040)],
            0.006, Chrome, seg=8, smooth=1)                                         # water supply


# ================================================================== BALL (the big bouncy one)
@model('Ball', 'Props', (1.2, 5.5, 0.38), ground=True)
def _(m):
    R = 0.38
    m.sphere(R, (0, 0, 0), Ball, seg=40, rings=24)
    m.torus(R + 0.0005, 0.0045, (0, 0, 0), HazardBlack, seg=48, sub=6, wear=0)       # seams
    m.torus(R + 0.0005, 0.0045, (0, 0, 0), HazardBlack, rot=AXIS_X, seg=48, sub=6, wear=0)
    for s in (-1, 1):
        rr = R * cos(0.62)
        m.torus(rr + 0.0005, 0.0045, (0, s * R * sin(0.62), 0), HazardBlack, rot=AXIS_Y, seg=40, sub=6, wear=0)
