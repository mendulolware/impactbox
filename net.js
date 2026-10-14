// Two players over the internet, with no server of our own.
//
// The host gets a four-letter code; the other player types it in. Two ways to reach each other:
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

/** connect(), subscribe(topic), publish(topic, bytes), onmessage(topic, bytes): QoS 0 only, and a keep-alive. */
class Mqtt {
  constructor(url) { this.url = url; this.buf = new Uint8Array(0); this.onmessage = null; this.onclose = null; }

  connect() {
    return new Promise((res, rej) => {
      const ws = this.ws = new WebSocket(this.url, 'mqtt');
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => { ws.close(); rej(new Error('relay timeout')); }, 7000);
      ws.onerror = () => { clearTimeout(timer); rej(new Error('relay unreachable')); };
      ws.onclose = () => { clearInterval(this.ping); this.onclose?.(); };
      ws.onopen = () => ws.send(mqPacket(0x10, [...mqStr('MQTT'), 4, 2, 0, 60, ...mqStr('ibx' + Math.random().toString(36).slice(2, 12))]));
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
            this.onmessage?.(dec.decode(body.subarray(2, 2 + tl)), body.slice(skip));
          }
          o = i + n;
        }
        this.buf = b.slice(o);
      };
    });
  }

  raw(bytes) { if (this.ws?.readyState === 1) this.ws.send(bytes); }
  subscribe(t) { this.raw(mqPacket(0x82, [0, 1, ...mqStr(t), 0])); }
  publish(t, bytes) { this.raw(mqPacket(0x30, mqStr(t), bytes)); }
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
    // through the relay nothing says when they go, so a silence that long means they have
    // (and a ping every 2 s, which a tab in the background still sends, so switching away for a moment is not leaving)
    if (mode === 'relay') {
      this.watch = setInterval(() => { if (performance.now() - this.heard > SILENCE) this.lost(); }, 1000);
      this.keep = setInterval(() => this.relay?.publish(this.out, relayPacket(PING)), 2000);
    }
    this.on.via?.(mode);
    this.on.open?.();
  }

  lost() {
    if (!this.mode || this.closed) return;
    clearInterval(this.watch);
    clearInterval(this.keep);
    this.mode = null;
    this.r = this.u = null;
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
    conn.on('data', (d) => { this.heard = performance.now(); if (conn.label === 'u') this.on.state?.(d); else this.on.message?.(d); });
    conn.on('close', () => { if (conn === this.r) this.lost(); });
    conn.on('error', (e) => this.on.error?.(String(e?.message || e)));
  }

  /** Host: claim a code, listen on both routes, and wait. Resolves with the code. */
  async host() {
    const Peer = await loadPeer();
    for (let tries = 0; tries < 4; tries++) {
      const code = newCode();
      const peer = new Peer(PREFIX + code);
      const ok = await new Promise((res) => {
        peer.on('open', () => res(true));
        peer.on('error', (e) => res(e.type === 'unavailable-id' ? false : String(e.type || e)));
      });
      if (ok === true) {
        this.peer = peer;
        this.code = code;
        this.out = topic(code, 'down');
        peer.on('connection', (conn) => this.attach(conn));
        peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });   // lost the broker: new players could not find us
        for (const url of BROKERS) {
          const mq = new Mqtt(url);
          mq.onmessage = (t, b) => this.fromRelay(mq, b);
          mq.connect().then(() => { mq.subscribe(topic(code, 'up')); this.relays.push(mq); }).catch(() => {});
        }
        return code;
      }
      peer.destroy();
      if (ok !== false) throw new Error(ok);
    }
    throw new Error('no free code');
  }

  /** Guest: find the host by code, directly if the networks allow it, else through the relay. */
  async join(code, progress = () => {}) {
    code = code.toUpperCase();
    this.code = code;
    this.out = topic(code, 'up');
    const Peer = await loadPeer();
    const peer = this.peer = new Peer();
    await new Promise((res, rej) => {
      peer.on('open', res);
      peer.on('error', (e) => rej(new Error(e.type === 'peer-unavailable' ? 'no game with that code' : String(e.type || e))));
      setTimeout(() => rej(new Error('could not reach the matchmaking server')), 10000);
    });
    progress('Found the game - connecting directly…');
    const skip = new URLSearchParams(location.search).has('relay');      // (?relay in the address: straight to the relay, for testing it)
    const direct = !skip && await new Promise((res, rej) => {
      peer.on('error', (e) => { if (e.type === 'peer-unavailable') rej(new Error('no game with that code')); });
      const r = peer.connect(PREFIX + code, { label: 'r', reliable: true, serialization: 'json' });
      const u = peer.connect(PREFIX + code, { label: 'u', reliable: false, serialization: 'raw' });
      this.attach(r);
      this.attach(u);
      r.on('open', () => res(true));
      setTimeout(() => res(false), DIRECT_WAIT);
    });
    if (direct && this.mode === 'direct') return;
    // the direct line did not open (the networks would not have it): through the relay
    peer.destroy();
    this.peer = null;
    progress('Direct connection blocked - going through a relay…');
    for (const url of BROKERS) {
      const mq = new Mqtt(url);
      try { await mq.connect(); } catch (e) { continue; }
      this.relay = mq;
      mq.onmessage = (t, b) => this.fromRelay(mq, b);
      mq.onclose = () => { if (this.relay === mq) this.lost(); };
      mq.subscribe(topic(code, 'down'));
      // say hello (again, in case the first went before the subscription was in) until the host answers
      const ok = await new Promise((res) => {
        const said = setInterval(() => mq.publish(this.out, relayPacket(HELLO)), 700);
        mq.publish(this.out, relayPacket(HELLO));
        const first = this.on.message;
        this.on.message = (m) => { clearInterval(said); this.on.message = first; this.opened('relay'); first?.(m); res(true); };
        setTimeout(() => { clearInterval(said); if (!this.mode) { this.on.message = first; res(false); } }, 8000);
      });
      if (ok) return;
      mq.close();
    }
    throw new Error('the host did not answer (direct or through the relay)');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watch);
    clearInterval(this.keep);
    if (this.mode === 'relay') this.relay?.publish(this.out, relayPacket(BYE));
    this.peer?.destroy();
    for (const mq of [...this.relays, this.relay]) mq?.close();
  }
}
