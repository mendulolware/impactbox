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
| G | graphics: high / fast (turns the effects off on slow machines) |
| 1-9, 0, - or wheel | Pistol, Revolver, SMG, Shotgun, Rifle, Sniper, Rocket, Machete, Knife, Grenade, Grab Gun |
| Q (or Tab) | spawn menu |
| T | slow-mo |
| X | delete what you're aiming at (or holding) |
| C | clear everything |

## Layout

| File | What it does |
| --- | --- |
| `main.js` | renderer, game loop, input, spawn menu, explosions, hit routing |
| `ragdoll.js` | 11-body ragdoll under one skinned figure: procedural animation, active ragdoll, damage, severing, gibbing, bleeding |
| `brain.js` | NPC AI: senses, civilian / thug / zombie behaviour, steering |
| `weapons.js` | weapon definitions, firing, melee, grenades, grab gun, viewmodels |
| `props.js` | crates, barrels, cars, furniture, grenades, rockets and the rest of the spawn menu |
| `models.js` | loads `assets/models.glb`; lays surface detail and edge wear over the models; hands out body pieces |
| `detail.js` | fine tiling surfaces for the models (steel, plastic, wood grain, cloth, leather, skin), generated in code |
| `gore.js` | instanced blood/gib/fire particles and surface decals |
| `wounds.js` | holes cut into body parts, and what is visible inside them |
| `player.js` | first-person character controller |
| `world.js` | arena, sky with clouds, sun, fog, painted lines |
| `textures.js` | asphalt, concrete and timber generated in code, each with colour, normal and roughness maps |
| `post.js` | picture pipeline: ambient occlusion, bloom, colour grade |
| `audio.js` | procedural sound effects |
| `viewer.html` | a turntable for looking at any model under the game's own sky and lighting (not part of the game) |

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

**The body you see** is one continuous skinned figure (`models/character.py`): T-shirt, jeans and trainers over a body whose surface runs
unbroken through the elbows, knees, waist, shoulders, hips and neck. Each of the eleven rigid bodies is a bone, and every vertex
follows one or two of them, so limbs bend instead of hinging. The figure is stored as a piece per rigid body so that each can
still be wounded, cut off or destroyed on its own; when a joint parts, `detach()` makes the skin on each side stop following the other,
and the caps of flesh and bone that were hidden inside the joint become the stumps. Skin, shirt, trouser and hair colours are chosen per NPC.

Parts of the same NPC never collide with each other (contact hook in `main.js`).
Rapier must stay at 0.21 or newer: older builds crash when an NPC is deleted after one of its joints was cut.

## First person

- **Hands:** gloved hands with sleeves are attached per weapon: `HandR` grips, `HandL` cups a fore-end, `HandSupport` closes over the
  gripping hand for a two-handed pistol hold, and `KnifeHand` holds the knife while a sleeve is stretched back to the elbow.
  They all come from one hand builder (`models/hands.py`) that is given finger joint angles. Placements live in the `VIEW` table in `weapons.js`.
- **Aiming:** right mouse moves the weapon so its sight line (`sight` in `VIEW`) sits on the screen centre, narrows the field of view, tightens spread and slows you down. Guns have real rear notches and front posts.
- **Helmet cam (V):** wide field of view with a light colour grade and corner darkening in `main.js` (no fisheye, no grain), a camera that lags slightly behind your aim, heavier head bob and a REC overlay. Aiming in this view shoulders the weapon below the camera instead of putting the sights on screen, as in real helmet footage; shots leave from eye level along the weapon.

## Graphics

Nothing is loaded from image files. `textures.js` bakes tileable surface materials at startup, `world.js` draws the sky in a shader and bakes
it into the environment map that lights everything, and `post.js` renders the scene to an HDR image and applies ambient occlusion
(soft shadow in creases and where things touch), bloom (glow from the sun, fire and muzzle flashes) and a colour grade. Press G to switch
the pipeline off.

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
a layer of meat (the same skin pulled in along its normals, with narrower holes, so the wound has depth), and innards: ribs,
spine, lungs, heart, gut, brain and limb bones. All of it is skinned to the same bones as the body. Bullets cut an entry hole and a larger exit hole; hits near an existing wound widen it.
Hole size per weapon is `hole` in the `WEAPONS` table; a part holds up to 12 wounds.

## Models

Every model is built by code in Blender and exported to `assets/models.glb` (59 models, about 215,000 triangles), which `models.js`
loads at startup. If the file is missing the game falls back to primitive shapes. Pictures of everything are in `models/previews/`.

To rebuild: open `models/impactbox-models.blend` and run `models/build_models.py` from the Scripting tab, or from a terminal

    blender -b models/impactbox-models.blend -P models/build_models.py -P models/render_previews.py

| File | What it builds |
| --- | --- |
| `kit.py` | the modelling kit: boxes, lathed profiles, extruded outlines, swept tubes, lofts, rounded grips and stocks, blades, knurled knobs |
| `materials.py` | every material, with what the game should lay over it and what shows through when it wears |
| `guns.py`, `guns2.py`, `melee.py` | the weapons in the game: pistol, revolver, SMG, pump shotgun, rifle, scoped sniper, rocket launcher, grenade, grab gun, knife, machete |
| `extras.py` | built but not wired in yet: axe, bat, crowbar, katana, chainsaw, sledgehammer, double-barrel, Uzi, minigun, crossbow, flamethrower |
| `hands.py` | the first-person hands, and the hand builder the NPCs share |
| `props.py`, `car.py` | crate, drums, concrete block, plank, chair, table, cone, propane tank, pallet, dumpster, street lamp, sandbags, toilet, ball, car |
| `character.py` | the NPC body (see "How NPCs work") |
| `hats.py` | balaclava, combat helmet, hard hat, police cap - shaped on the head model so they fit it |

What makes them read as real things rather than shapes:

- **Real profiles.** Guns are extruded from side outlines with proper sights, barrels with actual bores, trigger guards bent from
  flat bar, grips and stocks lofted from rounded sections. Dimensions are those of the real objects.
- **Baked into the vertices** when a model is finished (`kit.py`): area-weighted normals, so bevelled edges catch the light;
  ambient occlusion, so creases and contact lines are darker; and wear on exposed convex edges.
- **Surface detail** (`detail.js`): each material names a fine tiling surface, laid over it at true scale because the models carry
  texture coordinates in metres. It stays sharp with a gun right in front of the camera.
- **Wear** (`models.js`): where the baked wear is high the shader swaps the finish for what is underneath - bright steel under
  bluing, rust under paint, pale wood under varnish - breaking the edge up with the detail texture.

Rules the game relies on: models are found by object name (`MODEL_OF` in `props.js`, `VIEW` in `weapons.js`, `Body_<part>` in `ragdoll.js`);
+Y is forward in Blender; materials named `Skin`, `Shirt`, `Pants`, `Hair` and `CarPaint` are re-coloured per instance.
The build prints `ref`: the sight height, muzzle and hand positions of each gun, which go in the `VIEW` table.
`viewer.html` shows any model on a turntable under the game's lighting.

## Tuning knobs

- Body part HP and layout: `PARTS` at the top of `ragdoll.js`.
- Weapon damage, rate, impulse: `WEAPONS` at the top of `weapons.js`.
- Max NPCs: `MAX_RAGDOLLS` in `main.js`.
