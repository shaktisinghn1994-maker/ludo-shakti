/* Room protocol test — drives a host + guest (+ third wheel) straight at the
   Durable Object over WebSocket and checks the rules the server enforces.

   node room-test.js [baseUrl]     (defaults to the live deployment) */

const HOST = process.argv[2] || 'https://ludo-shakti.shaktisinghn1994.workers.dev';
const BASE = HOST.replace(/^http/, 'ws');
const HTTP = HOST;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const bad = [];
function ok (cond, label, extra) {
  if (cond) { pass++; console.log('PASS', label); }
  else { fail++; bad.push(label); console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
}

function client (path) {
  const queue = [];
  const waiters = [];

  function drain () {
    while (waiters.length) {
      const w = waiters[0];
      const i = queue.findIndex(w.pred);
      if (i < 0) return;
      const m = queue.splice(i, 1)[0];
      waiters.shift();
      clearTimeout(w.to);
      w.res(m);
    }
  }

  const c = {
    ws: null,
    send (o) { try { c.ws.send(JSON.stringify(o)); } catch (e) {} },
    take (pred, ms) {
      const i = queue.findIndex(pred);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        const w = { pred, res, to: setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) waiters.splice(k, 1); rej(new Error('timeout')); }, ms || 4000) };
        waiters.push(w);
      });
    },
    takeType (t, ms) { return c.take(m => m.t === t, ms); },
    async quiet (ms) {
      await sleep(ms);
      return queue.splice(0, queue.length);
    },
    close () { try { c.ws.close(); } catch (e) {} }
  };

  return new Promise((res, rej) => {
    const ws = new WebSocket(BASE + path);
    c.ws = ws;
    ws.onmessage = e => { queue.push(JSON.parse(e.data)); drain(); };
    ws.onopen = () => res(c);
    ws.onerror = () => rej(new Error('connect failed'));
    setTimeout(() => rej(new Error('connect timeout')), 6000);
  });
}

async function connect (path) {
  return client(path);
}

async function main () {
  const code = 'T' + Math.random().toString(36).slice(2, 6).toUpperCase();

  /* 0. static + marker still served by the worker */
  const build = await (await fetch(HTTP + '/build')).json();
  ok(build.rooms === true, '/build marker -> ' + JSON.stringify(build));
  const info0 = await (await fetch(HTTP + '/room/' + code + '/info')).json();
  ok(info0.ok === true && info0.open === false, 'room info before creation -> ' + JSON.stringify(info0));
  const page = await fetch(HTTP + '/');
  ok(page.status === 200, 'index.html still served -> ' + page.status);
  const css = await fetch(HTTP + '/style.css');
  ok(css.status === 200, 'style.css still served -> ' + css.status);

  /* 1. host creates */
  const host = await connect('/room/' + code);
  host.send({ t: 'hi', role: 'host', name: 'Shakti', count: 2, token: 'host-token' });
  const h1 = await host.takeType('hello');
  ok(h1.seat === 0 && h1.p === 0 && h1.owner === true, 'host hello -> ' + JSON.stringify(h1).slice(0, 160));
  ok(h1.count === 2 && h1.started === false, 'host starts unstarted/count 2');

  const info1 = await (await fetch(HTTP + '/room/' + code + '/info')).json();
  ok(info1.open === true && info1.seats === 1, 'room info after host -> ' + JSON.stringify(info1));

  /* 2. second client claiming to be a host with a different token is refused */
  const squatter = await connect('/room/' + code);
  squatter.send({ t: 'hi', role: 'host', name: 'Eve', count: 2, token: 'other-token' });
  const s1 = await squatter.takeType('err');
  ok(/in use/i.test(s1.text), 'squatter host refused -> ' + s1.text);

  /* 3. guest joins */
  const guest = await connect('/room/' + code);
  guest.send({ t: 'hi', role: 'join', name: 'Rahul', token: 'guest-token' });
  const g1 = await guest.takeType('hello');
  ok(g1.seat === 1 && g1.p === 2 && g1.owner === false, 'guest hello -> ' + JSON.stringify(g1).slice(0, 160));
  const hs = await host.takeType('seats');
  ok(hs.seats.length === 2 && hs.seats[1].name === 'Rahul', 'host sees roster -> ' + JSON.stringify(hs.seats));

  /* 4. a third client finds the room full */
  const third = await connect('/room/' + code);
  third.send({ t: 'hi', role: 'join', name: 'Bittu', token: 'third-token' });
  const t1 = await third.takeType('err');
  ok(/full/i.test(t1.text), 'third player refused -> ' + t1.text);

  /* 5. actions are refused before the game starts */
  guest.send({ t: 'a', a: 'roll' });
  const early = await guest.takeType('err');
  ok(/not started/i.test(early.text), 'roll before start refused -> ' + early.text);

  /* 6. start */
  guest.send({ t: 'start' });
  const notHost = await guest.takeType('err');
  ok(/host/i.test(notHost.text), 'guest cannot start -> ' + notHost.text);
  host.send({ t: 'start' });
  const gh = await guest.takeType('seats');
  const hh = await host.takeType('seats');
  ok(gh.started === true && hh.started === true, 'both told the game started');

  /* 7. state flows host -> guest, never back */
  const snap1 = { act: [0, 2], idx: 0, ph: 'roll', dice: null, six: 0, mov: [], names: { 0: 'Shakti', 2: 'Rahul' }, tok: [[-1, -1, -1, -1], [], [-1, -1, -1, -1], []], msg: "Shakti's turn" };
  host.send({ t: 's', snap: snap1 });
  const gs = await guest.takeType('s');
  ok(gs.snap.idx === 0 && gs.snap.tok[0][0] === -1, 'guest received snapshot');
  const hb = await host.quiet(150);
  ok(!hb.some(m => m.t === 's'), 'host does not get its own snapshot back', hb);

  /* 8. turn authority: the guest (Yellow) may not roll on Red's turn */
  guest.send({ t: 'a', a: 'roll' });
  const notTurn = await guest.takeType('err');
  ok(/not your turn/i.test(notTurn.text), 'wrong seat action refused -> ' + notTurn.text);

  /* 9. an illegal tap is refused even on your own turn */
  const snap2 = Object.assign({}, snap1, { idx: 1, mov: [{ p: 2, t: 0, steps: 6 }] });
  host.send({ t: 's', snap: snap2 });
  await guest.takeType('s');
  guest.send({ t: 'a', a: { k: 'tap', p: 2, t: 3 } });          // not in mov
  const illegal = await guest.takeType('err');
  ok(/not available/i.test(illegal.text), 'illegal tap refused -> ' + illegal.text);

  /* 10. legal action reaches the host */
  guest.send({ t: 'a', a: { k: 'tap', p: 2, t: 0 } });
  const relay = await host.takeType('a');
  ok(relay.a && relay.a.k === 'tap' && relay.from === 1, 'action relayed to host -> ' + JSON.stringify(relay));

  /* 11. chat is stamped with the sender's seat and not echoed back */
  guest.send({ t: 'chat', kind: 'text', text: 'hi all', p: 0 });   // p is ignored: server stamps it
  const hostChat = await host.takeType('chat');
  ok(hostChat.m.p === 2 && hostChat.m.text === 'hi all', 'chat stamped with real seat -> ' + JSON.stringify(hostChat.m));
  const noEcho = await guest.quiet(150);
  ok(!noEcho.some(m => m.t === 'chat'), 'chat not echoed to sender', noEcho);

  host.send({ t: 'chat', sys: true, text: 'Red captured Yellow!' });
  const sysLine = await guest.takeType('chat');
  ok(sysLine.m.sys === true && sysLine.m.p === 0, 'host system line reaches guest -> ' + JSON.stringify(sysLine.m));

  /* history is kept for anyone who joins later */
  const late = await connect('/room/' + code);
  late.send({ t: 'hi', role: 'join', name: 'Late', token: 'late-token' });
  const lateErr = await late.takeType('err');
  ok(/full/i.test(lateErr.text), 'late joiner refused while full -> ' + lateErr.text);

  /* 12. rename: own colour ok, other colour refused */
  guest.send({ t: 'rename', p: 2, v: 'Rahul S' });
  const rn = await host.takeType('rename');
  ok(rn.p === 2 && rn.v === 'Rahul S', 'own-colour rename relayed -> ' + JSON.stringify(rn));
  guest.send({ t: 'rename', p: 0, v: 'Hacker' });
  const rnErr = await guest.takeType('err');
  ok(/own player/i.test(rnErr.text), 'renaming someone else refused -> ' + rnErr.text);

  /* 13. guest leaving frees the seat for the next player */
  guest.close();
  const afterLeave = await host.takeType('seats');
  const gSeat = afterLeave.seats.find(s => s.seat === 1);
  ok(gSeat && gSeat.connected === false, 'seat freed after guest leaves -> ' + JSON.stringify(afterLeave.seats));
  const back = await connect('/room/' + code);
  back.send({ t: 'hi', role: 'join', name: 'Rahul', token: 'guest-token' });   // same token -> same seat
  const b1 = await back.takeType('hello');
  ok(b1.seat === 1 && b1.snap, 'returning guest gets its seat back with the state -> ' + JSON.stringify({ seat: b1.seat, hasSnap: !!b1.snap }));

  /* 14. history survives: the system line is in the welcome chat */
  ok(b1.chat && b1.chat.some(m => m.text === 'Red captured Yellow!'), 'chat history in welcome -> ' + JSON.stringify(b1.chat).slice(0, 200));

  /* 15. unknown room code */
  const ghost = await connect('/room/ZZZZ99');
  ghost.send({ t: 'hi', role: 'join', name: 'Nobody', token: 'x' });
  const gErr = await ghost.takeType('err');
  ok(/not found/i.test(gErr.text), 'unknown room refused -> ' + gErr.text);

  /* 16. bad code never reaches the worker */
  const badResp = await fetch(HTTP + '/room/!%20bad');
  ok(badResp.status === 400, 'bad room code rejected -> ' + badResp.status);

  host.close(); back.close(); late.close(); squatter.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('FAILING:', bad.join(' | ')); process.exit(1); }
}

main().catch(e => { console.error('ERROR', e.message); process.exit(1); });
