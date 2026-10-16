// Two players over the internet, with no server of our own.
//
// Games are open lobbies: a host's game is listed for everyone on the start screen, and anyone can join it from
// there. The listing is a retained message on the relay servers below (LOBBY + the game's four letters, which are
// only ever used to find each other, never shown), sent again every 10 s while the game has room, taken back when
// someone joins or the host leaves, and cleared by the server by itself if the host drops without a word (the
// connection's last will). Two ways to reach each other:
//   direct  PeerJS's free public broker (0.peerjs.com) introduces the two browsers and they talk straight to
//           each other (WebRTC). Fastest, but many networks will not allow it (phones on mobile data, some home
//           routers even between two devices on the same wifi), and there is no free relay left for WebRTC.
//   relay   if the direct line has not opened in a few seconds, both sides talk through a free public MQTT
//           message server instead (a WebSocket, so it works on any network that can browse), a topic per
//           direction named after the code. A little slower, works everywhere.
// vendor/peerjs.min.js is loaded the first time someone hosts or joins, so a solo game never touches the network.
//
// Two kinds of traffic: messages (reliable, in order, JSON) and the stream (raw bytes, where a late packet is
// worth nothing; unreliable when direct, in order through the relay).

const PREFIX = 'impactbox-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // (no I or O: they read as 1 and 0)
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
const DIRECT_WAIT = 6000;                       // ms to wait for the direct line before going through the relay
const SILENCE = 10000;                          // ms without a word from the other side: they are gone
const MSG = 0, STATE = 1, HELLO = 2, BYE = 3, PING = 4;   // relay packet kinds (the first byte)
const LOBBY = 'impactbox/v1/lobby/';            // + the code: an open game, { map, opts, t }; empty when it is not open
const BEAT = 10000, STALE = 25000;               // ms between a host's announcements, and after which a listing has gone

let loading = null;
function loadPeer() {
  loading ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/peerjs.min.js';
    s.onload = () => res(window.Peer);
    s.onerror = () => { loading = null; rej(new Error('could not load the network library')); };
    document.head.appendChild(s);
  });
  return loading;
}

const newCode = () => Array.from({ length: 4 }, () => LETTERS[(Math.random() * LETTERS.length) | 0]).join('');
const enc = new TextEncoder(), dec = new TextDecoder();
const topic = (code, dir) => `impactbox/v1/${code}/${dir}`;

// ------------------------------------------------------------------ just enough MQTT 3.1.1 over a WebSocket
const mqStr = (s) => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
const mqLen = (n) => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
function mqPacket(type, head, body = null) {
  const n = head.length + (body ? body.length : 0), lenB = mqLen(n);
  const out = new Uint8Array(1 + lenB.length + n);
  out[0] = type; out.set(lenB, 1); out.set(head, 1 + lenB.length);
  if (body) out.set(body, 1 + lenB.length + head.length);
  return out;
}

/**
 * connect(), subscribe(topic), publish(topic, bytes, retain), onmessage(topic, bytes, retained): QoS 0 only, and a
 * keep-alive. will: a topic whose retained message the server clears if this connection drops without a goodbye.
 */
class Mqtt {
  constructor(url, will = null) { this.url = url; this.will = will; this.buf = new Uint8Array(0); this.onmessage = null; this.onclose = null; }

  connect() {
    return new Promise((res, rej) => {
      const ws = this.ws = new WebSocket(this.url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => { ws.close(); rej(new Error('relay timeout')); }, 7000);
      ws.onerror = () => { clearTimeout(timer); rej(new Error('relay unreachable')); };
      ws.onclose = () => { clearInterval(this.ping); this.onclose?.(); };
      const w = this.will;     // (flags: a clean session, plus a retained will with an empty message)
      ws.onopen = () => ws.send(mqPacket(0x10, [...mqStr('MQTT'), 4, w ? 0x26 : 2, 0, 60, ...mqStr('ibx' + Math.random().toString(36).slice(2, 12)), ...(w ? [...mqStr(w), 0, 0] : [])]));
      ws.onmessage = (e) => {
        // packets can arrive split across or packed into WebSocket messages: read from a running buffer
        const add = new Uint8Array(e.data), b = new Uint8Array(this.buf.length + add.length);
        b.set(this.buf); b.set(add, this.buf.length);
        let o = 0;
        for (;;) {
          if (b.length - o < 2) break;
          let n = 0, m = 1, i = o + 1, d;
          do { if (i >= b.length) { n = -1; break; } d = b[i++]; n += (d & 127) * m; m *= 128; } while (d & 128);
          if (n < 0 || i + n > b.length) break;
          const type = b[o] & 0xf0, body = b.subarray(i, i + n);
          if (type === 0x20) { clearTimeout(timer); this.ping = setInterval(() => this.raw(new Uint8Array([0xc0, 0])), 30000); res(); }
          else if (type === 0x30) {
            const tl = (body[0] << 8) | body[1], skip = 2 + tl + ((b[o] & 6) ? 2 : 0);
            this.onmessage?.(dec.decode(body.subarray(2, 2 + tl)), body.slice(skip), (b[o] & 1) === 1);
          }
          o = i + n;
        }
        this.buf = b.slice(o);
      };
    });
  }

  raw(bytes) { if (this.ws?.readyState === 1) this.ws.send(bytes); }
  subscribe(t) { this.raw(mqPacket(0x82, [0, 1, ...mqStr(t), 0])); }
  publish(t, bytes, retain = false) { this.raw(mqPacket(retain ? 0x31 : 0x30, mqStr(t), bytes)); }
  close() { clearInterval(this.ping); try { this.ws?.close(); } catch (e) { /* already gone */ } }
}

/** A relay packet: one byte saying what it is, then the bytes. */
function relayPacket(kind, bytes) {
  const out = new Uint8Array(1 + (bytes ? bytes.byteLength : 0));
  out[0] = kind;
  if (bytes) out.set(new Uint8Array(bytes), 1);
  return out;
}

/**
 * A link to the other player. on: { message(data), state(bytes), open(), close(), error(text), via(mode) }.
 * send(data) is reliable and in order; stream(bytes) is for the constant position updates.
 */
export class Link {
  constructor(on) {
    this.on = on;
    this.mode = null;          // 'direct' | 'relay', once the other player is there
    this.r = null; this.u = null;
    this.peer = null;
    this.relay = null;         // the MQTT connection the other player came in on
    this.relays = [];
    this.code = '';
    this.closed = false;
    this.heard = 0;
    addEventListener('pagehide', () => this.close());
  }

  get open() { return this.mode === 'direct' ? !!this.r?.open : this.mode === 'relay'; }

  send(data) {
    if (this.mode === 'direct') { if (this.r?.open) this.r.send(data); }
    else if (this.mode === 'relay') this.relay.publish(this.out, relayPacket(MSG, enc.encode(JSON.stringify(data))));
  }

  stream(bytes) {
    if (this.mode === 'direct') { if (this.u?.open) this.u.send(bytes); }
    else if (this.mode === 'relay') this.relay.publish(this.out, relayPacket(STATE, bytes));
  }

  /** The other player is here, by one route or the other. */
  opened(mode) {
    if (this.mode) return;
    this.mode = mode;
    this.heard = performance.now();
    // nothing says when they go if their tab or their connection just dies (through the relay, and directly too: WebRTC
    // can report the line failed while the channel still says it is open, for good), so a silence that long means they
    // have (and a ping every 2 s, which a tab in the background still sends, so switching away for a moment is not leaving)
    this.watch = setInterval(() => { if (performance.now() - this.heard > SILENCE) this.lost(); }, 1000);
    this.keep = setInterval(() => {
      if (this.mode === 'direct') { if (this.r?.open) this.r.send('ping'); } else this.relay?.publish(this.out, relayPacket(PING));
    }, 2000);
    if (this.info) this.list(false);                        // (host) full: off the list
    this.on.via?.(mode);
    this.on.open?.();
  }

  /** Host: put the game on the list of open ones (again every 10 s, and after every reconnect), or take it off. */
  list(open, only = null) {
    this.listed = open;
    const bytes = open ? enc.encode(JSON.stringify({ ...this.info(), t: Date.now() })) : new Uint8Array(0);
    for (const mq of only ? [only] : this.relays) mq.publish(LOBBY + this.code, bytes, true);
  }

  lost() {
    if (!this.mode || this.closed) return;
    clearInterval(this.watch);
    clearInterval(this.keep);
    this.mode = null;
    this.r = this.u = null;
    if (this.info) this.list(true);                         // (host) room again
    this.on.close?.();
  }

  /** A packet from the relay. */
  fromRelay(mq, bytes) {
    if (this.closed) return;
    const kind = bytes[0], body = bytes.subarray(1);
    if (kind === HELLO) {                                   // (host) a player coming in through the relay
      if (this.mode) return;                               // one other player at a time
      this.relay = mq;
      this.opened('relay');
      return;
    }
    if (mq !== this.relay) return;
    this.heard = performance.now();
    if (kind === MSG) this.on.message?.(JSON.parse(dec.decode(body)));
    else if (kind === STATE) this.on.state?.(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    else if (kind === BYE) this.lost();
  }

  /** A direct data connection (either end). */
  attach(conn) {
    conn.on('open', () => {
      if (this.mode === 'relay' || (conn.label === 'r' && this.mode === 'direct')) { conn.close(); return; }   // already have them, or a second player
      if (conn.label === 'u') this.u = conn;
      else { this.r = conn; this.opened('direct'); }
    });
    conn.on('data', (d) => { this.heard = performance.now(); if (d === 'ping') return; if (conn.label === 'u') this.on.state?.(d); else this.on.message?.(d); });
    conn.on('close', () => { if (conn === this.r) this.lost(); });
    conn.on('error', (e) => this.on.error?.(String(e?.message || e)));
  }

  /** Host: claim a code, listen on both routes, put the game on the open list, and wait. info() says what to list. */
  async host(info) {
    this.info = info;
    // the direct route needs the matchmaking server; if it cannot be had, the relay alone will do
    let code = null;
    try {
      const Peer = await loadPeer();
      for (let tries = 0; tries < 4 && !code; tries++) {
        const c = newCode(), peer = new Peer(PREFIX + c);
        const ok = await new Promise((res) => {
          peer.on('open', () => res(true));
          peer.on('error', (e) => res(e.type === 'unavailable-id' ? false : 'fail'));
          setTimeout(() => res('fail'), 8000);
        });
        if (ok === true) {
          code = c;
          this.peer = peer;
          peer.on('connection', (conn) => this.attach(conn));
          peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });   // lost the matchmaker (a phone put away): back on
        } else {
          peer.destroy();
          if (ok === 'fail') break;
        }
      }
    } catch (e) { /* no direct route from here */ }
    this.code = code ?? newCode();
    this.out = topic(this.code, 'down');
    this.listed = true;
    for (const url of BROKERS) this.listen(url, topic(this.code, 'up'));
    this.beat = setInterval(() => { if (this.listed) this.list(true); }, BEAT);
    return this.code;
  }

  /**
   * Keep a relay connection to this broker, subscribed to `sub`, coming back whenever it drops (a phone switched
   * away from the game closes its sockets). If it was the one in use, the game carries on through the new one.
   */
  listen(url, sub) {
    if (this.closed) return;
    const mq = new Mqtt(url, this.info ? LOBBY + this.code : null);
    mq.onmessage = (t, b) => this.fromRelay(mq, b);
    mq.onclose = () => {
      this.relays = this.relays.filter((m) => m !== mq);
      if (!this.closed) setTimeout(() => this.listen(url, sub), 2500);
    };
    mq.connect().then(() => {
      mq.subscribe(sub);
      this.relays.push(mq);
      if (this.info && this.listed) this.list(true, mq);
      if (this.mode === 'relay' && this.relay?.url === url) this.relay = mq;
    }).catch(() => {});
  }

  /** Guest: find the host by code, directly if the networks allow it, else through the relay. */
  async join(code, progress = () => {}) {
    code = code.toUpperCase();
    this.code = code;
    this.out = topic(code, 'up');
    if (!new URLSearchParams(location.search).has('relay')) {      // (?relay in the address: straight to the relay, for testing it)
      try { if (await this.direct(code, progress)) return; } catch (e) { /* no direct route */ }
      this.peer?.destroy();
      this.peer = null;
    }
    progress('Going through a relay…');
    for (const url of BROKERS) {
      const mq = new Mqtt(url);
      try { await mq.connect(); } catch (e) { continue; }
      this.relay = mq;
      mq.onmessage = (t, b) => this.fromRelay(mq, b);
      mq.subscribe(topic(code, 'down'));
      // say hello (again and again, in case the first went before the subscription was in) until the host answers
      const ok = await new Promise((res) => {
        const said = setInterval(() => mq.publish(this.out, relayPacket(HELLO)), 700);
        mq.publish(this.out, relayPacket(HELLO));
        const first = this.on.message;
        this.on.message = (m) => { clearInterval(said); this.on.message = first; this.opened('relay'); first?.(m); res(true); };
        setTimeout(() => { clearInterval(said); if (!this.mode) { this.on.message = first; res(false); } }, 8000);
      });
      if (ok) {
        mq.onclose = () => { if (!this.closed && this.relay === mq) setTimeout(() => this.listen(url, topic(code, 'down')), 1500); };
        return;
      }
      this.relay = null;
      mq.close();
    }
    throw new Error('no answer: that game may have just closed or filled up');
  }

  /** The direct line: true if it opened. Any failure (no matchmaker, no such code there, blocked) is just false. */
  async direct(code, progress) {
    const Peer = await loadPeer();
    const peer = this.peer = new Peer();
    const up = await new Promise((res) => { peer.on('open', () => res(true)); peer.on('error', () => res(false)); setTimeout(() => res(false), 6000); });
    if (!up) return false;
    progress('Connecting directly…');
    const ok = await new Promise((res) => {
      peer.on('error', () => res(false));              // (no such code there: the host may still be on the relay)
      const r = peer.connect(PREFIX + code, { label: 'r', reliable: true, serialization: 'json' });
      const u = peer.connect(PREFIX + code, { label: 'u', reliable: false, serialization: 'raw' });
      this.attach(r);
      this.attach(u);
      r.on('open', () => res(true));
      setTimeout(() => res(false), DIRECT_WAIT);
    });
    return ok && this.mode === 'direct';
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watch);
    clearInterval(this.keep);
    clearInterval(this.beat);
    if (this.info) this.list(false);
    if (this.mode === 'relay') this.relay?.publish(this.out, relayPacket(BYE));
    this.peer?.destroy();
    for (const mq of [...this.relays, this.relay]) mq?.close();
  }
}

/**
 * The open games, for the start screen: every host's listing on both relay servers, kept while it keeps coming. A
 * retained one (handed over on subscribing) may be old, so it only counts if its own clock says it is recent; an empty
 * one means that game is gone. Anyone can write to a public server, so what is shown is checked and kept short.
 */
export class Lobbies {
  constructor(onchange) { this.onchange = onchange; this.games = new Map(); this.conns = new Map(); this.on = false; }

  get list() { return [...this.games.values()].sort((a, b) => a.since - b.since); }

  start() {
    if (this.on) return;
    this.on = true;
    for (const url of BROKERS) this.connect(url);
    this.prune = setInterval(() => {
      for (const [code, g] of this.games) if (performance.now() - g.seen > STALE) { this.games.delete(code); this.onchange(); }
    }, 2000);
  }

  connect(url) {
    if (!this.on) return;
    const mq = new Mqtt(url);
    this.conns.set(url, mq);
    mq.onmessage = (t, b, retained) => this.heard(t.slice(LOBBY.length), b, retained);
    mq.onclose = () => { if (this.on && this.conns.get(url) === mq) setTimeout(() => this.connect(url), 3000); };
    mq.connect().then(() => mq.subscribe(LOBBY + '+')).catch(() => {});
  }

  heard(code, bytes, retained) {
    if (!/^[A-Z]{4}$/.test(code)) return;
    let g = null;
    try { g = bytes.length ? JSON.parse(dec.decode(bytes)) : null; } catch (e) { return; }
    if (!g) { if (this.games.delete(code)) this.onchange(); return; }
    if (typeof g.map !== 'string' || (retained && !(Math.abs(Date.now() - g.t) < STALE))) return;
    const opts = Array.isArray(g.opts) ? g.opts.filter((o) => typeof o === 'string').slice(0, 4) : [];
    this.games.set(code, { code, map: g.map.slice(0, 20), opts, seen: performance.now(), since: this.games.get(code)?.since ?? performance.now() });
    this.onchange();
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    clearInterval(this.prune);
    for (const mq of this.conns.values()) mq.close();
    this.conns.clear();
    this.games.clear();
  }
}
