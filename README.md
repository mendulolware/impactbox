# IMPACTBOX

A browser physics sandbox inspired by Gorebox: ragdoll NPCs, weapons, dismemberment, explosions, a spawn menu.
Built with three.js (rendering) and Rapier (physics). Both libraries are vendored in `vendor/`, so it runs offline.

## Run

```
python serve.py
```

Then open http://localhost:8123. (ES modules need http://, opening `index.html` directly won't work.)

## Controls

| Key | Action |
| --- | --- |
| WASD / Shift / Space | move / sprint / jump |
| LMB | fire / swing / throw / grab |
| RMB | aim down the sights (guns); throw the held object (Grab Gun) |
| V | helmet cam on/off |
| 1-9, 0, - or wheel | Pistol, Revolver, SMG, Shotgun, Rifle, Sniper, Rocket, Machete, Knife, Grenade, Grab Gun |
| Q (or Tab) | spawn menu |
| T | slow-mo |
| X | delete what you're aiming at (or holding) |
| C | clear everything |

## Layout

| File | What it does |
| --- | --- |
| `main.js` | renderer, game loop, input, spawn menu, explosions, hit routing |
| `ragdoll.js` | 11-part body: procedural animation, active ragdoll, damage, severing, gibbing, bleeding |
| `brain.js` | NPC AI: senses, civilian / thug / zombie behaviour, steering |
| `weapons.js` | weapon definitions, firing, melee, grenades, grab gun, viewmodels |
| `props.js` | crates, barrels, explosive barrels, balls, grenades |
| `gore.js` | instanced blood/gib/fire particles and surface decals |
| `wounds.js` | holes cut into body parts, and what is visible inside them |
| `player.js` | first-person character controller |
| `world.js` | arena, lighting, ground |
| `audio.js` | procedural sound effects |

## How NPCs work

An NPC is in one of three modes (`ragdoll.js`):

- `anim` - its bodies are kinematic and follow a procedural pose (walk, run, hands up, cower, fight). No physics forces, so no jitter.
- `ragdoll` - heavy hits, blasts, falls, grabs and death make the bodies dynamic and joints take over.
- `getup` - if it survived, it blends from where it landed back into the animation.

**AI (`brain.js`).** Each NPC has a Brain that senses (line of sight, hearing, whether a gun is aimed at it) and tells the body
what it wants: a heading, a speed, a gesture and something to look at. Steering uses three feeler rays to go around obstacles, and NPCs turn away from ledges.

| Kind | Behaviour |
| --- | --- |
| Civilian | wanders; freezes then runs from gunfire, explosions, deaths it sees and zombies; puts its hands up while you aim a gun at it; cowers when cornered |
| Thug | calm until shot at or hit, then runs you down and punches (you have health now); flees when badly hurt |
| Zombie | hunts the nearest living thing, lunges and bites; only head damage really stops it; anyone it bites rises as a zombie 6 seconds after dying |

**Active ragdoll (`muscles()` in `ragdoll.js`).** Every joint is pulled toward a target angle with a strength called tone, plus joint friction and
swing/twist limits. A living NPC braces as it falls and writhes when badly hurt; a dead one loses tone and goes limp, with a few twitches.
Light hits make a standing NPC flinch and stagger instead of dropping; legs, heads, blades, blasts, repeated hits and low health put it down.

Parts of the same NPC never collide with each other (contact hook in `main.js`).
Rapier must stay at 0.21 or newer: older builds crash when an NPC is deleted after one of its joints was cut.

## First person

- **Hands:** `HandR` (grip) and `HandL` (support) models are attached per weapon. Placements live in the `VIEW` table in `weapons.js`.
- **Aiming:** right mouse moves the weapon so its sight line (`sight` in `VIEW`) sits on the screen centre, narrows the field of view, tightens spread and slows you down. Guns have real rear notches and front posts.
- **Helmet cam (V):** wide field of view with a light colour grade and corner darkening in `main.js` (no fisheye, no grain), a camera that lags slightly behind your aim, heavier head bob and a REC overlay. Aiming in this view shoulders the weapon below the camera instead of putting the sights on screen, as in real helmet footage; shots leave from eye level along the weapon.

## Weapons

Stats live in `WEAPONS` and first-person placement in `VIEW`, both at the top of `weapons.js`.

- **Sniper** rounds pass through up to three bodies; aiming swaps the weapon for a full-screen scope.
- **Rocket** is a physical projectile (`flyRocket` in `props.js`) that explodes on whatever is in front of it.
- **Knife** is hand-driven, like a VR controller. Hold the left mouse button and the mouse moves your hand instead of your view;
  hold the right button and push the mouse forward to thrust. The blade is swept through the world every frame (`updateKnife`),
  so what it cuts, where, and how deep depends on how you move: fast swipes slash, point-first movement stabs, slow contact does nothing.

## Gore

`gore.js`: stretched blood droplets that stick where they land (floors, walls, ramps), procedural splatter decals that drip on walls,
pools that spread under bodies and stumps, wounds stuck onto the body part that was hit, and physical meat/bone chunks.
`ragdoll.js` adds bone-and-flesh stumps and pulsing arterial spray when a limb comes off.

`wounds.js` opens real holes in bodies. Each wound is a sphere in the body part's local space, and the part's
materials get a shader that discards every pixel inside it. Behind the skin there is an inside-out flesh wall,
a shrunken meat core with narrower holes (so the wound has depth), and innards: ribs, spine, lungs, heart, gut,
brain and limb bones. Bullets cut an entry hole and a larger exit hole; hits near an existing wound widen it.
Hole size per weapon is `hole` in the `WEAPONS` table; a part holds up to 12 wounds.

## Models

All models are made in Blender and exported to `assets/models.glb`, which `models.js` loads at startup.
If the file is missing the game falls back to primitive shapes.

- `models/impactbox-models.blend` - the Blender scene (character parts, weapons, first-person hands, props).
- `models/build_models.py` - regenerates every model and re-exports the GLB. Open the .blend, then run it from the Scripting tab.
- `models/previews/` - renders.

The library also holds models that are built and exported but not used by the game yet: melee weapons (Axe, BaseballBat, Crowbar,
Katana, Chainsaw, SledgeHammer) and guns (DoubleBarrel, Uzi, Minigun, Crossbow, Flamethrower). The props (chair, table, toilet, traffic cone,
propane tank, pallet, sandbags, dumpster, street lamp, car) are in the spawn menu, and the headwear (PoliceCap, HardHat, CombatHelmet, Balaclava)
is worn by some NPCs.

Rules the game relies on: one object per model, named as in `MODEL_OF` (`ragdoll.js`, `props.js`) and `VIEWMODELS` (`weapons.js`);
+Y is forward in Blender; character part origins sit at the collider centre; materials named `Skin`, `Shirt` and `Pants` are re-coloured per NPC.
Hand-edit the models in Blender if you like, but re-running the script overwrites them, so export with File > Export > glTF (selection only) instead.

## Tuning knobs

- Body part HP and layout: `PARTS` at the top of `ragdoll.js`.
- Weapon damage, rate, impulse: `WEAPONS` at the top of `weapons.js`.
- Max NPCs: `MAX_RAGDOLLS` in `main.js`.
