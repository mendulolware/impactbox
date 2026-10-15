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
| F | open or close the door in front of you; get into (or out of) a car beside you; otherwise Ready or Not mode: shout for compliance, or arrest whoever has given up in front of you |
| in a car: W / S / A / D / Space | drive / brake and reverse / steer / handbrake (see Driving) |
| H / M | kick the door in front of you / look under it with the mirror (M again, or walk away, to stop) |
| U | the squad: go where you are pointing and hold that angle; U again (or getting 18 m away from them) calls them back |
| J / K | suppressor on the current gun (quieter: heard 9 m away instead of 40, no flash) / laser (a red dot where the barrel points, and the beam at night) |
| P | record a video of what you see and hear; P again saves it as a .webm (with the timestamp burned in) |
| Q / E | lean left / right (hold) |
| N / L / O | night on the current map / flashlight / rain |
| Tab | spawn menu |
| Middle click / Z | spawn another of the last thing you took from the spawn menu, where you are looking (SPAWN on a phone) |
| T | slow-mo |
| X | delete what you're aiming at (or holding) |
| C | clear everything |
| Backspace | suicide: with a gun in hand you put it to your head and fire (`selfShot` in `weapons.js`); otherwise the ordinary death. Then back at the start (also in the spawn menu, World) |

**Phones and tablets** (`touch.js`): a stick under your left thumb wherever it lands (push it all the way to sprint), drag on the right to look (the FIRE button looks too while held), buttons for fire, aim, jump, reload, next weapon, lean left and right (held) and use (shout, arrest, clear a jam), and a row along the top for the spawn menu, bodycam, night, flashlight, slow-mo, kick, mirror, rain, suppressor, laser, squad and record. Play goes full screen and sideways. Tap a weapon group on the bar at the bottom to pick it (again for the next one in it). Shots and hits you take buzz the phone where it can, the screen stays awake while you play, sound stops when you switch away, and a notice asks you to turn the phone sideways. Phones draw at up to 1.25x pixel ratio and lower it on their own when the frame rate drops under 42 (back up when it is over 56, never under 0.6x: `adaptResolution` in `main.js`), start on the Low graphics setting (no ambient occlusion, bloom or shadows) and skip screen multisampling, keep half as many people (18), meat chunks (60) and blood drops (1,600, with simpler spheres) and half the rain.

**Interface** (`style.css`, `index.html`): health bottom left as a number and a bar in ten segments, the weapon's name and rounds bottom right (amber when low, red when empty or jammed), the weapon groups along the bottom (lifted above health and ammo on narrow windows), a crosshair that opens up while you move, jump or fire (`--gap`, set every frame in `main.js`), a white X when a shot lands and a red one for a kill (`marker`), an arc round the crosshair toward whoever last hurt you (`#dmgdir`, from `player.hurtFrom`), and a kill feed down the right (`feed`). The start screen has map cards, option chips and every key; the spawn menu (Tab) lists the keys too. **Settings** (start screen, or the spawn menu): look sensitivity, field of view, volume, resolution, graphics (high: occlusion, glow and shadows; medium: shadows only; low: none of them, the default on phones), invert look, and the FPS counter; kept in the browser (`ctx.settings`, `applySettings` in `main.js`). Type is Barlow Condensed and Barlow from Google Fonts, falling back to system fonts offline.

## Layout

| File | What it does |
| --- | --- |
| `main.js` | renderer, game loop, input, spawn menu, map switching, explosions, hit routing |
| `maps.js` | the maps: what each is built from and what it starts with |
| `mission.js` | Ready or Not mode: suspects and civilians, shouting, arrests, rules of engagement, the grade |
| `ragdoll.js` | 11-body ragdoll under one skinned figure: procedural animation, active ragdoll, injuries that show (limp arms, limping, crawling, bleeding out), fall damage, severing, gibbing |
| `brain.js` | NPC AI: senses, civilian / thug / zombie behaviour, steering |
| `doors.js` | doors: hinged, kickable, lockable, shot through; `MapBuilder.door()` hangs one in a doorway |
| `weapons.js` | weapon definitions, firing, melee, grenades, grab gun, viewmodels |
| `props.js` | crates, barrels, cars, furniture, grenades, rockets and the rest of the spawn menu |
| `models.js` | loads `assets/models.glb`; lays surface detail and edge wear over the models; hands out body pieces |
| `detail.js` | fine tiling surfaces for the models (steel, plastic, wood grain, cloth, leather, skin), generated in code |
| `coop.js` | two-player co-op: the host's world is the real one; the guest keeps puppets of it and sends requests (see Co-op) |
| `net.js` | finding the other player by a four-letter code; a direct line (PeerJS, `vendor/peerjs.min.js`, MIT) or, where networks block that, a public MQTT relay |
| `survival.js` | Zombie Survival: waves, lives, the best wave |
| `tools.js` | the Rope Tool and the Weld Tool |
| `traps.js` | saw blade, spike trap, launch pad, crusher (the Grab Gun carries one and sets it down again where you let go) |
| `trailer.js` | the launch trailer: a scripted cinematic in the game itself, its music and sound made in code (see Launch trailer) |
| `trailer_render.py` | renders the trailer to `impactbox-trailer.mp4` with ffmpeg (not part of the game) |
| `drive.js` | driving cars: getting in and out, the handling, the view behind, running people over |
| `water.js` | water: floating, drag, splashes, rounds slowing down under it, swimming, the view under it |
| `gore.js` | blood droplets and mist, fire and smoke; decals that dry (splats, spatter, runs, pools, smears, handprints); physical chunks (meat, bone, skull, ribs, gut, eyes) that stick to walls and ceilings |
| `wounds.js` | holes and gashes cut into body parts, blood soaking and running from them, burns, what is visible inside, and the torn stumps |
| `player.js` | first-person character controller |
| `world.js` | sky with clouds, sun, fog and time of day; `MapBuilder`, which turns a map description into colliders and a few merged meshes |
| `textures.js` | asphalt, concrete, timber, brick and sheet metal generated in code, each with colour, normal and roughness maps |
| `post.js` | picture pipeline: ambient occlusion, bloom, colour grade |
| `audio.js` | every sound, made from noise and oscillators: layered gunshots, echo per map, voices, footsteps, ambience |
| `viewer.html` | a turntable for looking at any model under the game's own sky and lighting (not part of the game) |

## Maps

Pick one on the start screen or under **Maps** in the spawn menu (Tab). The last one played is remembered; `?map=street` in the address forces one.

| Map | What it is |
| --- | --- |
| The Yard | the original open concrete yard: ramp, platform, cover |
| Warehouse | a sheet-metal shed under an overcast sky: pallet racking, shipping containers, a mezzanine with stairs, a loading dock, hanging lamps |
| Rooftops | five roofs at sunset joined by planks, 18 to 22 m up. Falling off kills you (and anything else) |
| Night Street | a street at dusk: shopfronts, parked cars, a dead-end alley, street lamps |
| Kill House | a walled compound with twelve plywood rooms and a catwalk over them |
| The House | a two-storey house after dark: a hall with the stairs, living room, kitchen and den downstairs, a landing, three bedrooms and a bathroom upstairs, ten doors (three locked), windows you can see and shoot through, two lamps on and the rest dark. It is always night here (`night: true` turns the night sky and the flashlight on, and halves how far people see); made for the flashlight, the mirror and the bodycam |
| The Pool | an outdoor pool, 25 by 12 m and 2.6 m deep, with a diving board, changing rooms, bleachers and sun loungers. Bodies and props float, blood spreads in the water as clouds, and you can swim (see Water) |
| The Office | an open-plan office floor under an overcast sky: twelve pods of four desks with lit screens, three glass-fronted meeting rooms, the manager's office, a server room behind a locked door, a break room and a lobby with a reception desk. Glass all along the north and east sides (every pane breaks), nine office workers and three armed men, two cars out in the street |

A map is one entry in `MAPS` (`maps.js`): a time of day, a spawn point, the rectangle NPCs keep to, `build(b)` and `populate(ctx)`.
`build` gets a `MapBuilder` (`world.js`) with `box`, `cyl`, `wall` (with doorways), `door` (hung in one, `y0` for an upper floor), `stairs`, `stripe`, `light`, `water`, `ground` and `mat`.
Every box gets a collider on one fixed body, and the visible boxes are joined into one mesh per material, so a map of several hundred
pieces is a handful of draw calls. `loadMap()` removes the old map (meshes, materials, colliders) and builds the next.
Times of day are `SKIES` in `world.js`: sun direction and colour, sky colours, cloud cover, fog.
To add a map, add an entry to `MAPS`; both menus list it automatically.

## Launch trailer

**Watch it:** https://mendulolware.github.io/impactbox/?trailer (click to start: browsers only play sound after a click).

`trailer.js` is a 45-second trailer filmed by the game itself: fifteen shots and cards (the street at dusk, the office, the pool, a leg shot
and a knee, a shotgun in slow motion into a stack of crates, a round through meeting-room glass, a car through a pedestrian, two bodies into
the deep end, a fall from a roof, a zombie horde, a ring of explosive barrels, the logo). Each shot is a map, a setup (who and what is
where), scripted events at set seconds (rounds fired with `fire()`, a car driven, a blast), a camera move and the words over it. Everything
in the picture is the real engine: real ragdolls, wounds, blood, water and physics, so no two playbacks are quite the same. The game steps
one tick at a time under the trailer's control (`ctx.frozen`, `debugStep`) and the trailer draws its own frames from its own camera
(`debugView`); the player waits out of every shot, high above the map, so nobody reacts to them. The music and the sound effects are
synthesised in `score()` (Web Audio: a drone, a pulse, a riser, trailer "braams", gunshots, glass, splashes, blasts) from the same cue list
as the pictures, so they land on the cuts and the hits.

**Render it to a video:** run `python serve.py` and `python trailer_render.py`, then open `http://localhost:8123/?trailer=render`. The page
renders the soundtrack offline, then every frame at 1920x1080, 30 fps, and posts them to `trailer_render.py`, which has ffmpeg make
`impactbox-trailer.mp4` (H.264, AAC, loudness normalised to -14 LUFS). About two minutes.

## Driving

Any car (the ones parked on most maps, or one from the spawn menu) can be driven: walk up to it and press F (the USE button on a phone), F again to get out of the driver's door (or the other side, or behind, wherever there is room). `drive.js`:

- **handling** is arcade, set on the body directly before each physics step: 0 to 40 km/h in about 2 s, 86 km/h flat out, 32 in reverse; S brakes first and then reverses; steering is sharpest at low speed and softens as it goes faster; the tyres hold the car sideways, and the handbrake lets go of that so the back steps out. Off the ground (a ramp, a drop) it just flies. The car is a box, not four wheels, so its friction is off while it is driven and the grip is done in code
- **it stays a prop**: it can be shot, set alight and blown up like any car (you are put out first, then it goes off), and only its tilt is locked while someone is in it. Getting in sets it back on its wheels if it was over
- **people in its path** are knocked down just before the bumper reaches them (`Ragdoll.knockBy`, the same knock a thrown crate does), harder the faster it goes, so it goes through them instead of stopping dead against an NPC on its feet (which is kinematic: infinitely heavy to the physics)
- **the view** sits behind and above and swings round after the car, pulled in short of walls; the engine is a sawtooth through a filter that rises with speed (`engine` in `audio.js`). Your own collider is off while you drive, so rounds aimed at you hit the car
- **co-op**: only the host drives for now (the guest gets a message); the guest sees the car move like any other prop

## Water

`b.water(x0, x1, z0, z1, y)` in a map's `build` fills that rectangle with water up to height `y` (the basin itself is ordinary boxes). `water.js` then, every frame before the physics step:

- **floats things**: each dynamic body in it is pushed up by how far under it is, and slowed (water drag, on spin too). How strongly is per kind: a body floats just under the surface, balls and crates ride high, barrels half in, grenades and magazines sink, meat chunks sink slowly (`FLOAT` at the bottom of `water.js`)
- **splashes**: anything going in faster than 2.5 m/s throws white water (more for heavier and faster) with one splash sound however many parts went in; every round that crosses the surface splashes too
- **slows rounds**: a round keeps `exp(-metres under water / 1.2)` of its force, so a body 1.5 m down takes under a third of the damage
- **clouds blood**: a drop of blood that reaches the water becomes a slow red cloud that spreads and fades over 5-9 s instead of a splat
- **swimming** (`player.js`): half speed, you float up to just under your chin, swimming forward while looking down takes you down, Space strokes up, and at the surface Space hauls you out over the edge. With the camera under, the picture goes blue and the fog closes in

## Doors

The kill house has a door in every doorway (17; the wide opening in the middle wall stays open) and the warehouse has
an office in its front left corner with two. A door (`doors.js`) is a slab on a hinge: **F** swings it open away from
you, slowly, and closes it again; **H** kicks it open fast, and anyone standing behind it goes down. Five kill-house
doors and the office's side door are locked (`locked` in the map): a locked door takes three kicks, a blast within
range, or a round of 20+ damage within 22 cm of the handle. Rounds go through a door like any thin wall (it is 4.5 cm
thick; every gun's `pen` beats that, at 60% damage). **M** is the mirror: your eye goes to the floor on the far side
of the door in front of you, so you can see what is waiting in the room.

NPCs feel doors with the same rays they feel walls with (`feel()` in `brain.js` now says what it hit): anyone walking
up to an unlocked door opens it; thugs, armed suspects and zombies stand at a locked one and kick it until it gives;
civilians treat a locked door as a wall. A closed door blocks sight (lines of sight only look at fixed bodies, which
is why the door's body is fixed and moved by hand, not kinematic).

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

**Less-lethal.** The taser, the beanbag gun, pepper spray and flashbangs *daze* people instead of killing them (`daze`
in `WEAPONS`; it sets the same `brain.flashed` timer a flashbang does): a dazed person doubles over, does not fight or
shoot, gives up far more easily when shouted at, and can be cuffed on the spot. In Ready or Not mode a suspect
neutralised now costs 10 (it was 5), so the top grade means nobody died; shooting a dazed suspect counts as
unauthorized force, and arresting one taken down less-lethally is listed in the debrief.

**Hostage-takers.** When a mission starts, one armed suspect with a civilian within 5 m grabs them as a shield
(`hostage` / `heldBy`): the civilian is held in front on his left arm with their hands up, the pistol rests over their
right shoulder, he warns you off and fires the odd shot if you come within 9 m. He gives up when shouted at only half as
readily as the others. Anything that stops him frees the hostage: a kill, a taser, a bag, the spray, a flashbang, or
cuffs after he surrenders (`freed()` in `mission.js` logs a rescue or a release). Wounding him without stopping him is a
coin toss on the hostage's life: half the time he fires into them (-40, "Hostage killed"). The head showing over the
hostage's shoulder is the shot to make.

**Your squad.** A mission starts with two officers at your back (`kind: 'swat'`, the soldier model with his armour,
rifles; `swat()` in `brain.js`). They follow in formation, one each side behind you, the second facing back the way
you came. Stand at a closed door and they stack up beside it, one each side, facing it; open or kick it and they go
through to the far corners of the room. **U** sends them to where you are pointing to hold that angle, U again brings
them back. They shoot any armed suspect still fighting, any thug on the attack and any zombie they can see, but hold
their fire on a hostage-taker: that shot is yours. Suspects shoot back at whichever of you is nearer. An officer killed
costs 20. The spawn menu has them too (**SWAT Officer**), for the sandbox.

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
- **Recorded motion** (`assets/walk.json`, `run.json`, `die.json`, `reload.json`, made from Mixamo clips by `models/import_anim.py`; `once` for clips that do not loop): walking and running blend from the worked-out stride to motion capture; someone too hurt to stay up plays a stagger-and-fall until their hips are on the way down, then the ragdoll takes over (a hit cuts it short); armed suspects carry 8 rounds and play a reload when they run dry, which is your moment.

- **Gun handling:** magazine guns keep a round in the chamber through a reload (30+1), and a reload from empty takes 30% longer because the bolt has to go forward; shots spread more on the move and a lot more in the air; sprinting carries the weapon low and it cannot fire until it is back up; aimed weapons drift with your breathing (the sniper most), Shift while aiming holds your breath for about four seconds, and running out leaves you shakier until it comes back; spent cases fly out to the right. Hits no longer play the flesh squish.

- **Recoil and muzzle fire:** `RECOIL` is 3.4 (it was 1.6), so bursts climb hard and have to be dragged down, and the gun itself kicks 30% further. Every unsuppressed shot (yours and the suspects') throws a muzzle flash: two crossed flame tongues along the barrel and a star facing the camera, brighter than white so the bloom catches them, plus a moment of orange light (`muzzleFlash()`, `fireFlash()` in `weapons.js`). Yours stays on the muzzle while the gun kicks up.

- **Feel pass:** reloading a magazine gun, the off hand drops out of the picture, comes back up with a fresh magazine
  (a box: the downloaded guns have no loose parts) and seats it before taking hold again (`userData.off` / `mag` on each
  viewmodel, driven by the reload's progress in `placeRig`); the magazine on the floor is dark with brass showing at the
  top. Every map collider remembers what it is made of (`ctx.surfaces`, set by `MapBuilder`): your footsteps go hollow
  and low on boards and ring on sheet metal, and a round into wood thuds and throws splinters, into steel rings, into
  concrete cracks and sparks (`step()` and `impact()` in `audio.js`).

- **Rain (O, or the start-screen button):** grey streaks falling around you under open sky (`gore.rain`, 2,600 of
  them, no collisions; none are made while something is overhead, so rooms stay dry), the ground dark and shiny
  (`MapBuilder.wet()`), the sky overcast unless it is night, clear drops on the lens, and the sound of it over the map's
  own (`setRain()` in `audio.js`). **Glass** (`MapBuilder.pane()`): the house's windows and the street's shopfronts
  are their own meshes with colliders. A round, a blade or a blast within range shatters one (shards, a crash, a few
  tinkles) and rounds carry on through it; until it breaks it blocks sight like any wall. **Lamps** (`MapBuilder.light()`)
  come from a bulb with a collider: shoot it, or set something off near it, and the light goes out.

## First person

- **Hands:** gloved hands with sleeves are attached per weapon: `HandR` grips, `HandL` cups a fore-end, `HandSupport` closes over the
  gripping hand for a two-handed pistol hold, and `KnifeHand` holds the knife, with a sleeve running back out of view.
  They all come from one hand builder (`models/hands.py`) that is given finger joint angles. Placements live in the `VIEW` table in `weapons.js`.
- **Aiming:** right mouse moves the weapon so its sight line (`sight` in `VIEW`) sits on the screen centre, narrows the field of view, tightens spread and slows you down. Guns have real rear notches and front posts.
- **Bodycam (V):** the full screen, no black bars; auto exposure that takes a moment to adjust between shade and sun, and gains up in the dark (a 1x1 log-average pass in `post.js`, `uKey` = what a sunny yard averages); a fast turn leans the picture (rolling shutter) and breaks it into 8x8 compression blocks; smooth gradients band. The picture goes through a small camera: a slow shutter that smears it while you turn, sharpening halos on hard edges, crushed shadows, highlights that clip to white, a faint green cast and grain that gets heavier in the dark (all in the last pass of `post.js`); sound goes through its microphone, thin and clipping on anything loud (`bodycam()` in `audio.js`); a UTC timestamp and a camera ID in the corner. Also: wide field of view through a bent lens (fisheye, colour fringes toward the edges, corner darkening: the last pass in `post.js`), no HUD at all (no crosshair, ammo, health or weapon bar), the nearest eight visible faces blocked out in pixels like released footage (`blockFaces()` in `main.js` hands their screen positions to the shader), a camera that lags slightly behind your aim, heavier head bob and a REC overlay. Aiming in this view shoulders the weapon below the camera instead of putting the sights on screen, as in real helmet footage; shots leave from eye level along the weapon.

## Graphics

**No stall on the first hit.** What a wound needs on the GPU (the cut skin, the meat under it, what is inside, the cut faces, a burnt
stump, and the shadow versions of all of them) used to be built at the moment of the first hit on each look of person, a visible stall
(longer on a phone, and on both screens in co-op). `prewarm()` in `main.js` now builds it all while the start screen is up: each look is
spawned 20 m under the player (out of sight, but inside the sun's shadow camera), opened up once, compiled for post.js's target with
`compileAsync` and drawn once, then taken away. A first hit went from 47-107 ms to about 12.

**Grenade Launcher** (heavy weapons): six grenades lobbed in an arc that go off on whatever they land on (a grenade launched as a
rocket that falls: `launch` in `props.js`). Any grenade, thrown or launched, also goes off when a round hits it (and sets off the
next), once.

Nothing is loaded from image files. `textures.js` bakes tileable surface materials at startup, `world.js` draws the sky in a shader and bakes
it into the environment map that lights everything, and `post.js` renders the scene to an HDR image and applies ambient occlusion
(soft shadow in creases and where things touch), bloom (glow from the sun, fire and muzzle flashes) and a colour grade. Press G to switch
the pipeline off.

## Weapons

Stats live in `WEAPONS` and first-person placement in `VIEW`, both at the top of `weapons.js`. There are 23, in eight groups:

| Key | Group | Weapons |
| --- | --- | --- |
| 1 | Sidearms | Pistol, Revolver, Taser (7 m, one cartridge: 5 s on the floor locked up, 6 s dazed after) |
| 2 | SMGs | SMG, Uzi |
| 3 | Shotguns | Shotgun, Double Barrel, Beanbag (a bag, not a shot: a bruise, knocked flat, 3 s dazed; stops at the first thing it hits) |
| 4 | Rifles | Rifle, AR-15, Sniper, Crossbow |
| 5 | Heavy | Rocket, Grenade Launcher, Minigun, Flamethrower |
| 6 | Blades | Knife, Machete, Katana, Laser Sword, Axe, Chainsaw |
| 7 | Blunt | Bat, Crowbar, Sledgehammer |
| 8 | Gear | Pepper Spray (a 3 m cone: anyone in it is 3.5 s dazed, a can lasts 8 s), Grenade, Flashbang (1.5 s fuse: whites out your screen if you look at it and rings your ears; anyone within 13 m who can see it doubles over for 2 to 6 s, stops fighting, gives up far more easily when shouted at, and can be cuffed), Grab Gun, Rope Tool and Weld Tool (below), Drone (flies where you look from its own camera, Shift = fast, click or a crash sets it off; it is a slow steered rocket, `flyDrone()` in `main.js`) |

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
- **Laser Sword**: a metre of red light (built in `laserSword()`, brighter than white so the bloom takes it, and lighting what is near) that
  hums while it is out (`hum` in `audio.js`). One swing sweeps an arc of seven rays and cuts through every body part it meets on the
  first touch, through several people at once (`opts.laser` in `Ragdoll.hit`). The cut is burnt shut: no spray, no bleeding, charred
  ends (`sever(..., sealed)`, the stump in `charMat`), so someone who loses only an arm or a leg lives. In the Zombie Survival shop for 600.
- **Where a blade cuts** (every blade, the saw blade trap too): at whichever joint of the part it lands on is nearest the blow (`cutAt` in
  `ragdoll.js`). A thigh hit by the knee loses the shin, by the hip the whole leg; an upper arm hit by the elbow loses the forearm; the
  side of the chest by a shoulder takes the arm, its top the head, its bottom cuts the body in half; and the pelvis, which nothing
  could cut before, loses a leg at the hip or the body above it at the waist.
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

## Hit reactions and deaths

Where a round lands decides how someone still on their feet takes it (`react` in `ragdoll.js`, posed in `computePose`): a leg hit often puts them down on that knee with a hand on it, then up again limping (instead of always falling); an arm or a shoulder spins them round with the arm thrown back; the belly (pelvis, or the lower half of the torso) folds them over it with both hands on it; the chest is the old flinch. Deaths vary too (`die`): on their feet, about a third stagger a few steps and fall (the recorded Walking To Dying clip; the dead stop thinking), some go over backwards still half rigid, and the rest drop where they stand. Head shots, gibs and the like are always a drop.

## Zombie Survival

Start screen or spawn menu (Modes). The map is reset and emptied of people, then waves of zombies come: wave n sends 4 + 3n, never more than 14 on their feet at once (8 when a phone is hosting), each from somewhere out of sight 12-26 m from the nearest player and on the players' own floor (not a roof or a wall top). Clear a wave and the next comes 6 s later. Three lives, shared in co-op: every death costs one, and when they are gone you are overrun (Enter goes again). The best wave reached is kept in the browser. The panel top right shows the wave, what is left, the lives, the points and the best (`survival.js`).

- **Points and the shop.** 10 points a zombie, 15 for a head shot, shared by the team. You start with a pistol and a knife; the shop (Y, or SHOP on a phone, any time) sells the rest (katana, shotgun, SMG, double barrel, grenades, AR-15, sniper, chainsaw, flamethrower, rocket launcher, minigun), a medkit (full health) and a barricade (six crates across your path). Weapons are the team's: in co-op both players get them (`weapons.allowed`; the guest's purchases are asked of the host).
- **Special zombies.** From wave 3 a quarter are runners (more than twice the speed); every fifth wave brings brutes, the armoured soldier as a zombie: pistol rounds stop in the vest and everything else does a third of the damage (`tough`).

## Co-op (two players)

On the start screen, one player presses **Host a game** and gets a four-letter code; the other types it in and presses **Join**, and both press Play. It works over the internet with no server of ours: PeerJS's free public broker introduces the two browsers and they try to talk directly (WebRTC). Many networks will not allow that (phones on mobile data, some routers even between two devices on the same wifi), and the free WebRTC relays have all gone, so if the direct line has not opened in 6 seconds both games talk through a free public MQTT message server instead (HiveMQ's, or EMQX's if that is down: a WebSocket, a topic per direction named after the code; `Mqtt` in `net.js` is just enough of the protocol). The badge says RELAY when it is in use; it adds a little delay. Through the relay, a player who goes quiet for 10 seconds has left (each side pings every 2). `?relay` in the address skips the direct try, for testing the relay. `vendor/peerjs.min.js` (MIT) loads only when someone hosts or joins.

- **The host's game is the real one.** It runs every NPC, prop, trap and all the physics. The guest's game builds the same map and keeps a **puppet** of everything in it: kinematic bodies that go where the host's stream says (20 times a second, on an unreliable channel, eased between packets) and decide nothing.
- **What the guest does goes to the host as a request**: hits (the guest aims and shoots at its puppets; the host applies the hit to the real body), grenades, rockets and dropped magazines (the host makes the real ones), doors, spawn-menu clicks (run in the host's game from where the guest is looking), ropes and welds, shouting and arresting in Ready or Not, map changes.
- **What happened comes back as events** on a reliable channel: every blood and gore call the host makes (replayed, so the guest's blood lands where the host's does), every sound, wounds and burns (`woundHooks` in `wounds.js`), bodies split, cut and blown apart, glass, lamps, the kill feed, messages, and being hurt, blasted or flashed. A roster (who and what exists, map, night, rain, ropes, the mission panel) goes out every two seconds and on every change, which is also how someone joining late catches up.
- **NPCs go for whichever player is nearest** (`Brain.nearest`, `ctx.remotes`); traps hurt and launch either player. Each player sees the other as a soldier with a rifle (an avatar: a ragdoll walked by the other's position and aim) with a P1 (host) or P2 tag over their head, seen through walls. The avatar's colliders are sensors: rays still hit it (shooting each other does half damage) but you walk through it, since you both start a map on the same spot (the guest steps 1.4 m aside when there is floor there). The kill feed says whose kill it was (the last of you to hit it in the last 2.5 s) and the badge keeps the score.
- Sounds fade with distance: the host marks where each one comes from (`ctx.soundAt`, set by gunfire, impacts, explosions, flashbangs, falling bodies, doors, glass, lamps and traps; anything unmarked is where the host stands) and the other player hears it at 1 / (1 + d²/400) of its level (half at 20 m, never under 6%: `farAway` in `audio.js`).
- Not in co-op: the drone and the Grab Gun are the host's only; an NPC the guest saw get hurt before joining shows no wounds.

## Ropes, welds and traps

- **Rope Tool / Weld Tool** (Gear group, `tools.js`): click one thing, then another. A rope ties them at the length they are apart (a Rapier rope joint), a weld holds them exactly as they sit now (a fixed joint). Either end can be the world: a wall, the floor, a beam. A person you tie goes limp for a moment so the rope can take them. Right-click removes the links on what you point at (on the map itself, only those tied within 0.6 m of where you point), or the newest one. Up to 40; a link lets go by itself when either end is gibbed, deleted or the map changes (Rapier drops the joint with the body, so the link checks both ends every frame first).
- **Traps** (spawn menu, Traps, `traps.js`), placed where you look and facing the way you look: a **Saw Blade** spinning on a post (a kinematic disc: it gashes and severs what reaches its edge and throws it), a **Spike Trap** (step on the plate and a moment later 36 spikes come up through it and run through everything on it), a **Launch Pad** (throws people, props and you up and forward) and a **Crusher** (a block that waits, slams down between two posts and gibs whatever is under it, then winds back up). They work out who they hurt from where body parts are, between physics steps, never from inside one. X deletes one.

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
limb bones) as one mesh per body part (on the downloaded people, arms and legs show meat and no bone: their limbs do not line up exactly
with the physics capsules, and a bone rod there stood out beside the arm). Bullets cut a small entry hole (half the weapon's `hole`) and a
torn, wider exit (nine tenths of it); hits near an existing hole widen it. A part holds up to 12 wounds.
Soaked cloth and skin go near black-red, as blood in cloth does; pools are deep dark red, splats a little brighter.

**What a round does** (the realism pass, `hit()` in `ragdoll.js`): rounds **break** arms and legs (the arm hangs, the leg gives) and do not
take them off; that takes a blade, a blast, or a hit of 90 or more (the sniper). A head only comes apart from a hit of 120 or more (the
sniper again, or a blast); any other killing head shot takes some of the back of the skull out with it, once. The torso only opens and
spills from a hit of 60 or more, or once it has taken one and a half times its health in rounds. The exit spray goes by the round's damage
(about one drop per 6 points: a pistol round 6, a shotgun pellet or an SMG round 2 or 3, the sniper 14), drops are finer, the finest leave
no mark, and only the odd shotgun pellet throws spatter onto the wall behind, so a body is marked mostly by its wounds and the pool that
spreads under it rather than by blood thrown metres round it.

**How a hit feels:** every round into a person is heard (`sfx.flesh`: a wet slap and a thump, with the crack of bone for a head) and
seen from where you stand (a short, bright puff of blood mist thrown back out of the entry toward the shooter, `mist(..., puff)`, bigger
for a head). A round through a big artery (the thigh, the upper arm, the neck; 40%) spurts in time with the heart for several seconds and
empties them in about a minute (`bleeders`, the same spray as a stump). A hit within 2.4 m of the camera puts blood on the lens again. And
your own kills hold the world almost still for a moment, 0.055 s, or 0.09 s for a head shot (`ctx.hitstop` in `main.js`; not in co-op,
where the world is the other player's too).

`makeStump()` builds the torn end left where a limb comes off: a mound of muscle ringed with fat, snapped bone standing out of it (two for a forearm
or shin, spine and windpipe for a neck), ragged skin round the edge, and gut hanging out of a body cut in half. `ragdoll.js` adds the pulsing arterial spray.
Explosions burn and pepper bodies rather than launching them out of the arena, and only destroy the parts that were right on top of the blast.

- **Third gore pass:**
  - **Pieces stick.** Meat, skull and bone that slap into a wall or a ceiling at speed stay there (`_stick` in `gore.js`): on a wall a piece slides down the bottom of its own streak (`run` hands back the streak, `_slide` follows it), on a ceiling it hangs for a moment; both drip, then let go and fall. Doors, glass and lamps are left out because they move or break.
  - **Ceilings drip.** Blood that lands on a ceiling comes back down a drop at a time for a while, slower as it runs dry (`dripFrom`), and so does anything stuck up there.
  - **Blood dries.** Every mark records when it was made (`aBirth` on each decal set) and its shader (`dries`) turns it from wet red to dull brown-black and matte over about two minutes of game time.
  - **Head shots carry matter.** A killing head shot throws the back of the skull hard enough to reach the wall behind, and leaves pink-grey brain matter in the spatter (`wallSplatter(..., matter)`). A bigger round throws it further (scaled by `hole`). Gibbing paints the walls all round.
  - **Handprints.** A bleeding person walking past a wall puts a hand on it now and then: a red print at hand height, sometimes with a run under it (`handprint`, a sixth decal shape). Up to six each.
  - **Smears and splashes.** A piece sliding or rolling over the floor smears it; one landing in a pool splashes.
- **Second gore pass:** blood from a hit within 2.4 m lands on the lens and runs down it (`lens()` in `gore.js`, the `#lens` overlay); anyone who walks through a pool, you included, prints the next nine steps (`wetAt`, `footprint`); a killing head shot takes skull and brain out the back; a torso hit hard enough opens up and spills (`gutted`, see What a round does); pieces of meat now lie for a minute or two instead of twenty seconds.

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

**Downloaded people.** NPCs wear rigged characters from [Mixamo](https://www.mixamo.com) (six of them) instead of the built body. `models/import_characters.py` takes any Mixamo-rigged FBX, stands it in the
game's rest pose with its joints on the ragdoll's, cuts it into the eleven ragdoll pieces with a flesh cap on every cut, and
writes `assets/characters.glb` (13 MB, textures at 768 px):

    blender -b -P models/import_characters.py -- assets/characters.glb one.fbx two.fbx ...

Each NPC picks one at random; wounds, severing, gibs, burning and the zombie tint work on them as on the built body. They keep
their own clothes, so the random clothes colours and hats are not used. Delete the file to go back to the built body.
Mixamo characters are free to use in games, but Adobe's terms do not allow handing out the character files on their own.

## Tuning knobs

- Body part HP and layout: `PARTS` at the top of `ragdoll.js`. Joint limits: `JOINTS`. Landing damage: `IMPACT` and `impact()`. Crawl strength: `CRAWL_PULL`.
- How fast wounds bleed: the `this.bleed(...)` calls in `hit()` (drops per second, health per second) and the cap in `update()`.
- Blood look: drop sizes in `blood()`, decal shapes in `SHAPES`, decal budgets where `this.sets` is built (`gore.js`).
- Weapon damage, rate, impulse: `WEAPONS` at the top of `weapons.js`.
- How hard a hit moves a body that is already down: in `Ragdoll.hit`, a round carries `impulse * 0.07` (a few times a real bullet's momentum), a swing `impulse * 0.3`; the part hit jumps at most 3 m/s and the rest goes into the torso. `Ragdoll.calm` keeps any limb within 12 m/s of the body's middle (a limb clipping a wall when the body goes limp is otherwise shoved out hard enough to fly), and `clearSpot` in `main.js` backs a spawn out of walls.
- Max NPCs: `MAX_RAGDOLLS` in `main.js`.
