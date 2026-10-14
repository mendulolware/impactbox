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
| V | bodycam on/off |
| G | graphics: high / fast (turns the effects off on slow machines) |
| 1-8 or wheel | pick a weapon group; press the same number again for the next weapon in it (table under Weapons) |
| R / F / B | reload / clear a jam / switch auto and semi |
| F | Ready or Not mode: shout for compliance, or arrest whoever has given up in front of you |
| Q / E | lean left / right (hold) |
| N / L | night on the current map / flashlight |
| Tab | spawn menu |
| T | slow-mo |
| X | delete what you're aiming at (or holding) |
| C | clear everything |

## Layout

| File | What it does |
| --- | --- |
| `main.js` | renderer, game loop, input, spawn menu, map switching, explosions, hit routing |
| `maps.js` | the maps: what each is built from and what it starts with |
| `mission.js` | Ready or Not mode: suspects and civilians, shouting, arrests, rules of engagement, the grade |
| `ragdoll.js` | 11-body ragdoll under one skinned figure: procedural animation, active ragdoll, injuries that show (limp arms, limping, crawling, bleeding out), fall damage, severing, gibbing |
| `brain.js` | NPC AI: senses, civilian / thug / zombie behaviour, steering |
| `weapons.js` | weapon definitions, firing, melee, grenades, grab gun, viewmodels |
| `props.js` | crates, barrels, cars, furniture, grenades, rockets and the rest of the spawn menu |
| `models.js` | loads `assets/models.glb`; lays surface detail and edge wear over the models; hands out body pieces |
| `detail.js` | fine tiling surfaces for the models (steel, plastic, wood grain, cloth, leather, skin), generated in code |
| `gore.js` | blood droplets and mist, fire and smoke; decals (splats, spatter, runs, pools, smears); physical chunks (meat, bone, skull, ribs, gut, eyes) |
| `wounds.js` | holes and gashes cut into body parts, blood soaking and running from them, burns, what is visible inside, and the torn stumps |
| `player.js` | first-person character controller |
| `world.js` | sky with clouds, sun, fog and time of day; `MapBuilder`, which turns a map description into colliders and a few merged meshes |
| `textures.js` | asphalt, concrete, timber, brick and sheet metal generated in code, each with colour, normal and roughness maps |
| `post.js` | picture pipeline: ambient occlusion, bloom, colour grade |
| `audio.js` | every sound, made from noise and oscillators: layered gunshots, echo per map, voices, footsteps, ambience |
| `viewer.html` | a turntable for looking at any model under the game's own sky and lighting (not part of the game) |

## Maps

Pick one on the start screen or under **Maps** in the spawn menu (Q). The last one played is remembered; `?map=street` in the address forces one.

| Map | What it is |
| --- | --- |
| The Yard | the original open concrete yard: ramp, platform, cover |
| Warehouse | a sheet-metal shed under an overcast sky: pallet racking, shipping containers, a mezzanine with stairs, a loading dock, hanging lamps |
| Rooftops | five roofs at sunset joined by planks, 18 to 22 m up. Falling off kills you (and anything else) |
| Night Street | a street at dusk: shopfronts, parked cars, a dead-end alley, street lamps |
| Kill House | a walled compound with twelve plywood rooms and a catwalk over them |

A map is one entry in `MAPS` (`maps.js`): a time of day, a spawn point, the rectangle NPCs keep to, `build(b)` and `populate(ctx)`.
`build` gets a `MapBuilder` (`world.js`) with `box`, `cyl`, `wall` (with doorways), `stairs`, `stripe`, `light`, `ground` and `mat`.
Every box gets a collider on one fixed body, and the visible boxes are joined into one mesh per material, so a map of several hundred
pieces is a handful of draw calls. `loadMap()` removes the old map (meshes, materials, colliders) and builds the next.
Times of day are `SKIES` in `world.js`: sun direction and colour, sky colours, cloud cover, fog.
To add a map, add an entry to `MAPS`; both menus list it automatically.

## Ready or Not mode

Start it from the start screen or under **Modes** in the spawn menu; **Sandbox** there turns it off. It runs on whichever map
you are in (the Kill House suits it best). You are a SWAT officer: the map's people are split into armed suspects and civilians,
and the mission ends when every one of them is in custody or dead.

- **E** shouts for compliance ("Police! Hands up!", spoken by the browser's own voice). Civilians obey and stay put with their
  hands up. A suspect gives up with a chance that rises each time you shout, if they are hurt, and if you are aiming at them.
  About one in seven of those is faking, and goes for the gun again once you stop covering them.
- **E** on someone who has given up, or is down, within arm's reach arrests them.
- Suspects (`suspect()` in `brain.js`, `arm()` / `shoot()` in `ragdoll.js`) carry a pistol, aim when they see you and fire about
  once a second, hitting less the further away you are. One who loses the use of the gun arm stops being a shooter.
- **The grade** starts at 100: a suspect shot while a threat costs 5, a suspect shot after surrendering (or unarmed) costs 25
  as unauthorized use of deadly force, a dead civilian costs 30. S is 95 and up. Getting killed fails the mission. **Enter** restarts.

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
swing/twist limits. Each limit is measured from the middle of that joint's real range (`ref` in `JOINTS`), so a hip swings far forward and
hardly back, and a joint at its limit absorbs the motion instead of springing back. A living NPC braces for a moment as it falls and writhes
when badly hurt; a dead one drops at once and goes limp, with a few twitches.
Light hits make a standing NPC flinch and stagger instead of dropping; legs, heads, blades, blasts, repeated hits and low health put it down.
Getting up goes through a crouch (`squat`) instead of sliding straight to standing.

**Hands, feet and self-collision.** Forearms and shins carry an extra collider for the hand and the foot (`EXTRA`), and parts of one body
collide with each other unless they share a joint (`selfCollide`, used by the contact hook in `main.js`). An arm lies on a chest instead of in it.
Bodies have continuous collision detection on, so a thrown one cannot pass through a wall. `preStep()` / `sync()` take the energy out of a
part the solver throws back up off the ground (a heavy torso landing on a light head used to bounce a metre).

**Being hurt shows** (all in `ragdoll.js`):

- Every wound is an entry in `drips`: it drips (a trail on the ground if its owner is moving) and costs health until it clots (limbs) or kills (body wounds). Stumps bleed fastest. Zombies do not bleed out.
- At 20 health or less a human cannot stay standing (`goLimp`), and dies of blood loss if still bleeding ("BLED OUT").
- An arm below about half its health hangs dead (`dangle`, the `limp` set): those bodies stay dynamic while the rest of the NPC is animated.
- A hurt leg limps (`lame`): shorter, stiffer steps on that side, the body tipping over it, and a slower walk.
- A body wound gets a hand pressed to it (`clutch`).
- `crawl()`: an NPC that cannot stand (a leg gone, or too little health) drags itself along on its arms. People crawl away from what frightened them; zombies crawl toward their prey and still bite when they reach it. A bleeding body dragged over the ground leaves a smear (`trail`).
- `impacts()`: a head, chest or pelvis that stops dead against something takes damage, with blood where it hit and a split scalp for heads. A fall of 1.5 m is harmless, 3 m hurts, 8 m kills; being thrown into a wall by the grab gun counts too.

**The body you see** is one continuous skinned figure (`models/character.py`): T-shirt, jeans and trainers over a body whose surface runs
unbroken through the elbows, knees, waist, shoulders, hips and neck. Each of the eleven rigid bodies is a bone, and every vertex
follows one or two of them, so limbs bend instead of hinging. The figure is stored as a piece per rigid body so that each can
still be wounded, cut off or destroyed on its own; when a joint parts, `detach()` makes the skin on each side stop following the other,
adds the caps of flesh and bone that close the cut, and `makeStump()` (`wounds.js`) puts a torn end on each side.
Skin, shirt, trouser and hair colours are chosen per NPC.
An untouched NPC is drawn joined up, one mesh per material (10 draw calls); `split()` swaps in the per-part pieces at the first injury.

Rapier must stay at 0.21 or newer: older builds crash when an NPC is deleted after one of its joints was cut.

## Realism pass

- **Stumbling** (`ragdoll.js`, `stumbleT`): a hard hit that does not kill no longer always drops someone. Most reel backward with their arms out and feet scrabbling, and then either catch themselves or go down; leg hits always end on the ground.
- **Rounds carry on** (`fireGun` in `weapons.js`, `ctx.exitPoint` in `main.js`): each gun has `pen`, the metres of wall, door or crate it goes through (0.1 for a pistol, 0.3 to 0.35 for rifles, 0.7 for the sniper). A round that comes out the far side keeps 60% of its damage; one that only grazes a surface skips off it at half strength.
- **Armour**: the soldier's vest and helmet stop anything with `pen` under 0.25 (pistols, SMGs, buckshot, the revolver) as a bruise, until they have soaked up 120 damage. Rifles go through.
- **Reloading** drops the old magazine, and it stays where it lands (the last twelve do).
- **Ears** (`deafen()` in `audio.js`): a nearby blast, or gunfire in the warehouse and the kill house, dulls everything and leaves a ringing that fades over a few seconds.
- **Suppression**: a suspect's shot that misses drains the colour, closes the edges of the picture in and shakes the view (`uSupp` in `post.js`).
- **Leaning** (Q / E): the head goes 0.42 m out to the side, as far as there is room, and shots leave from there.
- **Cover** (`findCover`, `findPost` in `brain.js`): frightened people freeze (15%), get behind something and peek out (most, when there is something), or run. Armed suspects pick a hiding place with a firing spot a step to one side and go back and forth between them.
- **Casualties**: once calm again, bystanders walk over to a body and crouch by it before it sinks in, and they take hold of anyone who is down and cannot walk and drag them away from where it happened.
- **Night** (N, or the button on the start screen): any map under a moon, with a shadow-casting flashlight (L). People see less than half as far in the dark.
- **Recorded run** (`assets/run.json`, made from a Mixamo clip by `models/import_anim.py`): flat-out running blends from the worked-out stride to motion capture. Walking and everything else is still worked out in `computePose`.

- **Gun handling:** magazine guns keep a round in the chamber through a reload (30+1), and a reload from empty takes 30% longer because the bolt has to go forward; shots spread more on the move and a lot more in the air; sprinting carries the weapon low and it cannot fire until it is back up; aimed weapons drift with your breathing (the sniper most), Shift while aiming holds your breath for about four seconds, and running out leaves you shakier until it comes back; spent cases fly out to the right. Hits no longer play the flesh squish.

## First person

- **Hands:** gloved hands with sleeves are attached per weapon: `HandR` grips, `HandL` cups a fore-end, `HandSupport` closes over the
  gripping hand for a two-handed pistol hold, and `KnifeHand` holds the knife, with a sleeve running back out of view.
  They all come from one hand builder (`models/hands.py`) that is given finger joint angles. Placements live in the `VIEW` table in `weapons.js`.
- **Aiming:** right mouse moves the weapon so its sight line (`sight` in `VIEW`) sits on the screen centre, narrows the field of view, tightens spread and slows you down. Guns have real rear notches and front posts.
- **Bodycam (V):** the picture goes through a small camera: a slow shutter that smears it while you turn, sharpening halos on hard edges, crushed shadows, highlights that clip to white, a faint green cast and grain that gets heavier in the dark (all in the last pass of `post.js`); sound goes through its microphone, thin and clipping on anything loud (`bodycam()` in `audio.js`); a UTC timestamp and a camera ID in the corner. Also: wide field of view through a bent lens (fisheye, colour fringes toward the edges, corner darkening: the last pass in `post.js`), no HUD at all (no crosshair, ammo, health or weapon bar), the nearest eight visible faces blocked out in pixels like released footage (`blockFaces()` in `main.js` hands their screen positions to the shader), a camera that lags slightly behind your aim, heavier head bob and a REC overlay. Aiming in this view shoulders the weapon below the camera instead of putting the sights on screen, as in real helmet footage; shots leave from eye level along the weapon.

## Graphics

Nothing is loaded from image files. `textures.js` bakes tileable surface materials at startup, `world.js` draws the sky in a shader and bakes
it into the environment map that lights everything, and `post.js` renders the scene to an HDR image and applies ambient occlusion
(soft shadow in creases and where things touch), bloom (glow from the sun, fire and muzzle flashes) and a colour grade. Press G to switch
the pipeline off.

## Weapons

Stats live in `WEAPONS` and first-person placement in `VIEW`, both at the top of `weapons.js`. There are 23, in eight groups:

| Key | Group | Weapons |
| --- | --- | --- |
| 1 | Sidearms | Pistol, Revolver |
| 2 | SMGs | SMG, Uzi |
| 3 | Shotguns | Shotgun, Double Barrel |
| 4 | Rifles | Rifle, AR-15, Sniper, Crossbow |
| 5 | Heavy | Rocket, Minigun, Flamethrower |
| 6 | Blades | Knife, Machete, Katana, Axe, Chainsaw |
| 7 | Blunt | Bat, Crowbar, Sledgehammer |
| 8 | Gear | Grenade, Grab Gun, Drone (flies where you look from its own camera, Shift = fast, click or a crash sets it off; it is a slow steered rocket, `flyDrone()` in `main.js`) |

- **Recoil.** Every gun has `rec: [up, sideways]` in radians per shot. `Player.recoil()` turns most of that into a kick the
  view springs back from, and leaves the rest where it landed, so a burst climbs and has to be pulled back down. Sustained
  fire also opens the spread up (`bloom`). Aiming down sights takes 30% off. `RECOIL` in `weapons.js` scales every gun at once.
- **AR-15**: faster, flatter and more accurate than the Rifle, a little less damage per round.
- **Ammunition.** Guns hold `mag` rounds. **R** reloads (`reload` seconds); the shotgun loads one shell at a time and firing
  interrupts it. An empty gun clicks. Each shot has a small chance (`jam`) of stopping the action: **F** racks it clear, losing
  the stuck round. **B** switches automatic weapons between auto and one shot per pull. The double barrel, crossbow and rocket
  launcher reload themselves. The flamethrower's magazine is fuel. Counter and state show bottom right (`tickAmmo`).
- **Double Barrel** fires twice, then takes a second and a half to break open and reload.
- **Crossbow** is silent (nobody runs at the sound) and leaves its bolt standing in whatever it hit.
- **Minigun** has to spin up for most of a second before it fires, and cannot be aimed down sights.
- **Flamethrower** throws a jet of fire about 7 m. What it washes over chars; a person who takes enough of it catches light,
  runs, and burns for several seconds (`scorch()` and `burnT` in `ragdoll.js`).
- **Chainsaw** bites a little at a time while the trigger is held.
- **Hand weapons are weak on purpose.** A swing is one click, reaches under 2 m and hits one thing. It staggers rather than
  drops, kills in roughly 5 to 12 swings, wears a body part down at half the rate a bullet would, and only takes a limb off
  once that part has no health left. Blunt weapons never cut: they break arms (which then hang) and legs (which then limp).

- **Sniper** rounds pass through up to three bodies; aiming swaps the weapon for a full-screen scope.
- **Rocket** is a physical projectile (`flyRocket` in `props.js`) that explodes on whatever is in front of it.
- **Knife**: left button slices (a quick sideways cut that opens a gash running the way the blade travelled), right button
  stabs (a thrust: slower, shorter reach, twice the damage, a puncture). Both are in `updateKnife`; numbers are on the Knife's
  line in `WEAPONS`.

## Sound

There are no audio files; `audio.js` builds everything. A gunshot (`shot()`) is layers: the crack, the body of the blast, a low
thump, the action cycling, and for the AR-15 the ring of its buffer spring; each gun mixes them differently. Sounds are sent into
a generated echo, and `setSpace()` sets how much of it each map has (a lot in the warehouse, little on the rooftops) along with a
quiet background bed: wind, room hum or city. People have voices (`voice()`: a buzzing source through vowel filters): grunts and
screams when hit, a cry when they die, screams when they run or burn, growls from zombies, all quieter with distance. Also:
spent cases landing, rounds hitting concrete (some whine off), footsteps, and the double barrel being broken open.

## Gore

`gore.js` has three layers:

- **Particles.** Blood droplets are small, glossy and drawn out into streaks by their speed; a fine red mist hangs for half a second where a round went through; fire and smoke are soft-edged puffs.
- **Decals.** Five kinds of mark, each drawn once at start-up (`SHAPES`, `bakeDecal`) with a melted outline, darker where the blood is thick, and a raised lip so it catches the light: impact splats, fine directional spatter behind a victim, runs that creep down walls, pools that spread under bodies, and smears where a bleeding body was dragged. Drops that land at an angle leave a long mark pointing the way they were going. Big decals are kept from hanging off edges (`_fit`).
- **Chunks.** Physical pieces that depend on what was destroyed (`CHUNK_MIX`): skull plates, brain and eyes from a head; ribs, gut and organs from a torso; meat, fat and snapped bone from limbs. Each leaves a wet mark where it lands.

`wounds.js` opens real holes in bodies. Each wound is a short line with a radius in the body part's local space (a point for a bullet,
longer for a blade's gash), and the part's materials get a shader that discards every pixel inside it. The wound remembers which way
the bullet or blade went and bores along that, so the hole opens cleanly wherever the skin is. The same shader soaks the skin and
clothes around a wound with blood that spreads and then runs down the body as the wound ages (`woundClock`), and chars whatever an
explosion burned (`burn`). Behind the skin: the skin's own back faces painted as the far wall of the cavity, a layer of meat (the same
skin pulled in along its normals, with narrower holes, so the wound has depth), and innards (ribs, spine, lungs, heart, liver, gut, brain,
limb bones) as one mesh per body part. Bullets cut an entry hole and a larger exit hole; hits near an existing hole widen it.
Hole size per weapon is `hole` in the `WEAPONS` table; a part holds up to 12 wounds.

`makeStump()` builds the torn end left where a limb comes off: a mound of muscle ringed with fat, snapped bone standing out of it (two for a forearm
or shin, spine and windpipe for a neck), ragged skin round the edge, and gut hanging out of a body cut in half. `ragdoll.js` adds the pulsing arterial spray.
Explosions burn and pepper bodies rather than launching them out of the arena, and only destroy the parts that were right on top of the blast.

- **Second gore pass:** blood from a hit within 2.4 m lands on the lens and runs down it (`lens()` in `gore.js`, the `#lens` overlay); anyone who walks through a pool, you included, prints the next nine steps (`wetAt`, `footprint`); a killing head shot takes skull and brain out the back; a torso shot down to its last third opens up and spills (`gutted`); pieces of meat now lie for a minute or two instead of twenty seconds.

## Models

Every model is built by code in Blender and exported to `assets/models.glb` (60 models, about 220,000 triangles), which `models.js`
loads at startup. If the file is missing the game falls back to primitive shapes. Pictures of everything are in `models/previews/`.

To rebuild: open `models/impactbox-models.blend` and run `models/build_models.py` from the Scripting tab, or from a terminal

    blender -b models/impactbox-models.blend -P models/build_models.py -P models/render_previews.py

| File | What it builds |
| --- | --- |
| `kit.py` | the modelling kit: boxes, lathed profiles, extruded outlines, swept tubes, lofts, rounded grips and stocks, blades, knurled knobs |
| `materials.py` | every material, with what the game should lay over it and what shows through when it wears |
| `guns.py`, `guns2.py`, `melee.py` | the weapons in the game: pistol, revolver, SMG, pump shotgun, rifle, scoped sniper, rocket launcher, grenade, grab gun, knife, machete |
| `extras.py` | axe, bat, crowbar, katana, chainsaw, sledgehammer, double-barrel, Uzi, minigun, crossbow, flamethrower |
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

**Downloaded models.** Six guns are not built here but taken from the public-domain (CC0)
[Free CC0 Guns & Explosives Pack](https://3dmodelscc0.itch.io/free-cc0-guns-explosives-pack) by 3dmodelscc0: Pistol (Makarov),
SMG (M3 Grease Gun), Shotgun, Rifle (AK-47), AR-15 (M4A1) and Sniper. `models/import_guns.py` turns each to the game's
convention, moves it so its trigger is where the built model's was (so the hands in `VIEW` still fit), shrinks the textures to
1024 px and writes `assets/weapons.glb` (3 MB). `models.js` loads that file after `models.glb`, and anything in it replaces the
built model of the same name; delete the file to go back to the built guns. The script prints each gun's muzzle and sight
height for `VIEW`. To swap in another model, add a line to `GUNS` in that script.

**Downloaded people.** NPCs wear rigged characters from [Mixamo](https://www.mixamo.com) (a construction worker, a man in a
hoodie and a soldier) instead of the built body. `models/import_characters.py` takes any Mixamo-rigged FBX, stands it in the
game's rest pose with its joints on the ragdoll's, cuts it into the eleven ragdoll pieces with a flesh cap on every cut, and
writes `assets/characters.glb` (7.5 MB):

    blender -b -P models/import_characters.py -- assets/characters.glb one.fbx two.fbx ...

Each NPC picks one at random; wounds, severing, gibs, burning and the zombie tint work on them as on the built body. They keep
their own clothes, so the random clothes colours and hats are not used. Delete the file to go back to the built body.
Mixamo characters are free to use in games, but Adobe's terms do not allow handing out the character files on their own.

## Tuning knobs

- Body part HP and layout: `PARTS` at the top of `ragdoll.js`. Joint limits: `JOINTS`. Landing damage: `IMPACT` and `impact()`. Crawl strength: `CRAWL_PULL`.
- How fast wounds bleed: the `this.bleed(...)` calls in `hit()` (drops per second, health per second) and the cap in `update()`.
- Blood look: drop sizes in `blood()`, decal shapes in `SHAPES`, decal budgets where `this.sets` is built (`gore.js`).
- Weapon damage, rate, impulse: `WEAPONS` at the top of `weapons.js`.
- Max NPCs: `MAX_RAGDOLLS` in `main.js`.
