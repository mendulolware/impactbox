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
| RMB | throw the object you're holding (Grab Gun) |
| 1-6 or wheel | Pistol, Shotgun, Rifle, Machete, Grenade, Grab Gun |
| Q (or Tab) | spawn menu |
| T | slow-mo |
| X | delete what you're aiming at (or holding) |
| C | clear everything |

## Layout

| File | What it does |
| --- | --- |
| `main.js` | renderer, game loop, input, spawn menu, explosions, hit routing |
| `ragdoll.js` | 11-part jointed ragdoll, balance/wander controller, damage, severing, gibbing, bleeding |
| `weapons.js` | weapon definitions, firing, melee, grenades, grab gun, viewmodels |
| `props.js` | crates, barrels, explosive barrels, balls, grenades |
| `gore.js` | instanced blood/gib/fire particles and surface decals |
| `player.js` | first-person character controller |
| `world.js` | arena, lighting, ground |
| `audio.js` | procedural sound effects |

## How NPCs work

An NPC is in one of three modes (`ragdoll.js`):

- `anim` - its bodies are kinematic and follow a procedural walk/idle pose. No physics forces, so no jitter.
- `ragdoll` - any hit, blast, fall, grab or death makes the bodies dynamic and joints take over.
- `getup` - if it survived, it blends from where it landed back into the animation.

Parts of the same NPC never collide with each other (contact hook in `main.js`); soft joint limits stop limbs folding through the body.
Rapier must stay at 0.21 or newer: older builds crash when an NPC is deleted after one of its joints was cut.

## Gore

`gore.js`: stretched blood droplets that stick where they land (floors, walls, ramps), procedural splatter decals that drip on walls,
pools that spread under bodies and stumps, wounds stuck onto the body part that was hit, and physical meat/bone chunks.
`ragdoll.js` adds bone-and-flesh stumps and pulsing arterial spray when a limb comes off.

## Models

All models are made in Blender and exported to `assets/models.glb`, which `models.js` loads at startup.
If the file is missing the game falls back to primitive shapes.

- `models/impactbox-models.blend` - the Blender scene (character parts, weapons, props).
- `models/build_models.py` - regenerates every model and re-exports the GLB. Open the .blend, then run it from the Scripting tab.
- `models/previews/` - renders.

Rules the game relies on: one object per model, named as in `MODEL_OF` (`ragdoll.js`, `props.js`) and `VIEWMODELS` (`weapons.js`);
+Y is forward in Blender; character part origins sit at the collider centre; materials named `Skin`, `Shirt` and `Pants` are re-coloured per NPC.
Hand-edit the models in Blender if you like, but re-running the script overwrites them, so export with File > Export > glTF (selection only) instead.

## Tuning knobs

- Body part HP and layout: `PARTS` at the top of `ragdoll.js`.
- Weapon damage, rate, impulse: `WEAPONS` at the top of `weapons.js`.
- Max NPCs: `MAX_RAGDOLLS` in `main.js`.
