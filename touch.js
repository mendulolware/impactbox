// Phones and tablets: on-screen controls that feed the same `input` the keyboard and mouse do.
//
//   left thumb   a stick wherever it lands on the left of the screen: walk, and push it all the way to sprint
//   right thumb  drag anywhere on the right to look; the fire button looks too while it is held
//   buttons      fire, aim, jump, reload, next weapon, use (shout / arrest / clear a jam), lean left and right (held),
//                and a row along the top that just presses a key: spawn menu, bodycam, night, flashlight, slow-mo,
//                kick, mirror, rain, suppressor, laser, squad, record
//   weapon bar   tap a group to pick it, tap it again for the next weapon in it
//   also         a buzz for each shot and each hit you take (where the phone can), the screen kept awake while
//                playing, and a notice to turn the phone sideways

export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

const LOOK = 2.2;      // look speed against the mouse's: a thumb covers far less ground

export function initTouch(ctx, input) {
  if (!isTouch) return;
  document.body.classList.add('touch');
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div id="stick"><i></i></div>
    <div class="row">
      <button data-key="Tab">&#9776;</button><button data-key="KeyV">CAM</button><button data-key="KeyN">NIGHT</button>
      <button data-key="KeyL">LIGHT</button><button data-key="KeyT">SLOW</button><button data-key="KeyH">KICK</button><button data-key="KeyM">MIRROR</button><button data-key="KeyO">RAIN</button>
      <button data-key="KeyJ">SUPP</button><button data-key="KeyK">LASER</button><button data-key="KeyU">SQUAD</button><button data-key="KeyP">REC</button><button data-key="KeyY">SHOP</button><button data-key="KeyZ">SPAWN</button><button data-key="KeyI">GOD</button>
    </div>
    <button class="b" id="t-fire">FIRE</button>
    <button class="b" id="t-aim">AIM</button>
    <button class="b" id="t-jump">JUMP</button>
    <button class="b" id="t-reload">R</button>
    <button class="b" id="t-swap">&#8635;</button>
    <button class="b" id="t-use">USE</button>
    <button class="b" id="t-leanL">&#8656;</button>
    <button class="b" id="t-leanR">&#8658;</button>`;
  document.body.appendChild(root);
  const $ = (id) => root.querySelector(id);
  const key = (code, type = 'keydown') => document.dispatchEvent(new KeyboardEvent(type, { code }));
  const tap = (el, fn) => el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });

  // ---- the top row: one key each
  for (const b of root.querySelectorAll('.row button')) tap(b, () => { key(b.dataset.key); key(b.dataset.key, 'keyup'); });

  // ---- buttons
  tap($('#t-reload'), () => ctx.weapons.reload());
  tap($('#t-swap'), () => { input.wheel += 1; });
  tap($('#t-use'), () => { key('KeyF'); key('KeyF', 'keyup'); });
  tap($('#t-aim'), () => { input.right = !input.right; if (input.right) input.rightDown = true; $('#t-aim').classList.toggle('on', input.right); });
  const hold = (el, on, off) => {
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); on(); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); off(); }, { passive: false });
    el.addEventListener('touchcancel', off);
  };
  hold($('#t-jump'), () => input.keys.add('Space'), () => input.keys.delete('Space'));
  hold($('#t-leanL'), () => input.keys.add('KeyQ'), () => input.keys.delete('KeyQ'));     // lean while held
  hold($('#t-leanR'), () => input.keys.add('KeyE'), () => input.keys.delete('KeyE'));
  hold($('#t-fire'), () => { input.left = true; input.leftDown = true; }, () => { input.left = false; });

  // ---- the stick and the look pad, by touch id
  const stick = $('#stick'), knob = stick.querySelector('i');
  let move = null;
  const looks = new Map();          // touch id -> last x, y
  const setMove = (dx, dy) => {
    const r = 60, l = Math.min(1, Math.hypot(dx, dy) / r), a = Math.atan2(dy, dx);
    const x = Math.cos(a) * l, y = Math.sin(a) * l;
    knob.style.transform = `translate(${x * r}px, ${y * r}px)`;
    for (const [k, on] of [['KeyW', y < -0.35], ['KeyS', y > 0.35], ['KeyA', x < -0.35], ['KeyD', x > 0.35], ['ShiftLeft', l > 0.95 && y < -0.6]]) {
      if (on) input.keys.add(k); else input.keys.delete(k);
    }
  };
  const lookStart = (t) => looks.set(t.identifier, [t.clientX, t.clientY]);
  $('#t-fire').addEventListener('touchstart', (e) => { for (const t of e.changedTouches) lookStart(t); });
  document.addEventListener('touchstart', (e) => {
    if (e.target.closest?.('#menu, #start, #settings, #shop, button')) return;
    e.preventDefault();             // no zoom, no scroll, and no pretend mouse click (which would fire)
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.4 && !move) {
        move = { id: t.identifier, x: t.clientX, y: t.clientY };
        stick.style.left = `${t.clientX}px`; stick.style.top = `${t.clientY}px`;
        stick.classList.add('on');
      } else lookStart(t);
    }
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (move && t.identifier === move.id) { setMove(t.clientX - move.x, t.clientY - move.y); continue; }
      const last = looks.get(t.identifier);
      if (!last) continue;
      const dx = (t.clientX - last[0]) * LOOK, dy = (t.clientY - last[1]) * LOOK;
      looks.set(t.identifier, [t.clientX, t.clientY]);
      ctx.player.look(dx, dy);
      input.mx += dx; input.my += dy;
    }
    if (!e.target.closest?.('#menu, #settings, #start, #shop')) e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (move && t.identifier === move.id) { move = null; setMove(0, 0); stick.classList.remove('on'); }
      looks.delete(t.identifier);
    }
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);

  // the weapon groups along the bottom
  document.getElementById('weapon-bar').addEventListener('touchstart', (e) => {
    const el = e.target.closest?.('.slot');
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    ctx.weapons.selectSlot([...el.parentNode.children].indexOf(el));
  }, { passive: false });

  ctx.buzz = (ms) => navigator.vibrate?.(Math.round(ms));

  // the spawn menu closes when you tap outside it
  document.getElementById('menu').addEventListener('click', (e) => { if (e.target.id === 'menu') { key('Tab'); key('Tab', 'keyup'); } });

  // full screen and sideways, once the player starts, and the screen stays on
  let lock = null;
  const awake = () => { if (!lock && !document.hidden) navigator.wakeLock?.request('screen').then((l) => { lock = l; l.onrelease = () => { lock = null; }; }).catch(() => {}); };
  document.getElementById('play').addEventListener('click', () => {
    document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    awake();
  });
  document.addEventListener('visibilitychange', awake);       // the lock goes when the tab is hidden
}
