// Two players over the internet, with no server of our own.
//
// The host gets a four-letter code; the other player types it in. PeerJS's free public broker
// (0.peerjs.com) only introduces the two browsers to each other; after that they talk directly (WebRTC), or,
// on networks that will not allow that, through PeerJS's public relay. vendor/peerjs.min.js is loaded the
// first time someone hosts or joins, so a solo game never touches the network.
//
// Two channels between the players: 'r' (reliable, in order, JSON) for events, 'u' (unreliable, raw bytes)
// for the constant stream of where everything is, where a late packet is worth nothing.

const PREFIX = 'impactbox-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // (no I or O: they read as 1 and 0)

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

/**
 * A link to the other player. on: { message(data), state(bytes), open(), close(), error(text) }.
 * send(data) goes on the reliable channel, stream(bytes) on the unreliable one.
 */
export class Link {
  constructor(on) {
    this.on = on;
    this.r = null;
    this.u = null;
    this.peer = null;
    this.code = '';
    this.closed = false;
  }

  get open() { return !!(this.r?.open); }

  send(data) { if (this.r?.open) this.r.send(data); }
  stream(bytes) { if (this.u?.open) this.u.send(bytes); }

  /** Wire up a data connection (either end). */
  attach(conn) {
    if (conn.label === 'u') this.u = conn; else this.r = conn;
    conn.on('data', (d) => { if (conn.label === 'u') this.on.state?.(d); else this.on.message?.(d); });
    conn.on('open', () => { if (conn.label === 'r') this.on.open?.(); });
    conn.on('close', () => { if (conn.label === 'r' && !this.closed) this.on.close?.(); });
    conn.on('error', (e) => this.on.error?.(String(e?.message || e)));
  }

  /** Host: claim a code and wait for the other player. Resolves with the code. */
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
        peer.on('connection', (conn) => {
          // one other player at a time: a second one is turned away
          if (conn.label === 'r' && this.r?.open) { conn.on('open', () => conn.close()); return; }
          this.attach(conn);
        });
        peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });   // lost the broker: new players could not find us
        return code;
      }
      peer.destroy();
      if (ok !== false) throw new Error(ok);
    }
    throw new Error('no free code');
  }

  /** Guest: find the host by code. Resolves once the reliable channel is open. */
  async join(code) {
    const Peer = await loadPeer();
    const peer = new Peer();
    this.peer = peer;
    this.code = code.toUpperCase();
    await new Promise((res, rej) => {
      peer.on('open', res);
      peer.on('error', (e) => rej(new Error(e.type === 'peer-unavailable' ? 'no game with that code' : String(e.type || e))));
    });
    const r = peer.connect(PREFIX + this.code, { label: 'r', reliable: true, serialization: 'json' });
    const u = peer.connect(PREFIX + this.code, { label: 'u', reliable: false, serialization: 'raw' });
    this.attach(r);
    this.attach(u);
    await new Promise((res, rej) => {
      r.on('open', res);
      peer.on('error', (e) => rej(new Error(e.type === 'peer-unavailable' ? 'no game with that code' : String(e.type || e))));
      setTimeout(() => rej(new Error('the host did not answer')), 15000);
    });
  }

  close() {
    this.closed = true;
    this.peer?.destroy();
  }
}
