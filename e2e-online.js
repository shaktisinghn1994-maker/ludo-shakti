/* Two devices, one room — end-to-end over the live deployment:
   host creates a room, a guest joins by code, both play, chat, and reload.

   Needs two headless Chrome profiles so the pages do not share localStorage:
     chrome --headless=new --remote-debugging-port=9333 --user-data-dir=%TEMP%\ludo-a about:blank
     chrome --headless=new --remote-debugging-port=9334 --user-data-dir=%TEMP%\ludo-b about:blank
   then:  node e2e-online.js [baseUrl]                                      */
const PORT_A = 9333, PORT_B = 9334;
const BASE = (process.argv[2] || 'https://ludo-shakti.shaktisinghn1994.workers.dev').replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const bad = [];
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('PASS', label); }
  else { fail++; bad.push(label); console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
}

class Tab {
  constructor (port, name) { this.port = port; this.name = name; this.errors = []; }
  async connect () {
    const list = await (await fetch('http://localhost:' + this.port + '/json/list')).json();
    const page = list.find(t => t.type === 'page');
    if (!page) throw new Error('no page target on ' + this.port);
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('cdp connect ' + this.port)); });
    this.id = 0; this.pending = new Map();
    this.ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m.result || m.error); this.pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(String(m.params.exceptionDetails.text || 'exception'));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push('console.error');
      if (m.method === 'Log.entryAdded' && m.params.entry && m.params.entry.level === 'error') this.errors.push(m.params.entry.text);
    };
    this.send = (method, params = {}) => new Promise((res, rej) => {
      const i = ++this.id; this.pending.set(i, res);
      this.ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (this.pending.delete(i)) rej(new Error('timeout ' + method)); }, 25000);
    });
    await this.send('Runtime.enable'); await this.send('Log.enable'); await this.send('Page.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 1, mobile: false });
  }
  async ev (expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'EVAL ERROR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  }
  async nav (url) { await this.send('Page.navigate', { url }); await sleep(2800); }
  async until (expr, ms) {
    const t0 = Date.now();
    for (;;) {
      const v = await this.ev(expr);
      const isErr = typeof v === 'string' && v.indexOf('EVAL ERROR') === 0;
      if (v !== false && v !== null && v !== undefined && !isErr) return v;
      if (Date.now() - t0 > (ms || 8000)) return 'TIMEOUT';
      await sleep(300);
    }
  }
  async state () {
    return this.ev(`JSON.stringify({ act: game.active, idx: game.idx, ph: game.phase, dice: game.dice,
      names: game.names, tok: game.tokens, seat: net.seat, room: net.room })`);
  }
}

async function main () {
  const A = new Tab(PORT_A, 'host');
  const B = new Tab(PORT_B, 'guest');
  await A.connect(); await B.connect();

  /* ---------- both load the game ---------- */
  await A.nav(BASE + '/?e2e=host');
  await B.nav(BASE + '/?e2e=guest');
  ok(await A.ev(`!!document.getElementById('board')`), 'host page loaded');
  ok(await B.ev(`!!document.getElementById('board')`), 'guest page loaded');
  ok(await A.ev(`net.room === false`), 'no stale room on host');

  /* ---------- host creates a room ---------- */
  await A.ev(`document.getElementById('onlineBtn').click()`);
  await sleep(300);
  await A.ev(`document.getElementById('olHostName').value='Shakti'`);
  await A.ev(`document.getElementById('olCreateBtn').click()`);
  const code = await A.until(`(() => { const t = document.getElementById('olCodeOut').textContent; return /^[A-Z0-9]{6}$/.test(t) ? t : false; })()`, 12000);
  ok(typeof code === 'string' && code.length === 6, 'room code issued -> ' + code);
  if (typeof code !== 'string') { console.log('aborting'); process.exit(1); }

  ok(await A.ev(`net.role === 'host' && net.on === true`), 'host connected as host');
  ok(await A.ev(`document.getElementById('newGameBtn').classList.contains('hidden')`), 'New Game hidden while in a room');
  ok(await A.ev(`document.getElementById('olStartBtn').classList.contains('hidden') === false`), 'start button shown to the host');

  /* ---------- guest joins by code ---------- */
  await B.nav(BASE + '/?room=' + code);
  ok(await B.ev(`!document.getElementById('olJoin').classList.contains('hidden')`), 'guest lands on the join pane');
  ok(await B.ev(`document.getElementById('olCode').value`) === code, 'code prefilled -> ' + await B.ev(`document.getElementById('olCode').value`));
  await B.ev(`document.getElementById('olJoinName').value='Rahul'`);
  await B.ev(`document.getElementById('olJoinBtn').click()`);
  const seatsB = await B.until(`document.getElementById('olSeatList').children.length === 2`, 12000);
  ok(seatsB === true, 'guest sees both seats in the lobby');
  ok(await B.ev(`net.role === 'guest' && net.seat === 1 && net.p === 2`), 'guest seated as seat 1 (Yellow)');
  ok(await B.ev(`document.getElementById('olStartBtn').classList.contains('hidden')`), 'guest cannot start the game');

  const aSeats = await A.until(`document.getElementById('olSeatList').children.length === 2`, 8000);
  ok(aSeats === true, 'host sees the guest arrive');
  const status = await A.ev(`document.getElementById('olStatus').textContent`);
  ok(/start/i.test(status), 'host status invites a start -> ' + status);
  const guestRow = await A.ev(`(() => { const li = document.querySelectorAll('#olSeatList li')[1]; return li ? li.textContent : ''; })()`);
  ok(/Rahul/.test(guestRow), 'host lobby shows the guest name -> ' + guestRow);

  /* ---------- start ---------- */
  await A.ev(`document.getElementById('olStartBtn').click()`);
  const started = await A.until(`document.getElementById('onlineScreen').classList.contains('hidden') && game.phase === 'roll'`, 10000);
  ok(started === true, 'host starts and the match goes live');
  const bStarted = await B.until(`document.getElementById('onlineScreen').classList.contains('hidden') && game.active.length === 2`, 10000);
  ok(bStarted === true, 'guest board appears');

  const sa = JSON.parse(await A.state());
  const sb = JSON.parse(await B.state());
  ok(sa.act.join() === sb.act.join(), 'same players -> A:' + sa.act.join() + ' B:' + sb.act.join());
  ok(sa.idx === sb.idx && sa.ph === sb.ph, 'same turn/phase -> ' + sa.idx + '/' + sa.ph);
  ok(sa.names[0] === 'Shakti' && sa.names[2] === 'Rahul', 'lobby names reach the board -> ' + JSON.stringify(sa.names));
  ok(sb.names[0] === 'Shakti' && sb.names[2] === 'Rahul', 'guest shows both names -> ' + JSON.stringify(sb.names));
  ok(sb.seat === 1, 'guest seat sticks -> ' + sb.seat);

  /* ---------- turn authority ---------- */
  const before = JSON.parse(await B.state());
  ok(await B.ev(`document.getElementById('rollBtn').disabled === true`), 'guest dice disabled out of turn');
  await B.ev(`document.getElementById('rollBtn').click()`);
  await sleep(900);
  const after = JSON.parse(await B.state());
  ok(before.dice === after.dice && before.idx === after.idx && before.ph === after.ph && JSON.stringify(before.tok) === JSON.stringify(after.tok),
     'guest cannot roll out of turn -> ' + JSON.stringify({ d: after.dice, ph: after.ph }));
  ok(await A.ev(`document.getElementById('rollBtn').disabled === false`), 'host dice enabled on its turn');

  /* ---------- host rolls, guest sees the face ---------- */
  await A.ev(`document.getElementById('rollBtn').click()`);
  const rolled = await A.until(`game.dice !== null`, 9000);
  ok(rolled !== 'TIMEOUT', 'host rolled -> dice=' + await A.ev(`game.dice`));
  const diceVal = await A.ev(`game.dice`);
  const seen = await B.until(`game.dice === ` + JSON.stringify(diceVal), 9000);
  ok(seen === true, 'guest shows the same dice face -> ' + diceVal);

  /* ---------- keep resolving until the game is ready for the next roll ---------- */
  async function settleBoard () {
    const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      const ph = await A.ev(`game.phase`);
      if (ph === 'select') {
        const seat = await A.ev(`game.idx`);
        const who = seat === 0 ? A : B;
        const ready = await who.until(`game.phase === 'select'`, 5000);
        if (ready === 'TIMEOUT') break;
        await who.ev(`(() => { const m = game.movable[0]; tokenEls[m.p][m.t].click(); return 1; })()`);
        await sleep(700);
        continue;
      }
      if (ph === 'moving') { await sleep(500); continue; }
      if (ph === 'wait') { await sleep(600); continue; }
      break;                                   // roll / over
    }
    await A.until(`game.phase !== 'moving'`, 14000);
    await B.until(`game.phase !== 'moving'`, 14000);
    await sleep(1400);                         // queued snapshots settle on the guest
  }

  /* ---------- play turns on both seats until a token actually moves ---------- */
  const startTok = JSON.stringify((JSON.parse(await A.state())).tok);
  let moved = false, rolls = 0;

  await settleBoard();                         // the explicit host roll above may have left a choice pending
  if (JSON.stringify((JSON.parse(await A.state())).tok) !== startTok) moved = true;

  while (!moved && rolls < 14) {
    rolls++;
    const seatIdx = await A.ev(`game.idx`);
    const who = seatIdx === 0 ? A : B;
    const whoName = seatIdx === 0 ? 'host' : 'guest';
    const ready = await who.until(`game.phase === 'roll' && document.getElementById('rollBtn').disabled === false`, 10000);
    if (ready === 'TIMEOUT') break;
    await who.ev(`document.getElementById('rollBtn').click()`);
    await settleBoard();

    const t1 = JSON.parse(await A.state());
    const t2 = JSON.parse(await B.state());
    if (JSON.stringify(t1.tok) !== JSON.stringify(t2.tok)) {
      ok(false, 'boards diverged on roll ' + rolls + ' (' + whoName + ')', { a: t1.tok, b: t2.tok });
      break;
    }
    if (JSON.stringify(t1.tok) !== startTok) {
      moved = true;
      ok(true, 'a token moved and both boards match after ' + rolls + ' roll(s) by ' + whoName);
      ok(t1.idx === t2.idx && t1.ph === t2.ph, 'turn/phase in step -> ' + t1.idx + '/' + t1.ph);
    }
  }
  ok(moved, 'a move happened within 14 rolls (rolls=' + rolls + ')');

  /* ---------- chat ---------- */
  await B.ev(`(() => { const i = document.getElementById('chatText'); i.value = 'hi from B';
    document.getElementById('chatForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return 1; })()`);
  const got = await A.until(`[...document.querySelectorAll('.chat-bubble')].some(x => x.textContent === 'hi from B')`, 8000);
  ok(got === true, 'host received the guest chat line');
  const pc = await A.ev(`(function(){ const b = [...document.querySelectorAll('.chat-bubble')].find(x => x.textContent === 'hi from B');
    return b ? b.parentElement.style.getPropertyValue('--pc') : null; })()`);
  ok(String(pc).toLowerCase() === '#d99b1c', 'chat line carries the guest colour -> ' + pc);
  const dupes = await B.ev(`[...document.querySelectorAll('.chat-bubble')].filter(x => x.textContent === 'hi from B').length`);
  ok(dupes === 1, 'no duplicate on the sender -> ' + dupes);

  /* ---------- guest reload rejoins the same seat ---------- */
  const keyBefore = await B.ev(`localStorage.getItem('ludo.room')`);
  ok(!!keyBefore && String(keyBefore).indexOf(code) >= 0, 'guest saved the room key -> ' + String(keyBefore).slice(0, 40));
  await B.nav(BASE + '/?rejoin=' + Date.now());
  const back = await B.until(`net.room === true && net.seat === 1 && game.active.length === 2`, 14000);
  ok(back === true, 'guest reload rejoins the room -> ' + await B.ev(`JSON.stringify({room: net.room, hello: net.hello, code: net.code, seat: net.seat, ph: game.phase, err: net.lastErr})`));
  const rb = JSON.parse(await B.state());
  const ra = JSON.parse(await A.state());
  ok(JSON.stringify(ra.tok) === JSON.stringify(rb.tok), 'rejoined guest board matches the host');

  ok(A.errors.length === 0, 'host: zero console errors -> ' + JSON.stringify(A.errors.slice(0, 4)));
  ok(B.errors.length === 0, 'guest: zero console errors -> ' + JSON.stringify(B.errors.slice(0, 4)));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  A.ws.close(); B.ws.close();
  if (fail) { console.log('FAILING:', bad.join(' | ')); process.exit(1); }
}

main().catch(e => { console.error('ERROR', e.message); process.exit(1); });
