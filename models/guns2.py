"""Long guns, the launcher, the grenade and the grab gun. Uses the helpers in guns.py."""


# ================================================================== RIFLE (7.62 mm assault rifle, wood furniture)
@model('Rifle', 'Weapons', (1.0, -1.5, WZ))
def _(m):
    BZ, GZ = 0.006, 0.034                                                         # bore, gas tube
    m.prism([(-0.135, -0.030), (-0.135, 0.024), (0.135, 0.024), (0.135, -0.020), (0.096, -0.030)], 0.0340,
            (0, 0, 0), Gunmetal, bevel=0.0022, seg=2)                             # stamped receiver
    for y, z in ((-0.122, 0.012), (-0.122, -0.018), (-0.060, -0.022), (0.060, 0.014), (0.118, 0.012), (0.118, -0.010),
                 (0.090, -0.022)):
        m.cyl(0.0024, 0.0352, (0, y, z), Gunmetal, rot=AXIS_X, seg=8, bevel=0.0008, bseg=1, wear=0.5)   # rivets
    m.shaped([(-0.131, 0.0330, 0.0336, 0.0300), (-0.020, 0.0330, 0.0336, 0.0300), (0.086, 0.0330, 0.0336, 0.0300)],
             Gunmetal, n=20, power=2.3, ends=0.85)                                # dust cover
    for y in (-0.105, -0.050, 0.005, 0.060):
        m.shaped([(y - 0.004, 0.0330, 0.0345, 0.0312), (y + 0.004, 0.0330, 0.0345, 0.0312)], Gunmetal, n=20, power=2.3,
                 ends=0.9, wear=0.5)                                              # its ribs
    m.box((0.0020, 0.0720, 0.0125), (0.0166, 0.0420, 0.0265), Bore, wear=0)        # ejection port
    m.box((0.0020, 0.0640, 0.0090), (0.0170, 0.0400, 0.0275), Steel, bevel=0.001, seg=1)             # bolt carrier
    m.cyl(0.0042, 0.0220, (0.0270, 0.0700, 0.0275), Steel, rot=AXIS_X, seg=10, bevel=0.001)         # charging handle
    m.prism([(-0.082, 0.0050), (-0.074, 0.0120), (0.012, 0.0040), (0.022, -0.0050), (0.017, -0.0090), (-0.082, -0.0010)],
            0.0016, (0.0180, 0, 0), Gunmetal, bevel=0.0004, seg=1)                # selector lever
    m.cyl(0.0058, 0.0020, (0.0180, -0.0780, 0.0030), Gunmetal, rot=AXIS_X, seg=12)
    m.box((0.0030, 0.0080, 0.0050), (0.0195, 0.0180, -0.0060), Gunmetal, bevel=0.001, seg=1)
    # rear sight block and tangent leaf
    m.box((0.0300, 0.0500, 0.0300), (0, 0.110, 0.0370), Gunmetal, bevel=0.0035, seg=2)
    m.box((0.0115, 0.0780, 0.0036), (0, 0.130, 0.0575), Gunmetal, rot=(0.035, 0, 0), bevel=0.0008, seg=1)
    m.box((0.0180, 0.0090, 0.0060), (0, 0.126, 0.0590), Gunmetal, bevel=0.001, seg=1)                 # slider
    for sx in (-1, 1):
        m.box((0.0040, 0.0034, 0.0075), (sx * 0.0042, 0.0925, 0.0633), Gunmetal, bevel=0.0004, seg=1, wear=0.3)
    # gas system and wooden handguards
    m.cyl(0.0085, 0.2150, (0, 0.2425, GZ), Gunmetal, rot=AXIS_YF, seg=16)
    m.shaped([(0.150, 0.0365, 0.0360, 0.0270), (0.225, 0.0372, 0.0368, 0.0280), (0.300, 0.0365, 0.0340, 0.0255)],
             Wood, n=20, power=2.2, ends=0.75)
    m.shaped([(0.138, -0.0040, 0.0400, 0.0400), (0.200, -0.0085, 0.0460, 0.0470), (0.290, -0.0040, 0.0410, 0.0400),
              (0.332, -0.0020, 0.0380, 0.0360)], Wood, n=20, power=2.8, ends=0.8)
    m.box((0.0420, 0.0080, 0.0600), (0, 0.3380, 0.0150), Gunmetal, bevel=0.003, seg=1)                # handguard retainer
    m.prism([(0.342, -0.0040), (0.342, 0.0440), (0.372, 0.0440), (0.394, 0.0120), (0.388, -0.0040)], 0.0210,
            (0, 0, 0), Gunmetal, bevel=0.003, seg=2)                              # gas block
    barrel(m, 0.0082, 0.0039, 0.300, 0.6300, BZ, Gunmetal)
    m.cyl(0.0027, 0.2700, (0, 0.4750, -0.0090), Steel, rot=AXIS_YF, seg=8)        # cleaning rod
    m.box((0.0060, 0.0180, 0.0100), (0, 0.4000, -0.0110), Gunmetal, bevel=0.0015, seg=1)              # bayonet lug
    # front sight: post between two ears
    m.prism([(0.534, -0.0050), (0.534, 0.0260), (0.542, 0.0400), (0.560, 0.0400), (0.566, 0.0260), (0.566, -0.0050)],
            0.0190, (0, 0, 0), Gunmetal, bevel=0.0025, seg=2)
    for sx in (-1, 1):
        m.prism([(0.540, 0.0380), (0.5400, 0.0600), (0.5440, 0.0680), (0.5580, 0.0680), (0.5620, 0.0600), (0.5620, 0.0380)],
                0.0028, (sx * 0.0086, 0, 0), Gunmetal, bevel=0.0006, seg=1, wear=0.5)
    m.cyl(0.0013, 0.0270, (0, 0.5510, 0.0535), Gunmetal, seg=8, wear=0.2)
    m.tube(0.0112, 0.0050, 0.0400, (0, 0.6450, BZ), Gunmetal, rot=AXIS_YF, chamfer=0.0015)           # muzzle nut
    m.cyl(0.0052, 0.0010, (0, 0.6300, BZ), Bore, rot=AXIS_YF, seg=10, wear=0)
    # magazine: curved, ribbed steel
    path = [(0, 0.0580, -0.0240), (0, 0.0650, -0.0820), (0, 0.0840, -0.1480), (0, 0.1150, -0.2060)]
    m.sweep(path, 1.0, Gunmetal, profile=rect_profile(0.0262, 0.0640, 0.005), up=(1, 0, 0), smooth=2)
    for sx in (-1, 1):
        for off in (-0.016, 0.0, 0.016):
            m.sweep(path[1:], 1.0, Gunmetal, loc=(sx * 0.0133, 0, 0), up=(1, 0, 0), smooth=2, wear=0.5,
                    profile=[(off - 0.0035, -0.0010), (off + 0.0035, -0.0010), (off + 0.0035, 0.0010), (off - 0.0035, 0.0010)])
    m.box((0.0290, 0.0700, 0.0050), (0, 0.1185, -0.2095), Gunmetal, rot=(-0.50, 0, 0), bevel=0.0012, seg=1)
    m.box((0.0070, 0.0090, 0.0240), (0, 0.0240, -0.0420), Gunmetal, rot=(0.25, 0, 0), bevel=0.0012, seg=1)   # magazine catch
    # trigger group, pistol grip
    guard(m, [(0.0200, -0.0310), (0.0180, -0.0580), (0.0080, -0.0645), (-0.0600, -0.0645), (-0.0690, -0.0500)],
          Gunmetal, w=0.0130, t=0.0026)
    trigger(m, -0.0320, -0.0310, Steel, h=0.024)
    m.shaped([(-0.0830, -0.0300, 0.0270, 0.0360), (-0.0900, -0.0550, 0.0280, 0.0400), (-0.1000, -0.0850, 0.0290, 0.0440),
              (-0.1080, -0.1120, 0.0280, 0.0440)], Wood, n=20, power=2.8, ends=0.72)
    # stock and butt plate
    m.shaped([(-0.132, -0.0040, 0.0340, 0.0480), (-0.200, -0.0120, 0.0360, 0.0560), (-0.300, -0.0240, 0.0380, 0.0880),
              (-0.385, -0.0340, 0.0400, 0.1120)], Wood, n=24, power=2.7, ends=0)
    m.shaped([(-0.385, -0.0340, 0.0404, 0.1125), (-0.3930, -0.0350, 0.0400, 0.1120)], Gunmetal, n=24, power=2.7, ends=0.9)
    m.box((0.0360, 0.0240, 0.0500), (0, -0.1380, -0.0040), Gunmetal, bevel=0.003, seg=1)              # rear trunnion
    m.torus(0.0090, 0.0016, (-0.0190, -0.3300, -0.0600), Steel, rot=AXIS_Y, seg=14, sub=6)           # sling loops
    m.torus(0.0090, 0.0016, (-0.0170, 0.3650, 0.0140), Steel, rot=AXIS_Y, seg=14, sub=6)
    REF['Rifle'] = dict(sight=0.067, muzzle=(0.665, BZ), handR=(-0.095, -0.072, -0.30), handL=(0.235, -0.030, 0.0))


# ================================================================== SNIPER (bolt action, walnut stock, scope, bipod)
@model('Sniper', 'Weapons', (4.0, -1.5, WZ))
def _(m):
    BZ, SZ = 0.020, 0.072                                                         # bore, scope axis
    m.shaped([(-0.470, -0.0450, 0.0440, 0.1250), (-0.400, -0.0310, 0.0440, 0.1050), (-0.300, -0.0130, 0.0420, 0.0800),
              (-0.210, -0.0040, 0.0380, 0.0500), (-0.150, -0.0060, 0.0400, 0.0500), (-0.080, -0.0120, 0.0460, 0.0460),
              (0.100, -0.0140, 0.0480, 0.0440), (0.300, -0.0120, 0.0440, 0.0380), (0.365, -0.0100, 0.0400, 0.0320)],
             Wood, n=24, power=2.7, ends=0.7)                                     # one-piece stock
    m.shaped([(-0.425, 0.0100, 0.0400, 0.0340), (-0.345, 0.0140, 0.0390, 0.0320), (-0.270, 0.0100, 0.0370, 0.0280)],
             Wood, n=20, power=2.5, ends=0.6)                                     # cheek piece
    m.shaped([(-0.100, -0.0300, 0.0360, 0.0400), (-0.122, -0.0550, 0.0350, 0.0400), (-0.150, -0.0830, 0.0340, 0.0400)],
             Wood, n=20, power=2.6, ends=0.7)                                     # grip
    m.shaped([(-0.4700, -0.0450, 0.0444, 0.1255), (-0.4900, -0.0480, 0.0440, 0.1250)], Rubber, n=24, power=2.7, ends=0.85)
    # action
    m.cyl(0.0165, 0.2150, (0, -0.0025, BZ), Gunmetal, rot=AXIS_YF, seg=24, bevel=0.0015)
    m.box((0.0020, 0.0700, 0.0130), (0.0160, 0.0100, 0.0250), Bore, wear=0)        # ejection port
    m.cyl(0.0082, 0.0680, (0.0040, 0.0100, BZ + 0.0020), Chrome, rot=AXIS_YF, seg=14)                # bolt body in the port
    m.cyl(0.0110, 0.0340, (0, -0.1270, BZ), Gunmetal, rot=AXIS_YF, seg=18, bevel=0.003)              # bolt shroud
    m.sweep([(0.010, -0.0920, BZ), (0.030, -0.0940, 0.0140), (0.046, -0.0980, 0.0010)], [0.0048, 0.0042, 0.0042], Steel,
            seg=10, smooth=1)
    m.sphere(0.0098, (0.0500, -0.0990, -0.0030), Polymer, seg=16, rings=10)        # bolt knob
    # heavy barrel and muzzle brake
    m.lathe([(0.0158, 0.0), (0.0158, 0.040), (0.0128, 0.110), (0.0108, 0.620)], (0, 0.100, BZ), Gunmetal, rot=AXIS_YF, seg=20)
    barrel(m, 0.0142, 0.0042, 0.715, 0.7950, BZ, Gunmetal, chamfer=0.002)
    for y in (0.740, 0.760, 0.780):
        m.box((0.0300, 0.0080, 0.0070), (0, y, BZ), Bore, wear=0)
    # bottom metal, magazine, trigger
    m.box((0.0220, 0.1600, 0.0050), (0, -0.0200, -0.0360), Gunmetal, bevel=0.0015, seg=1)
    m.box((0.0260, 0.0720, 0.0300), (0, 0.0350, -0.0480), Gunmetal, bevel=0.003, seg=2)
    guard(m, [(-0.0180, -0.0370), (-0.0200, -0.0590), (-0.0300, -0.0670), (-0.0700, -0.0670), (-0.0820, -0.0570),
              (-0.0860, -0.0400)], Gunmetal)
    trigger(m, -0.0500, -0.0375, Steel, h=0.022)
    # scope: one turned tube, glass set back inside each end
    S = 0.030
    m.lathe([(0.0178, -0.1500), (0.0205, -0.1500), (0.0212, -0.1460), (0.0212, -0.1050), (0.0190, -0.0985),
             (0.0190, -0.0860), (0.0145, -0.0780), (0.0127, -0.0740), (0.0127, -0.0170), (0.0168, -0.0150),
             (0.0168, 0.0150), (0.0127, 0.0170), (0.0127, 0.0850), (0.0222, 0.1300), (0.0240, 0.1400),
             (0.0240, 0.1880), (0.0212, 0.1880), (0.0212, 0.1740), (0.0, 0.1740)], (0, S, SZ), Anodized, rot=AXIS_YF, seg=28)
    m.cyl(0.0210, 0.0006, (0, S + 0.1746, SZ), Lens, rot=AXIS_YF, seg=24, wear=0)
    m.cyl(0.0176, 0.0080, (0, S - 0.1470, SZ), Bore, rot=AXIS_YF, seg=20, wear=0)
    m.cyl(0.0172, 0.0006, (0, S - 0.1512, SZ), Lens, rot=AXIS_YF, seg=20, wear=0)
    m.gear(0.0196, 0.0110, (0, S - 0.0920, SZ), Anodized, rot=AXIS_YF, teeth=24, cut=0.0007)         # power ring
    m.gear(0.0098, 0.0170, (0, S, SZ + 0.0250), Anodized, teeth=18, cut=0.0007)                      # elevation
    m.gear(0.0098, 0.0170, (0.0250, S, SZ), Anodized, rot=AXIS_X, teeth=18, cut=0.0007)              # windage
    m.gear(0.0105, 0.0120, (-0.0225, S, SZ), Anodized, rot=AXIS_X, teeth=20, cut=0.0007)             # parallax
    for y in (-0.0250, 0.0850):
        m.tube(0.0172, 0.0124, 0.0130, (0, y, SZ), Gunmetal, rot=AXIS_YF, chamfer=0.0012, seg=24)    # rings
        m.box((0.0200, 0.0130, 0.0220), (0, y, 0.0455), Gunmetal, bevel=0.002, seg=1)
        for sx in (-1, 1):
            screw(m, sx * 0.0102, y, 0.0480, r=0.0018)
    m.box((0.0180, 0.1500, 0.0040), (0, 0.0300, 0.0372), Gunmetal, bevel=0.001, seg=1)                # scope rail
    # folded bipod, sling studs
    m.box((0.0420, 0.0220, 0.0120), (0, 0.3050, -0.0360), Gunmetal, bevel=0.003, seg=1)
    for sx in (-1, 1):
        m.cyl(0.0060, 0.1500, (sx * 0.0200, 0.3900, -0.0400), Anodized, rot=AXIS_YF, seg=12)
        m.cyl(0.0048, 0.0900, (sx * 0.0200, 0.4900, -0.0400), Steel, rot=AXIS_YF, seg=12)
        m.cyl(0.0078, 0.0200, (sx * 0.0200, 0.5400, -0.0400), Rubber, rot=AXIS_YF, seg=12, bevel=0.002)
        m.gear(0.0085, 0.0100, (sx * 0.0200, 0.4580, -0.0400), Anodized, rot=AXIS_YF, teeth=12, cut=0.0008)
    for y, z in ((-0.4000, -0.0880), (0.2600, -0.0330)):
        m.cyl(0.0030, 0.0080, (0, y, z), Steel, seg=8)
        m.torus(0.0090, 0.0014, (0, y, z - 0.0110), Steel, rot=AXIS_X, seg=16, sub=6)
    REF['Sniper'] = dict(sight=SZ, muzzle=(0.795, BZ), handR=(-0.128, -0.050, -0.60), handL=(0.200, -0.040, 0.0), scope=True)


# ================================================================== ROCKET LAUNCHER (shoulder-fired, warhead loaded)
def warhead(m, y0, z, shell, tip):
    """An anti-tank rocket's front end: stem, cone, ogive and fuze. y0 is where the cone starts."""
    m.lathe([(0.0195, -0.090), (0.0195, 0.0), (0.0425, 0.085), (0.0425, 0.112), (0.0405, 0.150), (0.0330, 0.215),
             (0.0220, 0.275), (0.0125, 0.312), (0.0105, 0.318)], (0, y0, z), shell, rot=AXIS_YF, seg=28)
    m.lathe([(0.0105, 0.0), (0.0105, 0.012), (0.0088, 0.018), (0.0088, 0.030), (0.0050, 0.038), (0.0, 0.040)],
            (0, y0 + 0.318, z), tip, rot=AXIS_YF, seg=18)
    m.tube(0.0430, 0.0400, 0.0100, (0, y0 + 0.098, z), StencilYellow, rot=AXIS_YF, seg=28)           # marking band
    m.tube(0.0200, 0.0180, 0.0060, (0, y0 - 0.030, z), Copper, rot=AXIS_YF, seg=20)                  # driving band


@model('RocketLauncher', 'Weapons', (4.6, -1.5, WZ))
def _(m):
    TZ = 0.070                                                                    # tube axis
    m.lathe([(0.0490, -0.500), (0.0465, -0.494), (0.0245, -0.380), (0.0235, -0.360), (0.0235, 0.420),
             (0.0275, 0.426), (0.0275, 0.450), (0.0212, 0.450), (0.0212, -0.360), (0.0440, -0.500)],
            (0, 0, TZ), Olive, rot=AXIS_YF, seg=28, closed=True)                  # launch tube, open at the back
    m.cyl(0.0214, 0.0010, (0, -0.250, TZ), Bore, rot=AXIS_YF, seg=16, wear=0)
    m.lathe([(0.0240, -0.345), (0.0318, -0.338), (0.0338, -0.330), (0.0338, -0.070), (0.0318, -0.062), (0.0240, -0.055)],
            (0, 0, TZ), Wood, rot=AXIS_YF, seg=24)                                # wooden heat shield
    for y in (-0.320, -0.200, -0.080):
        m.tube(0.0348, 0.0330, 0.0100, (0, y, TZ), OliveDark, rot=AXIS_YF, seg=24)
        m.box((0.0050, 0.0120, 0.0080), (0, y, TZ - 0.0375), OliveDark, bevel=0.001, seg=1)
    m.tube(0.0262, 0.0230, 0.0180, (0, 0.250, TZ), OliveDark, rot=AXIS_YF, seg=24, chamfer=0.001)
    # trigger housing and the two grips
    m.box((0.0260, 0.0900, 0.0240), (0, 0.0050, 0.0370), Parkerized, bevel=0.004, seg=2)
    m.box((0.0100, 0.0140, 0.0160), (0, -0.0440, 0.0420), Parkerized, rot=(0.5, 0, 0), bevel=0.002, seg=1)   # hammer
    m.shaped([(-0.0040, 0.0260, 0.0280, 0.0400), (-0.0075, 0.0000, 0.0300, 0.0420), (-0.0130, -0.0400, 0.0310, 0.0440),
              (-0.0185, -0.0800, 0.0300, 0.0440)], Wood, n=20, power=2.8, ends=0.72)
    guard(m, [(0.0500, 0.0250), (0.0520, 0.0020), (0.0440, -0.0080), (0.0180, -0.0080)], Parkerized, w=0.0100)
    trigger(m, 0.0300, 0.0260, Steel, h=0.022)
    m.box((0.0240, 0.0420, 0.0180), (0, -0.1300, 0.0400), Parkerized, bevel=0.004, seg=2)
    m.shaped([(-0.1340, 0.0300, 0.0280, 0.0380), (-0.1380, 0.0000, 0.0300, 0.0400), (-0.1440, -0.0400, 0.0300, 0.0420),
              (-0.1490, -0.0720, 0.0290, 0.0420)], Wood, n=20, power=2.8, ends=0.72)
    # iron sights (folded up)
    m.box((0.0160, 0.0260, 0.0100), (0, 0.2000, TZ + 0.0270), Parkerized, bevel=0.002, seg=1)
    m.box((0.0040, 0.0050, 0.0420), (0, 0.2000, TZ + 0.0490), Parkerized, bevel=0.0008, seg=1, taper=(0.6, 1))
    m.box((0.0180, 0.0280, 0.0100), (0, -0.0200, TZ + 0.0270), Parkerized, bevel=0.002, seg=1)
    m.box((0.0170, 0.0040, 0.0350), (0, -0.0200, TZ + 0.0480), Parkerized, bevel=0.0008, seg=1)
    for sx in (-1, 1):
        m.box((0.0050, 0.0044, 0.0080), (sx * 0.0052, -0.0200, TZ + 0.0660), Parkerized, bevel=0.0005, seg=1, wear=0.3)
    m.torus(0.0100, 0.0016, (-0.0280, 0.3300, TZ - 0.0100), Steel, rot=AXIS_Y, seg=14, sub=6)        # sling loops
    m.torus(0.0100, 0.0016, (-0.0370, -0.3300, TZ - 0.0100), Steel, rot=AXIS_Y, seg=14, sub=6)
    warhead(m, 0.490, TZ, Olive, Chrome)
    REF['RocketLauncher'] = dict(sight=TZ + 0.070, muzzle=(0.840, TZ), handR=(-0.010, -0.030, -0.15), handL=(0.270, 0.0445, 0.0))


@model('Rocket', 'Weapons', (5.2, -1.5, WZ))
def _(m):                                                                         # the projectile, nose toward +Y
    warhead(m, -0.120, 0.0, Olive, Chrome)
    m.lathe([(0.0, -0.300), (0.0080, -0.296), (0.0130, -0.280), (0.0130, -0.215), (0.0195, -0.205)], (0, 0, 0), Parkerized,
            rot=AXIS_YF, seg=18)                                                  # sustainer motor
    for k in range(4):
        a = k * pi / 2 + pi / 4
        m.box((0.0016, 0.0700, 0.0460), (cos(a) * 0.0340, -0.2500, sin(a) * 0.0340), Parkerized, rot=(0, -a + pi / 2, 0),
              bevel=0.0005, seg=1, shear=-0.03)                                   # fins


# ================================================================== GRENADE (fragmentation, viewmodel size)
def _flat_bottom(c, lim):
    c.z = max(c.z, lim)


@model('Grenade', 'Weapons', (2.0, -1.5, WZ))
def _(m):
    R = 0.0340
    m.sphere(R, (0, 0, 0), GrenadeBody, seg=28, rings=18, warp=lambda c: _flat_bottom(c, -R * 0.94))
    m.torus(R + 0.0002, 0.0012, (0, 0, 0), GrenadeBody, seg=32, sub=6, wear=0.6)   # seam
    for z, a0, a1 in ((0.0120, -1.2, -0.3), (0.0070, -1.2, -0.1), (0.0020, -1.2, -0.5)):
        rr = sqrt(R * R - z * z)
        m.torus(rr + 0.0003, 0.0010, (0, 0, z), StencilYellow, seg=14, sub=4, arc=(a0, a1), wear=0)   # stencilled lines
    m.lathe([(0.0128, 0.0300), (0.0128, 0.0390), (0.0108, 0.0410), (0.0108, 0.0500), (0.0118, 0.0510), (0.0118, 0.0600),
             (0.0085, 0.0625), (0.0, 0.0625)], (0, 0, 0), GrenadeDark, seg=18)    # fuze
    lever = [(0, -0.0090, 0.0640), (0, 0.0100, 0.0640), (0, 0.0180, 0.0600)]
    for i in range(7):
        a = 0.95 - i * 0.26
        lever.append((0, (R + 0.0030) * cos(a), (R + 0.0030) * sin(a)))
    m.sweep(lever, 1.0, Parkerized, profile=rect_profile(0.0150, 0.0016, 0.0004), up=(1, 0, 0), smooth=1)   # safety lever
    m.cyl(0.0012, 0.0340, (0, 0.0005, 0.0555), Steel, rot=AXIS_X, seg=6)           # pin
    m.torus(0.0115, 0.0011, (-0.0270, 0.0005, 0.0470), Steel, rot=(pi / 2, 0, 0.25), seg=20, sub=6)   # pull ring
    m.sweep([(0.0100, -0.0115, 0.0520), (0.0125, 0.0, 0.0540), (0.0100, 0.0125, 0.0520)], 0.0009, Steel, seg=6, smooth=1)


# ================================================================== GRAB GUN (the physics tool)
@model('GrabGun', 'Weapons', (2.5, -1.5, WZ))
def _(m):
    AZ = 0.005                                                                    # emitter axis
    m.shaped([(-0.165, 0.0040, 0.0580, 0.0700), (-0.060, 0.0060, 0.0720, 0.0840), (0.060, 0.0060, 0.0700, 0.0800),
              (0.125, 0.0050, 0.0560, 0.0660)], GrabBody, n=24, power=3.4, ends=0.7)
    for sx in (-1, 1):
        m.box((0.0030, 0.1900, 0.0090), (sx * 0.0357, -0.0200, 0.0100), GlowCyan, wear=0)             # glow strips
        for i in range(5):
            m.box((0.0030, 0.0040, 0.0260), (sx * 0.0352, -0.1000 + i * 0.0110, -0.0180), Bore, rot=(0.3, 0, 0), wear=0)
        m.sweep([(sx * 0.0200, -0.0900, 0.0480), (sx * 0.0320, 0.0200, 0.0520), (sx * 0.0300, 0.1100, 0.0380),
                 (sx * 0.0240, 0.1500, 0.0240)], 0.0032, Rubber, seg=8, smooth=2)                   # cables
    m.lathe([(0.0, -0.085), (0.0130, -0.083), (0.0200, -0.074), (0.0200, 0.066), (0.0150, 0.076), (0.0080, 0.078),
             (0.0080, 0.086), (0.0, 0.086)], (0, -0.0400, 0.0580), Steel, rot=AXIS_YF, seg=20)       # pressure cell
    for y in (-0.090, -0.040, 0.010):
        m.tube(0.0212, 0.0195, 0.0080, (0, y, 0.0580), Parkerized, rot=AXIS_YF, seg=20)
    m.gear(0.0105, 0.0080, (0, 0.0440, 0.0580), RedPaint, rot=AXIS_YF, teeth=10, cut=0.0012)         # valve
    # coil barrel: copper windings between two flanges
    m.cyl(0.0225, 0.1900, (0, 0.2100, AZ), Parkerized, rot=AXIS_YF, seg=24)
    for i in range(11):
        m.torus(0.0255, 0.0044, (0, 0.1560 + i * 0.0100, AZ), Copper, rot=AXIS_Y, seg=24, sub=8)
    for y in (0.1380, 0.2740, 0.3030):
        m.cyl(0.0335, 0.0080, (0, y, AZ), Parkerized, rot=AXIS_YF, seg=24, bevel=0.0015)
    for k in range(3):                                                           # the three claws
        a = k * 2 * pi / 3
        m.prism([(0.292, 0.0240), (0.330, 0.0450), (0.375, 0.0460), (0.398, 0.0300), (0.402, 0.0200), (0.392, 0.0180),
                 (0.372, 0.0320), (0.335, 0.0320), (0.300, 0.0140)], 0.0130, (0, 0, AZ), GrabBody, rot=(0, a, 0),
                bevel=0.003, seg=2)
        m.box((0.0060, 0.0260, 0.0020), (sin(a) * 0.0290, 0.3500, AZ + cos(a) * 0.0290), GlowCyan, rot=(0, a, 0), wear=0)
    m.sphere(0.0190, (0, 0.3380, AZ), GlowCyan, seg=20, rings=12, wear=0)          # core
    m.torus(0.0220, 0.0030, (0, 0.3180, AZ), Parkerized, rot=AXIS_Y, seg=24, sub=8)
    # grip, trigger, foregrip
    m.shaped([(-0.0870, -0.0380, 0.0340, 0.0460), (-0.0940, -0.0650, 0.0340, 0.0470), (-0.1030, -0.1000, 0.0340, 0.0490),
              (-0.1100, -0.1280, 0.0330, 0.0490)], Polymer, n=20, power=3.0, ends=0.72)
    m.box((0.0346, 0.0250, 0.0560), (0, -0.0990, -0.0880), PolymerGrip, rot=(-0.25, 0, 0), bevel=0.005, seg=2)
    guard(m, [(-0.0200, -0.0360), (-0.0190, -0.0600), (-0.0280, -0.0690), (-0.0600, -0.0690), (-0.0720, -0.0600)], Polymer)
    trigger(m, -0.0440, -0.0365, GlowOrange, h=0.022)
    m.box((0.0420, 0.0900, 0.0120), (0, 0.0750, -0.0380), Polymer, bevel=0.005, seg=2)
    REF['GrabGun'] = dict(muzzle=(0.370, AZ), handR=(-0.100, -0.088, -0.25), handL=(0.075, -0.045, 0.0))
