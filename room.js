/* ---------- Room (Durable Object) ----------
   One room per shareable code. Seats, roster, chat history and turn authority
   live here; the host browser runs the rules engine and pushes snapshots,
   every other phone mirrors them. Uses the WebSocket Hibernation API so idle
   rooms cost nothing and stay inside the free plan. */

const BY_COUNT = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
const MAX_CHAT = 60;
const HOST_GRACE_MS = 30000;   // how long the room waits for the host to return

function json (o, status) {
  return new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { 'content-type': 'application/json' }
  });
}

export class Room {
  constructor (state, env) {
    this.state = state;
    this.env = env;
    this.meta = null;
  }

  /* ---------- storage ---------- */
  fresh () {
    return { owner: null, count: 2, started: false, seats: [], chat: [], snap: null, createdAt: Date.now() };
  }

  async load () {
    if (this.meta) return this.meta;
    let raw = null;
    try { raw = await this.state.storage.get('meta'); } catch (e) { /* first run */ }
    this.meta = raw ? JSON.parse(raw) : this.fresh();
    return this.meta;
  }

  save () {
    const m = this.meta;
    try { return this.state.storage.put('meta', JSON.stringify(m)); } catch (e) { return Promise.resolve(); }
  }

  /* ---------- sockets ---------- */
  all () {
    try { return this.state.getWebSockets() || []; } catch (e) { return []; }
  }

  att (ws) {
    try { return ws.deserializeAttachment(); } catch (e) { return null; }
  }

  /* small breadcrumb trail, readable through GET /room/<code>/info — there are no
     live logs on the free plan, so this is how a room explains itself */
  note (x) {
    try {
      this.state.storage.get('dbg').then(raw => {
        const arr = raw ? JSON.parse(raw) : [];
        arr.push(new Date().toISOString().slice(11, 23) + ' ' + x);
        return this.state.storage.put('dbg', JSON.stringify(arr.slice(-24)));
      }).catch(() => {});
    } catch (e) { /* never break the room for a note */ }
  }

  send (ws, o) {
    /* no readyState check here: on the server side of a just-accepted socket it is
       not always 1 yet, and a silent guard would drop every reply. */
    try { ws.send(JSON.stringify(o)); } catch (e) { this.note('send-threw ' + e.message); }
  }

  broadcast (o, except) {
    const s = JSON.stringify(o);
    this.all().forEach(ws => {
      if (ws === except) return;
      try { ws.send(s); } catch (e) { this.note('bcast-threw ' + e.message); }
    });
  }

  /* which seats are actually attached right now — a stored flag lags behind a
     reload, so liveness is read from the sockets themselves */
  liveSeats (except) {
    const set = new Set();
    this.all().forEach(ws => {
      if (ws === except) return;
      const a = this.att(ws);
      if (a && typeof a.seat === 'number') set.add(a.seat);
    });
    return set;
  }

  roster (except) {
    const m = this.meta;
    const live = this.liveSeats(except);
    return (m.seats || []).map(s => ({
      seat: s.seat, p: s.p, name: s.name, connected: live.has(s.seat)
    })).sort((a, b) => a.seat - b.seat);
  }

  hostSocket () {
    return this.all().find(ws => { const a = this.att(ws); return a && a.seat === 0; }) || null;
  }

  /* ---------- http + upgrade ---------- */
  async fetch (request) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);        // room / CODE / …
    const meta = await this.load();

    if (parts[2] === 'info') {
      let dbg = null;
      try { dbg = JSON.parse(await this.state.storage.get('dbg') || 'null'); } catch (e) {}
      return json({
        ok: true,
        code: parts[1] || '',
        open: !!meta.owner,
        count: meta.count,
        started: !!meta.started,
        seats: (meta.seats || []).length,
        dbg: dbg
      });
    }

    const up = (request.headers.get('Upgrade') || '').toLowerCase();
    if (up !== 'websocket') return json({ error: 'WebSocket only' }, 400);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    try {
      this.state.acceptWebSocket(server);
      this.note('accepted (keys=' + Object.keys(pair).join(',') + ')');
    } catch (e) {
      this.note('accept-FAILED ' + e.message);
      return new Response('Room unavailable', { status: 500 });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---------- protocol ---------- */
  async webSocketMessage (ws, raw) {
    let m = null;
    try { m = JSON.parse(raw); } catch (e) { this.note('bad-json ' + typeof raw); return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') { this.note('bad-msg'); return; }
    this.note('recv ' + m.t + ' sockets=' + this.all().length);

    const meta = await this.load();
    try {
      if (m.t === 'hi') { await this.onHi(ws, meta, m); this.note('hi-done'); return; }

      const a = this.att(ws);
      if (!a) { this.note('no-attachment'); this.send(ws, { t: 'err', text: 'Session not ready.' }); return; }

      switch (m.t) {
        case 'start':  return await this.onStart(ws, meta, a);
        case 's':      return this.onState(ws, meta, a, m);
        case 'e':      return this.onEvent(ws, meta, a, m);
        case 'a':      return await this.onAction(ws, meta, a, m);
        case 'chat':   return await this.onChat(ws, meta, a, m);
        case 'rename': return this.onRename(ws, meta, a, m);
        case 'leave':  try { ws.close(1000, 'left'); } catch (e) {} return;
        default:       this.send(ws, { t: 'err', text: 'Unknown message.' });
      }
    } catch (e) {
      this.note('threw@' + (e && e.message));
      try { this.send(ws, { t: 'err', text: 'Room error.' }); } catch (e2) {}
    }
  }

  async onHi (ws, meta, m) {
    const name = String(m.name || '').trim().slice(0, 16) || 'Player';
    const token = String(m.token || '').trim().slice(0, 40);
    const isHost = m.role === 'host';
    let seat = null;                       // assigned by whichever branch fits

    if (isHost) {
      if (meta.owner && token && meta.owner !== token) {
        this.send(ws, { t: 'err', text: 'That room code is in use. Try another.' });
        try { ws.close(4000, 'collision'); } catch (e) {}
        return;
      }
      if (!meta.owner) {
        // brand new room (or one that was closed earlier): start clean
        const fresh = this.fresh();
        fresh.owner = token;
        fresh.count = Math.min(4, Math.max(2, +m.count || 2));
        Object.keys(meta).forEach(k => delete meta[k]);
        Object.assign(meta, fresh);
      }
      seat = meta.seats.find(s => s.seat === 0 && s.token === token);
      if (!seat) {
        seat = { seat: 0, token: token, name: name, p: BY_COUNT[meta.count][0], connected: true, joined: Date.now() };
        meta.seats = meta.seats.filter(s => s.seat !== 0);
        meta.seats.push(seat);
      }
      seat.connected = true;
      seat.name = name;
    } else {
      if (!meta.owner) {
        this.send(ws, { t: 'err', text: 'Room not found — check the code.' });
        try { ws.close(4004, 'no room'); } catch (e) {}
        return;
      }
      seat = token ? meta.seats.find(s => s.token === token && s.seat !== 0) : null;
      if (!seat) {
        const live = this.liveSeats();
        const taken = new Set(meta.seats.filter(s => live.has(s.seat) || s.seat === 0).map(s => s.seat));
        let idx = -1;
        for (let i = 1; i < meta.count; i++) if (!taken.has(i)) { idx = i; break; }
        if (idx < 0) {
          this.send(ws, { t: 'err', text: 'This room is full (' + meta.count + ' players).' });
          try { ws.close(4005, 'full'); } catch (e) {}
          return;
        }
        seat = {
          seat: idx, token: token || Math.random().toString(36).slice(2, 14),
          name: name, p: BY_COUNT[meta.count][idx], connected: true, joined: Date.now()
        };
        meta.seats.push(seat);
      } else {
        seat.connected = true;
        seat.name = name;
      }
    }

    /* a token proves ownership — reclaim the seat even if the old socket has not
       been cleaned up yet, and retire any leftover socket still holding it */
    if (token && seat) {
      this.all().forEach(w => {
        if (w === ws) return;
        const b = this.att(w);
        if (b && b.seat === seat.seat && b.token === token) { try { w.close(4009, 'replaced'); } catch (e) {} }
      });
    }

    await this.save();
    try { ws.serializeAttachment({ seat: seat.seat, token: seat.token, p: seat.p, role: isHost ? 'host' : 'guest' }); } catch (e) {}
    if (seat.seat === 0) { try { await this.state.storage.deleteAlarm(); } catch (e) {} }

    this.send(ws, {
      t: 'hello',
      seat: seat.seat,
      p: seat.p,
      owner: seat.seat === 0,
      count: meta.count,
      started: !!meta.started,
      seats: this.roster(),
      snap: meta.snap,
      chat: (meta.chat || []).slice(-MAX_CHAT)
    });
    this.broadcast({ t: 'seats', seats: this.roster(), count: meta.count, started: !!meta.started }, ws);
  }

  async onStart (ws, meta, a) {
    if (a.seat !== 0) { this.send(ws, { t: 'err', text: 'Only the host can start the game.' }); return; }
    const live = this.liveSeats();
    const connected = meta.seats.filter(s => live.has(s.seat)).length;
    if (connected < meta.count) {
      this.send(ws, { t: 'err', text: 'Waiting for players — ' + connected + '/' + meta.count + ' here.' });
      return;
    }
    meta.started = true;
    meta.snap = null;                       // fresh match
    await this.save();
    this.broadcast({ t: 'seats', seats: this.roster(), count: meta.count, started: true });
  }

  onState (ws, meta, a, m) {
    if (a.seat !== 0) return;                               // only the host writes state
    if (!m.snap || !Array.isArray(m.snap.act) || !m.snap.act.length) return;
    meta.snap = m.snap;
    void this.save();
    this.broadcast({ t: 's', snap: m.snap }, ws);
  }

  onEvent (ws, meta, a, m) {
    if (a.seat !== 0) return;
    if (!m.ev || typeof m.ev !== 'object') return;
    this.broadcast({ t: 'e', ev: m.ev }, ws);
  }

  onAction (ws, meta, a, m) {
    const snap = meta.snap;
    if (!meta.started || !snap) { this.send(ws, { t: 'err', text: 'The game has not started yet.' }); return; }
    const curP = snap.act[snap.idx];
    if (a.p !== curP) { this.send(ws, { t: 'err', text: 'Not your turn.' }); return; }

    const act = m.a;
    if (act === 'roll') {
      if (snap.ph !== 'roll') { this.send(ws, { t: 'err', text: 'The dice are busy.' }); return; }
    } else if (act && act.k === 'tap') {
      const legal = (snap.mov || []).some(x => x.p === act.p && x.t === act.t);
      if (!legal) { this.send(ws, { t: 'err', text: 'That move is not available.' }); return; }
    } else {
      this.send(ws, { t: 'err', text: 'Unsupported action.' }); return;
    }

    const host = this.hostSocket();
    if (!host) { this.send(ws, { t: 'err', text: 'The host is reconnecting…' }); return; }
    this.send(host, { t: 'a', a: act, from: a.seat });
  }

  onChat (ws, meta, a, m) {
    const text = String(m.text || '').trim().slice(0, 300);
    if (!text) return;
    const item = {
      p: a.p,
      kind: String(m.kind || 'text').slice(0, 10),
      text: text,
      t: Date.now(),
      sys: !!m.sys
    };
    meta.chat = (meta.chat || []).concat([item]).slice(-MAX_CHAT);
    void this.save();
    this.broadcast({ t: 'chat', m: item }, ws);
  }

  onRename (ws, meta, a, m) {
    const p = +m.p;
    if (!(p >= 0 && p <= 3)) return;
    if (a.seat !== 0 && a.p !== p) {
      this.send(ws, { t: 'err', text: 'You can only rename your own player.' });
      return;
    }
    this.broadcast({ t: 'rename', p: p, v: String(m.v || '').slice(0, 16) }, ws);
  }

  /* ---------- lifecycle ---------- */
  async webSocketClose (ws, code) {
    this.note('close code=' + code + ' sockets=' + this.all().length);
    return this.drop(ws);
  }

  async webSocketError (ws) {
    this.note('socket-error');
    return this.drop(ws);
  }

  async drop (ws) {
    const meta = await this.load();
    const a = this.att(ws);
    if (!a) return;
    const still = this.liveSeats(ws);                 // a reload may already hold this seat
    const seat = meta.seats.find(s => s.seat === a.seat);
    if (seat && !still.has(a.seat)) seat.connected = false;
    await this.save();

    if (a.seat === 0 && !still.has(0)) {
      // the host drives the rules — give it a grace period before closing the room
      try { await this.state.storage.setAlarm(Date.now() + HOST_GRACE_MS); } catch (e) {}
      this.broadcast({ t: 'seats', seats: this.roster(ws), count: meta.count, started: !!meta.started, hostDown: true }, ws);
      return;
    }
    this.broadcast({ t: 'seats', seats: this.roster(ws), count: meta.count, started: !!meta.started }, ws);
  }

  async alarm () {
    const meta = await this.load();
    try { await this.state.storage.deleteAlarm(); } catch (e) {}
    if (this.liveSeats().has(0)) return;                      // host made it back in time
    this.broadcast({ t: 'bye', text: 'The host left the room.' });
    this.all().forEach(ws => { try { ws.close(1001, 'room closed'); } catch (e) {} });
    Object.keys(meta).forEach(k => delete meta[k]);
    Object.assign(meta, this.fresh());
    await this.save();
  }
}
