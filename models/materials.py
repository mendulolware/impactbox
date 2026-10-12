"""Every material in the game. Names are part of the contract with the JavaScript:
Skin / Shirt / Pants / Hair are re-tinted per NPC, GrenadeBody flashes, Sleeve is reused for the knife arm.

detail picks the tiling surface the game lays over the colour (textures.js); tile is its size in
metres. wear = (r, g, b, metal, rough) is what shows through on rubbed edges.
"""
BARE = (0.56, 0.57, 0.59, 1.0, 0.30)        # bright steel under bluing or paint
RUSTY = (0.23, 0.16, 0.12, 0.75, 0.62)      # primer and rust under old paint
SCUFF = (0.13, 0.13, 0.135, 0.0, 0.45)      # polished high spots on black plastic
RAWWOOD = (0.50, 0.36, 0.22, 0.0, 0.75)     # bare timber under varnish

# ---- people
Skin = material('Skin', (0.80, 0.60, 0.48), 0.52, detail='skin', tile=0.045, dirt=0.03, ao=0.6, bump=0.55)
Shirt = material('Shirt', (0.42, 0.10, 0.09), 0.92, detail='cloth', tile=0.035, dirt=0.05, ao=0.7, bump=0.9)
Pants = material('Pants', (0.10, 0.13, 0.20), 0.9, detail='denim', tile=0.04, dirt=0.07, ao=0.7, bump=1.0)
Hair = material('Hair', (0.06, 0.04, 0.03), 0.6, detail='hair', tile=0.05, dirt=0.1, ao=0.6, bump=1.2)
Shoe = material('Shoe', (0.045, 0.04, 0.038), 0.5, detail='leather', tile=0.05, wear=(0.2, 0.17, 0.14, 0, 0.7),
                wearable=0.5, dirt=0.1)
Sole = material('Sole', (0.62, 0.61, 0.57), 0.85, detail='rubber', tile=0.03, dirt=0.25)
Lace = material('Lace', (0.75, 0.74, 0.70), 0.9, detail='cloth', tile=0.01)
Belt = material('Belt', (0.06, 0.04, 0.028), 0.5, detail='leather', tile=0.05)
EyeWhite = material('EyeWhite', (0.70, 0.68, 0.65), 0.15, dirt=0.0, ao=0.5)
EyeIris = material('EyeIris', (0.20, 0.13, 0.07), 0.1, dirt=0.0, ao=0.3)
EyeDark = material('EyeDark', (0.01, 0.008, 0.008), 0.08, dirt=0.0, ao=0.0)
Lip = material('Lip', (0.60, 0.33, 0.30), 0.42, detail='skin', tile=0.03, dirt=0.0, ao=0.5, bump=0.4)
Teeth = material('Teeth', (0.78, 0.74, 0.64), 0.3, dirt=0.0)
Flesh = material('Flesh', (0.36, 0.03, 0.03), 0.3, dirt=0.3, ao=0.0)
BoneEnd = material('BoneEnd', (0.80, 0.74, 0.62), 0.5, dirt=0.2, ao=0.0)

# ---- firearms
Gunmetal = material('Gunmetal', (0.05, 0.052, 0.058), 0.47, 1.0, detail='steel', tile=0.06, wear=BARE,
                    wearable=1.0, dirt=0.08)
Parkerized = material('Parkerized', (0.075, 0.08, 0.078), 0.62, 0.9, detail='cast', tile=0.04, wear=BARE,
                      wearable=0.8, dirt=0.1)
Anodized = material('Anodized', (0.022, 0.022, 0.025), 0.5, 0.7, detail='cast', tile=0.03,
                    wear=(0.62, 0.63, 0.65, 1.0, 0.35), wearable=0.55, dirt=0.06, bump=0.6)
Steel = material('Steel', (0.60, 0.61, 0.63), 0.26, 1.0, detail='steel', tile=0.06, dirt=0.06)
Chrome = material('Chrome', (0.80, 0.81, 0.83), 0.08, 1.0, dirt=0.02, ao=0.6)
Polymer = material('Polymer', (0.026, 0.027, 0.03), 0.6, detail='polymer', tile=0.03, wear=SCUFF, wearable=0.6,
                   dirt=0.08)
PolymerGrip = material('PolymerGrip', (0.022, 0.023, 0.025), 0.82, detail='stipple', tile=0.02, bump=1.6)
Bore = material('Bore', (0.008, 0.008, 0.008), 0.9, dirt=0.0, ao=0.9)
Brass = material('Brass', (0.83, 0.62, 0.27), 0.3, 1.0, detail='steel', tile=0.05)
Copper = material('Copper', (0.80, 0.42, 0.26), 0.35, 1.0)
Wood = material('Wood', (0.19, 0.088, 0.038), 0.42, detail='wood', tile=0.22, wear=RAWWOOD, wearable=0.6,
                dirt=0.08, bump=0.7)
WoodPale = material('WoodPale', (0.60, 0.43, 0.24), 0.55, detail='wood', tile=0.25, wear=RAWWOOD, wearable=0.3,
                    dirt=0.1, bump=0.8)
Rubber = material('Rubber', (0.02, 0.02, 0.021), 0.85, detail='rubber', tile=0.03, dirt=0.1)
Lens = material('Lens', (0.012, 0.03, 0.05), 0.03, 1.0, coat=1.0, dirt=0.0, ao=0.3)
SightDot = material('SightDot', (0.92, 0.94, 0.90), 0.5, emit=0.6, dirt=0.0, ao=0.0)
SightRed = material('SightRed', (1.0, 0.12, 0.05), 0.4, emit=1.5, dirt=0.0, ao=0.0)
Olive = material('Olive', (0.115, 0.14, 0.075), 0.55, 0.3, detail='paint', tile=0.08, wear=BARE, wearable=0.9,
                 dirt=0.12)
OliveDark = material('OliveDark', (0.06, 0.075, 0.045), 0.7, 0.1, detail='paint', tile=0.08, wear=BARE,
                     wearable=0.5, dirt=0.12)
GrenadeBody = material('GrenadeBody', (0.10, 0.14, 0.07), 0.6, 0.35, detail='cast', tile=0.04, wear=BARE,
                       wearable=0.7, dirt=0.12)
GrenadeDark = material('GrenadeDark', (0.05, 0.07, 0.04), 0.75, 0.2, detail='cast', tile=0.04)
StencilYellow = material('StencilYellow', (0.85, 0.66, 0.05), 0.6, dirt=0.15)
GrabBody = material('GrabBody', (0.10, 0.15, 0.27), 0.38, 0.6, detail='paint', tile=0.08, wear=BARE, wearable=0.8)
GlowCyan = material('GlowCyan', (0.25, 0.80, 1.0), 0.3, emit=3.5, dirt=0.0, ao=0.0)
GlowOrange = material('GlowOrange', (1.0, 0.45, 0.08), 0.3, emit=3.0, dirt=0.0, ao=0.0)
RedPaint = material('RedPaint', (0.50, 0.035, 0.03), 0.42, 0.25, detail='paint', tile=0.08, wear=BARE,
                    wearable=1.0, dirt=0.1)
YellowPaint = material('YellowPaint', (0.80, 0.56, 0.03), 0.45, 0.2, detail='paint', tile=0.08, wear=BARE,
                       wearable=1.0, dirt=0.1)
Tape = material('Tape', (0.035, 0.035, 0.037), 0.75, detail='cloth', tile=0.012, bump=1.2)
Leather = material('Leather', (0.13, 0.07, 0.035), 0.55, detail='leather', tile=0.05,
                   wear=(0.33, 0.21, 0.12, 0, 0.75), wearable=0.5)
Cord = material('Cord', (0.02, 0.02, 0.022), 0.85, detail='cloth', tile=0.008, bump=1.5)
RaySkin = material('RaySkin', (0.80, 0.78, 0.70), 0.6, detail='stipple', tile=0.01)

# ---- first-person hands
Glove = material('Glove', (0.035, 0.036, 0.04), 0.82, detail='cloth', tile=0.012, dirt=0.1, bump=1.3)
GlovePad = material('GlovePad', (0.075, 0.075, 0.08), 0.55, detail='leather', tile=0.03, dirt=0.1)
GloveHard = material('GloveHard', (0.02, 0.02, 0.022), 0.42, detail='polymer', tile=0.03, wear=SCUFF, wearable=0.8)
Sleeve = material('Sleeve', (0.15, 0.175, 0.11), 0.92, detail='canvas', tile=0.03, dirt=0.1, bump=1.2)

# ---- props
CrateWood = material('CrateWood', (0.52, 0.36, 0.19), 0.82, detail='plank', tile=0.5, dirt=0.16, ao=0.8)
CrateFrame = material('CrateFrame', (0.36, 0.22, 0.10), 0.85, detail='plank', tile=0.5, dirt=0.18, ao=0.8)
BarrelBlue = material('BarrelBlue', (0.06, 0.17, 0.38), 0.42, 0.35, detail='paint', tile=0.25, wear=RUSTY,
                      wearable=1.0, dirt=0.16)
BarrelRed = material('BarrelRed', (0.50, 0.045, 0.035), 0.42, 0.35, detail='paint', tile=0.25, wear=RUSTY,
                     wearable=1.0, dirt=0.16)
BarrelRim = material('BarrelRim', (0.16, 0.17, 0.18), 0.5, 0.9, detail='cast', tile=0.08, wear=RUSTY,
                     wearable=0.5, dirt=0.15)
Hazard = material('Hazard', (0.85, 0.60, 0.03), 0.55, 0.1, detail='paint', tile=0.25, wear=RUSTY, wearable=0.8,
                  dirt=0.15)
HazardBlack = material('HazardBlack', (0.03, 0.03, 0.03), 0.6, dirt=0.1)
Concrete = material('Concrete', (0.46, 0.46, 0.45), 0.93, detail='concrete', tile=1.0, dirt=0.14, ao=0.7)
ConcreteDark = material('ConcreteDark', (0.33, 0.33, 0.33), 0.95, detail='concrete', tile=1.0, dirt=0.14)
Rebar = material('Rebar', (0.21, 0.13, 0.09), 0.75, 0.8, detail='cast', tile=0.05)
Iron = material('Iron', (0.11, 0.115, 0.12), 0.55, 0.9, detail='cast', tile=0.06, wear=BARE, wearable=0.7,
                dirt=0.12)
TrafficOrange = material('TrafficOrange', (0.92, 0.20, 0.03), 0.6, detail='polymer', tile=0.05,
                         wear=(0.55, 0.16, 0.06, 0, 0.8), wearable=0.5, dirt=0.2)
Reflective = material('Reflective', (0.86, 0.87, 0.88), 0.32, detail='stipple', tile=0.012, dirt=0.12)
Ceramic = material('Ceramic', (0.86, 0.87, 0.84), 0.07, coat=1.0, dirt=0.05, ao=0.6)
SandCanvas = material('SandCanvas', (0.45, 0.38, 0.24), 0.95, detail='canvas', tile=0.03, dirt=0.2, bump=1.5)
DumpsterGreen = material('DumpsterGreen', (0.045, 0.105, 0.065), 0.55, 0.3, detail='paint', tile=0.3, wear=RUSTY,
                         wearable=1.0, dirt=0.22)
LidPlastic = material('LidPlastic', (0.03, 0.03, 0.032), 0.55, detail='polymer', tile=0.06, wear=SCUFF,
                      wearable=0.6, dirt=0.2)
WhitePaint = material('WhitePaint', (0.80, 0.80, 0.77), 0.45, 0.2, detail='paint', tile=0.2, wear=RUSTY,
                      wearable=1.0, dirt=0.14)
Galvanized = material('Galvanized', (0.47, 0.49, 0.50), 0.5, 0.9, detail='cast', tile=0.12, dirt=0.12)
LampGlass = material('LampGlass', (1.0, 0.86, 0.62), 0.25, emit=4.0, dirt=0.0, ao=0.0)
PlasticWhite = material('PlasticWhite', (0.78, 0.78, 0.75), 0.4, detail='polymer', tile=0.06, dirt=0.1)
Ball = material('Ball', (0.72, 0.27, 0.07), 0.75, detail='stipple', tile=0.02, dirt=0.12, bump=1.4)

# ---- the car
CarPaint = material('CarPaint', (0.05, 0.13, 0.30), 0.32, 0.55, coat=1.0, dirt=0.06, ao=0.65)
CarTrim = material('CarTrim', (0.022, 0.022, 0.024), 0.6, detail='polymer', tile=0.06, dirt=0.1)
CarGlass = material('CarGlass', (0.012, 0.018, 0.022), 0.03, 0.9, coat=1.0, dirt=0.03, ao=0.4)
Tyre = material('Tyre', (0.022, 0.022, 0.023), 0.88, detail='rubber', tile=0.05, dirt=0.25)
Alloy = material('Alloy', (0.62, 0.63, 0.65), 0.3, 1.0, detail='cast', tile=0.1, dirt=0.15, ao=0.8)
HeadLight = material('HeadLight', (0.85, 0.87, 0.90), 0.08, 0.6, coat=1.0, dirt=0.0, ao=0.5)
TailLight = material('TailLight', (0.45, 0.02, 0.02), 0.12, coat=1.0, emit=0.25, dirt=0.0, ao=0.5)
Indicator = material('Indicator', (0.85, 0.35, 0.03), 0.15, coat=1.0, dirt=0.0, ao=0.5)
Plate = material('Plate', (0.82, 0.82, 0.78), 0.5, dirt=0.1)
CarSeat = material('CarSeat', (0.05, 0.05, 0.055), 0.9, detail='cloth', tile=0.03, dirt=0.05)

# ---- headwear
PoliceNavy = material('PoliceNavy', (0.02, 0.035, 0.075), 0.85, detail='cloth', tile=0.02, bump=1.2)
Visor = material('Visor', (0.012, 0.012, 0.014), 0.1, coat=1.0, dirt=0.02)
Badge = material('Badge', (0.85, 0.70, 0.32), 0.25, 1.0)
HelmetShell = material('HelmetShell', (0.13, 0.15, 0.09), 0.75, detail='cast', tile=0.05, wear=(0.2, 0.2, 0.17, 0.2, 0.7),
                       wearable=0.5, dirt=0.14)
Webbing = material('Webbing', (0.10, 0.11, 0.07), 0.9, detail='canvas', tile=0.012, bump=1.5)
Knit = material('Knit', (0.03, 0.03, 0.033), 0.95, detail='knit', tile=0.02, dirt=0.06, bump=1.8)
