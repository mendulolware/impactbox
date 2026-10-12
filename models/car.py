"""The car: a boxy four-door saloon. Origin = centre of its collider (1.84 x 4.28 x 1.32 m), nose toward +Y.
The body is two extruded side profiles - the lower body with real wheel arches, and a narrower cabin on
top - with glass, lamps, bumpers, trim and wheels added to them. The game re-tints CarPaint per car."""
GROUND = -0.66
AXLE_Z = GROUND + 0.31
FRONT, REAR = 1.32, -1.23                 # axles
HW = 0.88                                 # half width of the body


def arch(cy, r=0.37, n=12):
    """Wheel-arch points from the back of the opening over the top to the front (y increasing)."""
    return [(cy + r * cos(radians(a)), AXLE_Z + r * sin(radians(a))) for a in
            [194 - i * (208 / n) for i in range(n + 1)]]


def wheel(m, x, y, side):
    """side = +1 for the car's right (+X): the hub cap faces outward."""
    rot = (0, side * pi / 2, 0)
    tread = [(0.190, -0.086), (0.250, -0.096), (0.292, -0.092), (0.3085, -0.078)]
    for i in range(5):                                                         # grooves across the tread
        z0 = -0.070 + i * 0.031
        tread += [(0.3100, z0), (0.3100, z0 + 0.016), (0.3020, z0 + 0.018), (0.3020, z0 + 0.026)]
    tread = tread[:-2] + [(0.3085, 0.078), (0.292, 0.092), (0.250, 0.096), (0.190, 0.086), (0.184, 0.078), (0.184, -0.078)]
    m.lathe(tread, (x, y, AXLE_Z), Tyre, rot=rot, seg=32, closed=True)       # a ring: the wheel shows through the middle
    m.lathe([(0.0, 0.062), (0.040, 0.066), (0.052, 0.052), (0.150, 0.046), (0.172, 0.060), (0.188, 0.086), (0.196, 0.086),
             (0.196, 0.070), (0.190, 0.030), (0.0, 0.030)], (x, y, AXLE_Z), Alloy, rot=rot, seg=28)                 # wheel and hub cap
    M = xf((x, y, AXLE_Z), rot)
    for k in range(8):                                                         # slots in the wheel
        a = k * pi / 4
        m.box((0.050, 0.018, 0.004), (0, 0, 0), Bore, wear=0, bevel=0.006, seg=1,
              matrix=M @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Translation((0.118, 0, 0.0488)))
    for k in range(4):                                                         # wheel nuts
        a = k * pi / 2 + 0.4
        m.gear(0.0075, 0.010, (0, 0, 0), Chrome, teeth=3, cut=0.001,
               matrix=M @ Matrix.Translation((0.030 * cos(a), 0.030 * sin(a), 0.070)))


@model('Car', 'Props', (4.0, 7.3, 0.66), ground=True, ao_dist=0.5, sharp=34)
def _(m):
    # ---- lower body, with the wheel arches cut into its profile
    low = [(-2.100, -0.400), (-1.640, -0.440)] + arch(REAR) + [(-0.840, -0.440), (0.930, -0.440)] + arch(FRONT) + \
          [(1.720, -0.440), (2.080, -0.400), (2.140, -0.300), (2.140, -0.110), (2.115, 0.030), (2.030, 0.105),
           (1.500, 0.155), (0.800, 0.190), (-1.100, 0.200), (-1.480, 0.200), (-2.050, 0.160), (-2.130, 0.060),
           (-2.140, -0.300)]
    m.prism(low, HW * 2, (0, 0, 0), CarPaint, bevel=0.034, seg=3, grain=1)
    # ---- cabin
    m.prism([(0.840, 0.150), (0.250, 0.620), (-0.200, 0.664), (-0.850, 0.642), (-1.000, 0.612), (-1.520, 0.160)], 1.500,
            (0, 0, 0), CarPaint, bevel=0.060, seg=4, grain=1)
    # ---- glass: side windows as one pane a hair proud of the cabin, then pillars over it
    m.prism([(0.640, 0.218), (0.215, 0.566), (-0.200, 0.604), (-0.840, 0.584), (-0.990, 0.552), (-1.360, 0.218)], 1.506,
            (0, 0, 0), CarGlass, wear=0)
    for y, w in ((-0.190, 0.085), (-0.915, 0.060)):                              # B pillars and the rear door frames
        m.box((1.512, w, 0.400), (0, y, 0.405), CarPaint if y > -0.5 else CarTrim, bevel=0.004, seg=1)
    m.box((1.510, 1.930, 0.020), (0, -0.360, 0.206), CarTrim, bevel=0.004, seg=1)                 # belt-line trim
    a_ws = atan2(0.470, -0.590)                                                 # windscreen slope
    m.box((1.350, 0.670, 0.012), (0, 0.545 + 0.0090, 0.385 + 0.0112), CarGlass, rot=(a_ws, 0, 0), bevel=0.004, seg=1, wear=0)
    for sx in (-1, 1):                                                           # wipers
        m.box((0.500, 0.014, 0.012), (sx * 0.300 - 0.060, 0.800, 0.205), CarTrim, rot=(a_ws, 0, sx * 0.0 + 0.10), bevel=0.003,
              seg=1)
    a_rw = atan2(-0.452, -0.520)
    m.box((1.320, 0.600, 0.012), (0, -1.260 - 0.0092, 0.386 + 0.0106), CarGlass, rot=(a_rw, 0, 0), bevel=0.004, seg=1, wear=0)
    for sx in (-1, 1):                                                           # roof gutters
        m.sweep([(sx * 0.705, 0.330, 0.585), (sx * 0.712, -0.200, 0.646), (sx * 0.712, -0.850, 0.626), (sx * 0.705, -1.060, 0.585)],
                0.009, CarTrim, seg=6, smooth=1)
    # ---- bumpers, grille, lamps, plates
    for y, s in ((2.085, 1), (-2.085, -1)):
        m.box((1.800, 0.150, 0.150), (0, y, -0.275), CarTrim, bevel=0.035, seg=3)
        m.box((1.700, 0.012, 0.022), (0, y + s * 0.0720, -0.250), Chrome, bevel=0.004, seg=1)
        for sx in (-1, 1):
            m.box((0.110, 0.180, 0.150), (sx * 0.845, y - s * 0.070, -0.275), CarTrim, bevel=0.035, seg=3)   # wrap-round ends
    m.box((0.760, 0.020, 0.135), (0, 2.132, -0.020), CarTrim, rot=(-0.10, 0, 0), bevel=0.004, seg=1)       # grille
    for i in range(4):
        m.box((0.740, 0.008, 0.010), (0, 2.1445 - i * 0.003, -0.066 + i * 0.031), Chrome, rot=(-0.10, 0, 0), bevel=0.002, seg=1)
    m.box((0.090, 0.010, 0.060), (0, 2.150, -0.020), Chrome, rot=(-0.10, 0, 0), bevel=0.015, seg=2)        # badge
    for sx in (-1, 1):
        m.box((0.330, 0.024, 0.135), (sx * 0.560, 2.128, -0.020), HeadLight, rot=(-0.10, 0, 0), bevel=0.010, seg=2, wear=0)
        m.box((0.350, 0.020, 0.155), (sx * 0.560, 2.122, -0.020), Chrome, rot=(-0.10, 0, 0), bevel=0.012, seg=2)
        m.box((0.105, 0.024, 0.135), (sx * 0.790, 2.118, -0.020), Indicator, rot=(-0.10, 0, sx * -0.18), bevel=0.010, seg=2, wear=0)
        m.box((0.300, 0.024, 0.140), (sx * 0.640, -2.136, -0.040), TailLight, bevel=0.010, seg=2, wear=0)
        m.box((0.100, 0.026, 0.140), (sx * 0.440, -2.136, -0.040), Indicator, bevel=0.010, seg=2, wear=0)
        m.box((0.090, 0.026, 0.140), (sx * 0.345, -2.136, -0.040), HeadLight, bevel=0.010, seg=2, wear=0)
        m.box((0.520, 0.018, 0.160), (sx * 0.540, -2.130, -0.040), CarTrim, bevel=0.012, seg=2)
    m.box((0.380, 0.010, 0.105), (0, 2.1635, -0.285), Plate, bevel=0.004, seg=1, wear=0)
    m.box((0.380, 0.010, 0.105), (0, -2.1440, -0.040), Plate, bevel=0.004, seg=1, wear=0)
    for y, s in ((2.169, 1), (-2.1495, -1)):
        z = -0.285 if s > 0 else -0.040
        for i, w in enumerate((0.070, 0.045, 0.085, 0.045)):
            m.box((w, 0.002, 0.055), (-0.130 + i * 0.085, y, z), HazardBlack, wear=0)
    # ---- shut lines, handles, mirrors, rubbing strips, fuel flap
    for sx in (-1, 1):
        X = sx * (HW + 0.0005)
        for y in (0.800, -0.185, -1.060):
            m.box((0.004, 0.007, 0.560), (X, y, -0.115), Bore, wear=0)
        m.box((0.004, 1.860, 0.007), (X, -0.130, -0.395), Bore, wear=0)
        for y in (0.640, -0.345):
            m.box((0.022, 0.120, 0.030), (sx * (HW + 0.006), y - 0.110, 0.095), Chrome, bevel=0.008, seg=2)
            m.box((0.004, 0.150, 0.050), (X, y - 0.110, 0.095), Bore, wear=0)
        for y0, y1 in ((-2.040, -1.625), (-0.835, 0.925), (1.715, 2.040)):
            m.box((0.014, y1 - y0, 0.036), (sx * (HW + 0.004), (y0 + y1) / 2, -0.150), CarTrim, bevel=0.005, seg=1)
        for cy in (REAR, FRONT):
            m.torus(0.374, 0.010, (sx * (HW - 0.012), cy, AXLE_Z), CarTrim, rot=AXIS_X, seg=28, sub=6,
                    arc=(radians(77), radians(283)))                             # arch lips
        m.shaped([(0.760, 0.245, 0.150, 0.100), (0.700, 0.250, 0.165, 0.115), (0.660, 0.250, 0.150, 0.100)], CarPaint,
                 n=14, power=3.0, x=sx * 0.850, ends=0.6)                         # door mirror
        m.box((0.130, 0.004, 0.080), (sx * 0.850, 0.6500, 0.252), Chrome, bevel=0.010, seg=2, wear=0)
        m.box((0.060, 0.040, 0.020), (sx * 0.760, 0.730, 0.215), CarTrim, bevel=0.006, seg=1)
    m.cyl(0.062, 0.004, (HW + 0.0005, -1.640, 0.060), Bore, rot=AXIS_X, seg=20, wear=0)                 # fuel flap
    m.cyl(0.058, 0.006, (HW + 0.0005, -1.640, 0.060), CarPaint, rot=AXIS_X, seg=20, bevel=0.002, bseg=1)
    m.box((1.500, 0.006, 0.004), (0, 0.810, 0.1905), Bore, wear=0)                                      # bonnet and boot shut lines
    for sx in (-1, 1):
        m.box((0.004, 1.250, 0.004), (sx * 0.790, 1.430, 0.166), Bore, rot=(-0.048, 0, 0), wear=0)
        m.box((0.004, 0.560, 0.004), (sx * 0.790, -1.770, 0.184), Bore, rot=(0.070, 0, 0), wear=0)
    m.box((1.500, 0.006, 0.004), (0, -1.495, 0.2015), Bore, wear=0)
    m.sweep([(0.600, -1.300, 0.580), (0.610, -1.420, 0.900), (0.615, -1.500, 1.150)], [0.004, 0.003, 0.002], CarTrim, seg=6)   # aerial
    # ---- running gear
    for y in (REAR, FRONT):
        m.cyl(0.250, 1.500, (0, y, AXLE_Z), Bore, rot=AXIS_X, seg=14, wear=0)     # blocks the view through the arches
        wheel(m, 0.760, y, 1)
        wheel(m, -0.760, y, -1)
    m.box((1.300, 3.400, 0.060), (0, 0.050, -0.455), Bore, wear=0)                # floor pan
    m.lathe([(0.0, -0.200), (0.060, -0.195), (0.075, -0.170), (0.075, 0.170), (0.060, 0.195), (0.0, 0.200)], (0.420, -1.780, -0.430),
            Galvanized, rot=AXIS_YF, seg=14)                                      # silencer
    m.tube(0.026, 0.021, 0.240, (0.420, -2.060, -0.435), Chrome, rot=AXIS_YF, seg=14)
