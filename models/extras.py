"""More weapons for the armoury (not all wired into the game yet). Origin = the grip, business end
toward +Y. Uses the helpers in guns.py and melee.py."""


def bar_ring(y0, y1, t, z, c=None):
    """One cross-section of a forged head or blade: a y0..y1 by t rectangle with its corners knocked off."""
    c = min(t * 0.3, 0.004) if c is None else c
    h = t / 2
    return [(-h + c, y0, z), (h - c, y0, z), (h, y0 + c, z), (h, y1 - c, z), (h - c, y1, z), (-h + c, y1, z),
            (-h, y1 - c, z), (-h, y0 + c, z)]


# ================================================================== FIRE AXE
@model('Axe', 'Weapons', (6.0, -1.5, WZ))
def _(m):
    m.shaped([(-0.430, 0.000, 0.030, 0.042), (-0.400, -0.004, 0.026, 0.036), (-0.200, -0.002, 0.024, 0.033),
              (0.100, 0.002, 0.025, 0.034), (0.330, 0.000, 0.027, 0.038), (0.420, 0.000, 0.026, 0.036)], WoodPale, n=16,
             power=2.3, ends=0.7)                                                 # hickory handle with a swell at the end
    m.loft([bar_ring(0.384, 0.412, 0.010, 0.150), bar_ring(0.350, 0.448, 0.038, 0.045), bar_ring(0.345, 0.452, 0.042, 0.000),
            bar_ring(0.350, 0.455, 0.040, -0.045), bar_ring(0.300, 0.490, 0.018, -0.140)], (0, 0, 0), RedPaint, uv='box')
    m.loft([bar_ring(0.300, 0.490, 0.018, -0.140), bar_ring(0.288, 0.502, 0.008, -0.168),
            bar_ring(0.284, 0.506, 0.0008, -0.184, c=0.0002)], (0, 0, 0), Steel, uv='box', cap='top')    # ground edge
    m.cyl(0.0085, 0.046, (0, 0.398, 0.0), Steel, rot=AXIS_X, seg=10, bevel=0.001)                    # wedge pin


# ================================================================== BASEBALL BAT
@model('BaseballBat', 'Weapons', (6.5, -1.5, WZ))
def _(m):
    m.lathe([(0.0, -0.145), (0.0200, -0.1440), (0.0250, -0.1360), (0.0230, -0.1260), (0.0140, -0.1160), (0.0130, 0.000),
             (0.0140, 0.150), (0.0185, 0.280), (0.0270, 0.420), (0.0325, 0.520), (0.0330, 0.660), (0.0290, 0.690),
             (0.0180, 0.700), (0.0, 0.700)], (0, 0, 0), WoodPale, rot=AXIS_YF, seg=24)
    prof = [(0.0135, -0.112)]
    for i in range(22):                                                           # spiral of grip tape, edge over edge
        z0 = -0.110 + i * 0.0105
        prof += [(0.0152, z0), (0.0146, z0 + 0.0100)]
    prof += [(0.0135, 0.122)]
    m.lathe(prof, (0, 0, 0), Tape, rot=AXIS_YF, seg=20)
    m.tube(0.0336, 0.0326, 0.060, (0, 0.560, 0), HazardBlack, rot=AXIS_YF, seg=24, wear=0)             # maker's band


# ================================================================== CROWBAR
@model('Crowbar', 'Weapons', (7.0, -1.5, WZ))
def _(m):
    path = [(0, -0.300, 0.0), (0, 0.300, 0.0)]
    for i in range(1, 9):                                                         # the gooseneck
        a = i / 8 * 2.5
        path.append((0, 0.300 + 0.052 * sin(a), -0.052 * (1 - cos(a))))
    m.sweep(path, 0.0115, RedPaint, seg=6)                                        # hexagonal bar
    end = Vector(path[-1])
    d = (end - Vector(path[-2])).normalized()
    for sx in (-1, 1):                                                            # split claw
        m.blade([(0.0, 0.010, -0.010, 0.009), (0.030, 0.009, -0.009, 0.008), (0.055, 0.003, -0.003, 0.003)], Steel,
                x=sx * 0.0065, flat=0.3,
                matrix=Matrix.Translation(end) @ Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4())
    m.blade([(-0.300, 0.0115, -0.0115, 0.020), (-0.340, 0.0100, -0.0100, 0.024), (-0.385, 0.0030, -0.0050, 0.027),
             (-0.398, 0.0006, -0.0020, 0.027)], Steel, flat=0.15)   # chisel end


# ================================================================== KATANA
@model('Katana', 'Weapons', (7.5, -1.5, WZ))
def _(m):
    m.shaped([(-0.130, 0.000, 0.0250, 0.0350), (-0.060, 0.000, 0.0240, 0.0335), (0.060, 0.000, 0.0240, 0.0335),
              (0.132, 0.000, 0.0250, 0.0350)], RaySkin, n=14, power=2.6, ends=0)
    for i in range(10):                                                           # crossed cord wrap
        y = -0.118 + i * 0.0262
        for sx in (-1, 1):
            for tilt in (-1, 1):
                m.box((0.0022, 0.0340, 0.0085), (sx * 0.0122, y, 0.0), Cord, rot=(tilt * 0.72, 0, 0), bevel=0.0008, seg=1)
        for sz in (-1, 1):
            m.box((0.0250, 0.0110, 0.0024), (0, y + 0.0131, sz * 0.0172), Cord, bevel=0.0008, seg=1)
    for y in (-0.137, 0.139):
        m.shaped([(y - 0.008, 0.0, 0.0265, 0.0365), (y + 0.008, 0.0, 0.0265, 0.0365)], Brass, n=14, power=2.6, ends=0.85)
    m.cyl(0.0400, 0.0050, (0, 0.1530, 0), Iron, rot=AXIS_YF, seg=24, bevel=0.0012)                    # guard
    m.shaped([(0.156, 0.001, 0.0090, 0.0310), (0.180, 0.001, 0.0086, 0.0300)], Brass, n=10, power=4, ends=0)   # blade collar

    def sori(y):                                                                  # the blade's curve
        s = (y - 0.18) / 0.72
        return 0.046 * s * s

    st = []
    for i in range(15):
        y = 0.180 + 0.700 * i / 14
        st.append((y, sori(y) + 0.0150, sori(y) - 0.0150 + 0.0040 * (i / 14) ** 2, 0.0068 - 0.0018 * i / 14))
    st += [(0.895, sori(0.895) + 0.0140, sori(0.895) - 0.0020, 0.0038), (0.908, sori(0.908) + 0.0125, sori(0.908) + 0.0090, 0.0010)]
    m.blade(st, Chrome, flat=0.62)


# ================================================================== CHAINSAW
@model('Chainsaw', 'Weapons', (8.0, -1.5, WZ))
def _(m):
    m.shaped([(0.120, 0.030, 0.185, 0.160), (0.200, 0.032, 0.195, 0.175), (0.330, 0.030, 0.190, 0.170),
              (0.395, 0.024, 0.160, 0.140)], YellowPaint, n=20, power=4.0, ends=0.6)                # engine housing
    m.box((0.030, 0.210, 0.130), (0.103, 0.270, 0.015), Iron, bevel=0.012, seg=2)                    # clutch cover
    for y in (0.215, 0.325):
        m.gear(0.011, 0.012, (0.1195, y, 0.010), Steel, rot=AXIS_X, teeth=3, cut=0.002)
    m.cyl(0.062, 0.022, (-0.102, 0.245, 0.030), Polymer, rot=AXIS_X, seg=24, bevel=0.004)            # starter
    for i in range(6):
        m.box((0.004, 0.090, 0.006), (-0.1140, 0.245, -0.005 + i * 0.014), Bore, wear=0)
    m.sweep([(-0.114, 0.250, 0.060), (-0.135, 0.250, 0.075), (-0.150, 0.250, 0.075)], 0.006, Polymer, seg=8)   # pull grip
    m.cyl(0.011, 0.040, (-0.150, 0.250, 0.075), Polymer, rot=AXIS_YF, seg=10, bevel=0.003)
    for x in (0.045, -0.040):
        m.gear(0.020, 0.012, (x, 0.170, 0.118), Polymer, teeth=8, cut=0.003, bevel=0.002)             # fuel and oil caps
    # rear handle (the grip at the origin) with trigger, and the wrap-round front handle
    m.sweep([(0, 0.130, 0.060), (0, 0.060, 0.030), (0, -0.090, 0.010), (0, -0.110, -0.040), (0, -0.060, -0.075),
             (0, 0.120, -0.060)], 0.0175, Polymer, seg=10, smooth=2)
    m.box((0.014, 0.050, 0.014), (0, 0.010, -0.012), YellowPaint, rot=(0.15, 0, 0), bevel=0.004, seg=1)   # throttle
    m.sweep([(-0.105, 0.300, -0.050), (-0.125, 0.285, 0.120), (-0.060, 0.275, 0.185), (0.060, 0.275, 0.185),
             (0.115, 0.290, 0.110), (0.108, 0.310, 0.000)], 0.0125, Rubber, seg=10, smooth=2)
    m.box((0.170, 0.012, 0.085), (0, 0.345, 0.150), Polymer, rot=(0.25, 0, 0), bevel=0.006, seg=2)   # chain brake guard
    for z in (-0.020, 0.030):
        m.box((0.004, 0.030, 0.028), (0.070, 0.412, z), Steel, rot=(0, 0, 0), bevel=0.001, seg=1, taper=(1, 0.3))   # bucking spikes
    # guide bar and chain
    bar = [(0.380, -0.040), (0.800, -0.040), (0.850, -0.026), (0.868, 0.000), (0.850, 0.026), (0.800, 0.040), (0.380, 0.040)]
    m.prism(bar, 0.0050, (0.070, 0, 0.005), Steel, bevel=0.0008, seg=1)
    m.prism([(y, z * 0.62) for y, z in bar[1:-1]] + [(0.420, 0.025), (0.420, -0.025)], 0.0056, (0.070, 0, 0.005), Parkerized)
    edge = [Vector((0.070, 0.385 + i * 0.0188, 0.049)) for i in range(23)]
    edge += [Vector((0.070, 0.817 + 0.0445 * sin(a), 0.005 + 0.0445 * cos(a))) for a in [k * pi / 8 for k in range(1, 8)]]
    edge += [Vector((0.070, 0.798 - i * 0.0188, -0.039)) for i in range(23)]
    for i, p in enumerate(edge):
        q = edge[min(i + 1, len(edge) - 1)]
        d = (q - p) if i + 1 < len(edge) else (p - edge[i - 1])
        rot = Vector((0, 1, 0)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        m.box((0.0085, 0.0150, 0.0050), (0, 0, 0), Parkerized, bevel=0.0008, seg=1, matrix=Matrix.Translation(p) @ rot)   # links
        if i % 2 == 0:
            m.box((0.0060, 0.0090, 0.0070), (0, 0, 0), Steel, taper=(1, 0.35), shear=0.006,
                  matrix=Matrix.Translation(p) @ rot @ Matrix.Translation(((0.002 if i % 4 else -0.002), 0, 0.005)))    # cutters


# ================================================================== SLEDGEHAMMER
@model('SledgeHammer', 'Weapons', (8.5, -1.5, WZ))
def _(m):
    m.shaped([(-0.460, 0.000, 0.034, 0.042), (-0.430, 0.000, 0.030, 0.036), (-0.150, 0.000, 0.028, 0.034),
              (0.250, 0.000, 0.029, 0.035), (0.400, 0.000, 0.032, 0.040), (0.445, 0.000, 0.032, 0.040)], WoodPale, n=16,
             power=2.4, ends=0.7)
    m.shaped([(-0.455, 0.000, 0.0345, 0.0425), (-0.300, 0.000, 0.0300, 0.0360)], Rubber, n=16, power=2.4, ends=0.9)   # grip sleeve
    prof = [(0.0, -0.090), (0.036, -0.090), (0.040, -0.084), (0.040, -0.050), (0.034, -0.040), (0.034, 0.040), (0.040, 0.050),
            (0.040, 0.084), (0.036, 0.090), (0.0, 0.090)]
    m.lathe(prof, (0, 0.400, 0), Iron, seg=8)                                     # eight-sided head
    m.box((0.050, 0.030, 0.012), (0, 0.400, 0.0), YellowPaint, bevel=0.002, seg=1)                    # paint band


# ================================================================== DOUBLE-BARRELLED SHOTGUN (side by side)
@model('DoubleBarrel', 'Weapons', (9.0, -1.5, WZ))
def _(m):
    BZ = 0.018
    m.prism([(-0.070, -0.024), (-0.075, 0.020), (-0.055, 0.034), (0.070, 0.034), (0.075, -0.004), (0.060, -0.028),
             (-0.040, -0.030)], 0.0460, (0, 0, 0), Steel, bevel=0.008, seg=3)      # case-hardened action
    for sx in (-1, 1):
        barrel(m, 0.0128, 0.0092, 0.060, 0.580, BZ, Gunmetal, x=sx * 0.0128)
        m.cyl(0.0060, 0.0030, (sx * 0.0200, -0.020, 0.000), Steel, rot=AXIS_X, seg=10)                # hinge pin ends
    m.box((0.0080, 0.500, 0.0050), (0, 0.320, BZ + 0.0120), Gunmetal, bevel=0.0010, seg=1)            # top rib
    m.box((0.0100, 0.500, 0.0080), (0, 0.320, BZ - 0.0100), Gunmetal, bevel=0.0010, seg=1)            # bottom rib
    m.sphere(0.0028, (0, 0.570, BZ + 0.0170), Brass, seg=10, rings=8)
    m.prism([(-0.060, 0.034), (-0.064, 0.040), (-0.030, 0.0410), (0.000, 0.0370), (0.004, 0.034)], 0.012, (0, 0, 0), Steel,
            bevel=0.002, seg=1)                                                    # top lever
    m.box((0.010, 0.016, 0.004), (0, -0.074, 0.0240), Steel, bevel=0.001, seg=1)                      # safety slide
    guard(m, [(0.020, -0.030), (0.022, -0.054), (0.010, -0.064), (-0.050, -0.064), (-0.062, -0.052), (-0.066, -0.030)],
          Steel, w=0.012)
    trigger(m, -0.014, -0.030, Steel, h=0.022)
    trigger(m, -0.040, -0.030, Steel, h=0.022)
    m.shaped([(0.075, -0.012, 0.044, 0.036), (0.180, -0.014, 0.048, 0.040), (0.300, -0.008, 0.042, 0.030)], Wood, n=18,
             power=2.6, ends=0.7)                                                  # forend
    m.shaped([(-0.066, 0.002, 0.044, 0.056), (-0.110, -0.012, 0.036, 0.044), (-0.160, -0.024, 0.036, 0.046),
              (-0.250, -0.038, 0.040, 0.080), (-0.340, -0.050, 0.042, 0.108), (-0.410, -0.058, 0.043, 0.122)], Wood, n=22,
             power=2.6, ends=0)
    m.shaped([(-0.410, -0.058, 0.0434, 0.1225), (-0.422, -0.059, 0.0430, 0.1220)], Steel, n=22, power=2.6, ends=0.9)   # butt plate
    REF['DoubleBarrel'] = dict(sight=BZ + 0.0198, muzzle=(0.580, BZ), handR=(-0.115, -0.045, -0.70), handL=(0.180, -0.036, 0.0))


# ================================================================== UZI
@model('Uzi', 'Weapons', (9.5, -1.5, WZ))
def _(m):
    BZ = 0.012
    m.prism([(-0.160, -0.022), (-0.160, 0.034), (0.140, 0.034), (0.140, -0.022)], 0.0420, (0, 0, 0), Parkerized, bevel=0.004,
            seg=2)                                                                # stamped receiver
    m.box((0.0425, 0.2500, 0.0050), (0, -0.010, 0.0372), Parkerized, bevel=0.0015, seg=1)             # top cover
    for z in (-0.006, 0.014):
        m.box((0.0436, 0.2200, 0.0034), (0, -0.010, z), Parkerized, bevel=0.0012, seg=1, wear=0.6)    # pressed ribs
    m.cyl(0.0080, 0.0180, (0, 0.010, 0.0480), Polymer, seg=12, bevel=0.002)                          # cocking knob
    m.box((0.0060, 0.0700, 0.0030), (0, 0.020, 0.0405), Bore, wear=0)
    m.box((0.0020, 0.0500, 0.0140), (0.0204, 0.040, 0.0180), Bore, wear=0)                           # ejection port
    m.gear(0.0165, 0.0260, (0, 0.152, BZ), Parkerized, rot=AXIS_YF, teeth=12, cut=0.0012, bevel=0.0015)   # barrel nut
    barrel(m, 0.0082, 0.0046, 0.140, 0.2300, BZ, Parkerized)
    for y, h in ((0.115, 0.022), (-0.130, 0.020)):                                # sight ears
        for sx in (-1, 1):
            m.box((0.0030, 0.0180, h), (sx * 0.0100, y, 0.0370 + h / 2), Parkerized, bevel=0.0008, seg=1, wear=0.5)
    m.cyl(0.0014, 0.0160, (0, 0.115, 0.0460), Parkerized, seg=6)
    m.box((0.0100, 0.0030, 0.0100), (0, -0.130, 0.0440), Parkerized, bevel=0.0005, seg=1)
    # the grip holds the magazine
    m.shaped([(0.000, -0.022, 0.0340, 0.0520), (-0.006, -0.060, 0.0350, 0.0530), (-0.014, -0.110, 0.0350, 0.0540)],
             Polymer, n=18, power=3.4, ends=0)
    m.box((0.0356, 0.0300, 0.0700), (0, -0.0080, -0.0700), PolymerGrip, rot=(-0.12, 0, 0), bevel=0.005, seg=2)
    m.box((0.0240, 0.0340, 0.1500), (0, -0.0240, -0.1850), Gunmetal, rot=(-0.12, 0, 0), bevel=0.003, seg=1)   # magazine
    m.box((0.0270, 0.0380, 0.0060), (0, -0.0335, -0.2620), Gunmetal, rot=(-0.12, 0, 0), bevel=0.0015, seg=1)
    m.box((0.0100, 0.0500, 0.0160), (0, -0.0450, -0.0280), Polymer, bevel=0.003, seg=1)               # grip safety
    guard(m, [(0.060, -0.024), (0.062, -0.050), (0.052, -0.058), (0.030, -0.058)], Parkerized)
    trigger(m, 0.040, -0.024, Steel, h=0.022)
    m.shaped([(0.065, -0.012, 0.0440, 0.0340), (0.130, -0.012, 0.0440, 0.0340)], Polymer, n=14, power=4.0, ends=0.8)   # handguard
    # folded metal stock
    for sx in (-1, 1):
        m.box((0.0040, 0.1500, 0.0140), (sx * 0.0232, -0.090, -0.0300), Parkerized, bevel=0.001, seg=1)
    m.box((0.0500, 0.0100, 0.0600), (0, -0.168, -0.0100), Parkerized, bevel=0.003, seg=1)
    REF['Uzi'] = dict(sight=0.0590, muzzle=(0.230, BZ), handR=(-0.006, -0.066, -0.12), handL=(0.098, -0.030, 0.0))


# ================================================================== MINIGUN
@model('Minigun', 'Weapons', (10.0, -1.5, WZ))
def _(m):
    AZ = 0.0                                                                      # barrel cluster axis
    for k in range(6):
        a = k * pi / 3
        m.tube(0.0095, 0.0045, 0.560, (0.0300 * cos(a), 0.480, AZ + 0.0300 * sin(a)), Gunmetal, rot=AXIS_YF, seg=12,
               chamfer=0.001)
        m.cyl(0.0046, 0.001, (0.0300 * cos(a), 0.700, AZ + 0.0300 * sin(a)), Bore, rot=AXIS_YF, seg=8, wear=0)
    for y in (0.300, 0.470, 0.640, 0.748):                                         # barrel clamps
        m.cyl(0.0440, 0.0100, (0, y, AZ), Parkerized, rot=AXIS_YF, seg=24, bevel=0.0015)
    m.cyl(0.0120, 0.560, (0, 0.480, AZ), Parkerized, rot=AXIS_YF, seg=12)                             # centre shaft
    m.lathe([(0.0, -0.110), (0.050, -0.108), (0.062, -0.095), (0.062, 0.080), (0.052, 0.095), (0.046, 0.115), (0.0, 0.115)],
            (0, 0.110, AZ), Parkerized, rot=AXIS_YF, seg=28)                      # rotor housing
    for y in (0.050, 0.170):
        m.tube(0.0640, 0.0610, 0.0120, (0, y, AZ), Gunmetal, rot=AXIS_YF, seg=28)
    m.cyl(0.0320, 0.110, (0.070, 0.060, AZ - 0.030), Anodized, rot=AXIS_YF, seg=18, bevel=0.004)      # drive motor
    m.box((0.070, 0.090, 0.070), (-0.075, 0.110, AZ + 0.010), Parkerized, bevel=0.008, seg=2)         # feeder
    chute = [(-0.105, 0.110, 0.000), (-0.150, 0.100, -0.060), (-0.170, 0.060, -0.150), (-0.160, 0.000, -0.230)]
    m.sweep(chute, 1.0, Galvanized, profile=rect_profile(0.070, 0.030, 0.004), up=(0, 1, 0), smooth=2)
    for i in range(1, 9):                                                         # the chute's segments
        t = i / 9
        p = Vector(chute[0]).lerp(Vector(chute[1]), min(1, t * 3)) if t < 1 / 3 else \
            Vector(chute[1]).lerp(Vector(chute[2]), min(1, (t - 1 / 3) * 3)) if t < 2 / 3 else \
            Vector(chute[2]).lerp(Vector(chute[3]), (t - 2 / 3) * 3)
        m.box((0.036, 0.076, 0.004), p, Parkerized, rot=(0, 0.6 + t * 0.8, 0), bevel=0.001, seg=1, wear=0.5)
    # carry handle on top, firing grip at the back
    m.sweep([(0, 0.020, 0.062), (0, 0.030, 0.120), (0, 0.170, 0.120), (0, 0.185, 0.062)], 0.0130, Rubber, seg=10, smooth=2)
    m.box((0.050, 0.060, 0.060), (0, -0.030, AZ - 0.010), Parkerized, bevel=0.008, seg=2)
    m.shaped([(-0.060, -0.020, 0.034, 0.046), (-0.068, -0.060, 0.034, 0.047), (-0.078, -0.100, 0.033, 0.047)], Polymer,
             n=18, power=3.0, ends=0.72)
    guard(m, [(-0.020, -0.042), (-0.020, -0.066), (-0.030, -0.074), (-0.052, -0.070)], Parkerized)
    trigger(m, -0.036, -0.042, GlowOrange, h=0.020)
    REF['Minigun'] = dict(muzzle=(0.760, AZ), handR=(-0.068, -0.060, -0.20), handL=(0.100, 0.107, 0.0))


# ================================================================== CROSSBOW
@model('Crossbow', 'Weapons', (11.0, -1.5, WZ))
def _(m):
    m.shaped([(-0.380, -0.040, 0.040, 0.110), (-0.300, -0.030, 0.038, 0.080), (-0.200, -0.016, 0.036, 0.052),
              (-0.120, -0.008, 0.040, 0.050), (0.000, 0.000, 0.044, 0.050), (0.200, 0.004, 0.042, 0.044),
              (0.330, 0.006, 0.038, 0.038)], Polymer, n=20, power=3.0, ends=0.7)   # stock and fore-end
    m.shaped([(-0.080, -0.030, 0.034, 0.044), (-0.094, -0.070, 0.034, 0.046), (-0.108, -0.110, 0.033, 0.046)], Polymer, n=18,
             power=3.0, ends=0.72)                                                 # grip
    m.box((0.036, 0.022, 0.118), (0, -0.392, -0.040), Rubber, bevel=0.006, seg=2)
    m.box((0.014, 0.560, 0.008), (0, 0.090, 0.0300), Anodized, bevel=0.002, seg=1)                    # flight rail
    m.box((0.0040, 0.540, 0.0020), (0, 0.095, 0.0345), Bore, wear=0)
    guard(m, [(0.000, -0.026), (0.000, -0.052), (-0.012, -0.060), (-0.050, -0.058), (-0.062, -0.046)], Anodized)
    trigger(m, -0.028, -0.026, Steel, h=0.024)
    m.box((0.030, 0.050, 0.026), (0, -0.090, 0.042), Anodized, bevel=0.004, seg=2)                    # latch housing
    m.box((0.040, 0.050, 0.040), (0, 0.330, 0.016), Anodized, bevel=0.006, seg=2)                     # riser
    for sx in (-1, 1):
        limb = [(sx * 0.020, 0.335, 0.020), (sx * 0.120, 0.330, 0.020), (sx * 0.230, 0.300, 0.020), (sx * 0.330, 0.235, 0.020),
                (sx * 0.385, 0.170, 0.020)]
        m.sweep(limb, [1.0, 0.95, 0.8, 0.65, 0.5], OliveDark, profile=rect_profile(0.030, 0.011, 0.003), up=(0, 0, 1), smooth=2)
        m.cyl(0.0140, 0.0100, (sx * 0.385, 0.170, 0.020), Anodized, seg=14, bevel=0.002)              # string wheel
        m.sweep([(sx * 0.385, 0.170, 0.034), (0.0, -0.078, 0.0345)], 0.0016, Cord, seg=6)             # the drawn string
    stirrup = [(-0.045, 0.350, 0.016), (-0.050, 0.400, 0.016), (-0.030, 0.430, 0.016), (0.030, 0.430, 0.016),
               (0.050, 0.400, 0.016), (0.045, 0.350, 0.016)]
    m.sweep(stirrup, 0.0060, Anodized, seg=8, smooth=1)
    # the bolt: shaft, three vanes, broadhead
    m.cyl(0.0042, 0.460, (0, 0.150, 0.0405), Anodized, rot=AXIS_YF, seg=10)
    for k in range(3):
        a = pi / 2 + k * 2 * pi / 3
        m.box((0.0010, 0.070, 0.012), (0.0085 * cos(a), -0.040, 0.0405 + 0.0085 * sin(a)), RedPaint, rot=(0, -(a - pi / 2), 0),
              shear=-0.018, wear=0)
    for k in range(2):
        m.blade([(0.380, 0.0100, -0.0100, 0.0016), (0.410, 0.0060, -0.0060, 0.0014), (0.430, 0.0006, -0.0006, 0.0004)], Steel,
                flat=0.2, matrix=Matrix.Translation((0, 0, 0.0405)) @ Matrix.Rotation(k * pi / 2, 4, 'Y'))
    # red-dot sight
    m.lathe([(0.0130, -0.050), (0.0165, -0.050), (0.0175, -0.044), (0.0175, 0.044), (0.0165, 0.050), (0.0130, 0.050),
             (0.0130, 0.040), (0.0, 0.040)], (0, -0.010, 0.082), Anodized, rot=AXIS_YF, seg=20)
    m.cyl(0.0128, 0.0006, (0, 0.0305, 0.082), Lens, rot=AXIS_YF, seg=18, wear=0)
    m.cyl(0.0128, 0.0040, (0, -0.0580, 0.082), Lens, rot=AXIS_YF, seg=18, wear=0)
    for y in (-0.040, 0.020):
        m.box((0.014, 0.012, 0.030), (0, y, 0.052), Anodized, bevel=0.002, seg=1)
    REF['Crossbow'] = dict(sight=0.082, muzzle=(0.430, 0.0405), handR=(-0.094, -0.070, -0.30), handL=(0.180, -0.020, 0.0))


# ================================================================== FLAMETHROWER
@model('Flamethrower', 'Weapons', (11.6, -1.5, WZ))
def _(m):
    NZ = 0.030                                                                    # wand axis
    m.cyl(0.0140, 0.640, (0, 0.260, NZ), Parkerized, rot=AXIS_YF, seg=16)                             # wand
    m.lathe([(0.0140, 0.0), (0.0200, 0.010), (0.0230, 0.030), (0.0230, 0.105), (0.0200, 0.115), (0.0165, 0.115),
             (0.0165, 0.020), (0.0, 0.020)], (0, 0.575, NZ), Iron, rot=AXIS_YF, seg=20)              # nozzle shroud
    for k in range(8):
        a = k * pi / 4
        m.cyl(0.0032, 0.0480, (0.0232 * cos(a), 0.640, NZ + 0.0232 * sin(a)), Bore, rot=(0, pi / 2 - a, 0), seg=6, wear=0)   # air holes
    m.cyl(0.0050, 0.0060, (0, 0.598, NZ), GlowOrange, rot=AXIS_YF, seg=10, wear=0)                    # pilot flame
    m.sweep([(0, 0.560, NZ + 0.022), (0, 0.600, NZ + 0.040), (0, 0.660, NZ + 0.036), (0, 0.685, NZ + 0.014)], 0.0030, Copper,
            seg=6, smooth=1)                                                      # igniter tube
    # two bottles slung under the wand: fuel and propellant
    for sx, mat, r in ((-1, RedPaint, 0.0300), (1, Galvanized, 0.0260)):
        m.lathe([(0.0, -0.130), (r * 0.6, -0.128), (r, -0.112), (r, 0.100), (r * 0.7, 0.122), (0.0090, 0.132), (0.0090, 0.150),
                 (0.0, 0.150)], (sx * 0.0320, 0.200, NZ - 0.0450), mat, rot=AXIS_YF, seg=18)
        m.gear(0.0120, 0.0100, (sx * 0.0320, 0.356, NZ - 0.0450), Brass, rot=AXIS_YF, teeth=6, cut=0.0015)
        m.sweep([(sx * 0.0320, 0.360, NZ - 0.0450), (sx * 0.0300, 0.400, NZ - 0.0300), (sx * 0.0120, 0.430, NZ - 0.0060)], 0.0035,
                Copper, seg=6, smooth=1)
    for y in (0.110, 0.290):
        m.box((0.1300, 0.0160, 0.0050), (0, y, NZ - 0.0760), Parkerized, bevel=0.001, seg=1)           # straps
        m.tube(0.0165, 0.0140, 0.0160, (0, y, NZ), Parkerized, rot=AXIS_YF, seg=16)
    m.cyl(0.0190, 0.0100, (0, 0.440, NZ + 0.0240), Brass, seg=16, bevel=0.002)                        # pressure gauge
    m.cyl(0.0160, 0.0008, (0, 0.440, NZ + 0.0294), PlasticWhite, seg=16, wear=0)
    m.box((0.0010, 0.0110, 0.0006), (0, 0.4430, NZ + 0.0300), RedPaint, rot=(0, 0, 0.6), wear=0)
    # grips: firing grip at the origin, a second one forward
    m.box((0.0300, 0.0700, 0.0300), (0, 0.005, NZ - 0.0100), Parkerized, bevel=0.005, seg=2)
    m.shaped([(-0.006, 0.000, 0.0320, 0.0440), (-0.014, -0.040, 0.0330, 0.0450), (-0.024, -0.085, 0.0320, 0.0460)], Polymer,
             n=18, power=3.0, ends=0.72)
    guard(m, [(0.040, 0.004), (0.042, -0.022), (0.032, -0.030), (0.008, -0.026)], Parkerized)
    trigger(m, 0.022, 0.004, Steel, h=0.020)
    m.shaped([(0.420, 0.004, 0.0300, 0.0400), (0.414, -0.030, 0.0310, 0.0410), (0.406, -0.066, 0.0300, 0.0410)], Polymer,
             n=18, power=3.0, ends=0.72)
    m.sweep([(0, -0.060, NZ), (0, -0.120, NZ - 0.010), (0, -0.170, NZ - 0.060), (0.020, -0.200, NZ - 0.140)], 0.0110, Rubber,
            seg=10, smooth=2)                                                     # hose leading back
    REF['Flamethrower'] = dict(muzzle=(0.690, NZ), handR=(-0.014, -0.040, -0.20), handL=(0.414, -0.030, 0.0))
