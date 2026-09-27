/* Headless test harness for ludo-game/script.js
   Stubs the DOM + timers, loads the real game code, then:
   1. validates board/path data
   2. validates move legality rules
   3. plays many full random games to completion
   Run: node test.js
*/
const fs = require('fs');
const path = require('path');

/* ---------- fake timers (instant, deterministic-ish) ---------- */
let now = 0;
let timerId = 1;
let queue = []; // { id, time, fn, interval }

global.setTimeout = (fn, ms) => {
  queue.push({ id: timerId, time: now + (ms || 0), fn, interval: null });
  return timerId++;
};
global.setInterval = (fn, ms) => {
  queue.push({ id: timerId, time: now + (ms || 0), fn, interval: Math.max(1, ms || 1) });
  return timerId++;
};
global.clearTimeout = id => { queue = queue.filter(t => t.id !== id); };
global.clearInterval = global.clearTimeout;

function flush () {
  let guard = 0;
  while (queue.length) {
    if (++guard > 100000) throw new Error('flush: timer runaway');
    queue.sort((a, b) => a.time - b.time || a.id - b.id);
    const t = queue[0];
    now = t.time;
    if (t.interval != null) t.time = now + t.interval;
    else queue.shift();
    t.fn();
  }
}

/* ---------- fake DOM ---------- */
function makeEl () {
  let cls = '';
  const el = {
    textContent: '',
    style: {},
    dataset: {},
    children: [],
    disabled: false,
    appendChild (c) { this.children.push(c); return c; },
    addEventListener () {},
    removeEventListener () {},
    querySelector () { return makeEl(); },
    querySelectorAll () { return []; },
    closest () { return null; },
    get offsetWidth () { return 10; },
    get className () { return cls; },
    set className (v) { cls = v; },
    classList: {
      add (...c) {
        const s = new Set(cls.split(' ').filter(Boolean));
        c.forEach(x => s.add(x));
        cls = [...s].join(' ');
      },
      remove (...c) {
        const s = new Set(cls.split(' ').filter(Boolean));
        c.forEach(x => s.delete(x));
        cls = [...s].join(' ');
      },
      toggle (c, force) {
        const s = new Set(cls.split(' ').filter(Boolean));
        if (force === undefined) force = !s.has(c);
        force ? s.add(c) : s.delete(c);
        cls = [...s].join(' ');
        return force;
      },
      contains (c) { return cls.split(' ').includes(c); }
    }
  };
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get () { return _html; },
    set (v) { _html = v; el.children = []; }
  });
  return el;
}

const ids = ['board','cells','deco','tokens','dice','rollBtn','message','turnCard','turnDot',
  'turnName','playerList','startScreen','winScreen','rulesScreen','nameFields','countSeg',
  'soundBtn','startBtn','againBtn','newGameBtn','rulesBtn','closeRules','winTitle'];
const registry = {};
ids.forEach(id => registry[id] = makeEl());
registry.board.clientWidth = 640;
registry.dice.querySelector = () => registry.pips = registry.pips || makeEl();

global.document = {
  getElementById: id => registry[id] || (registry[id] = makeEl()),
  createElement: () => makeEl(),
  addEventListener () {},
  querySelector: () => makeEl()
};
global.window = { addEventListener () {}, AudioContext: undefined, webkitAudioContext: undefined };

/* ---------- load game code ---------- */
const src = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const api = new Function(src + `
  return { game, PATH, SAFE, DEF, HOME, BY_COUNT, legalMoves, handleRoll, performMove,
           startGame, cellPos, buildBoard, buildDeco, buildPips, buildCards, cur, nameOf,
           renderTokens, nextTurn, resolve };
`)();

/* ---------- helpers ---------- */
let failures = 0;
function check (name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { failures++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

function resetGame (count) {
  registry.nameFields.querySelectorAll = () => [];
  api.startGame();
  flush();
}

/* ================= 1. board data ================= */
console.log('\n[1] Board data');
check('PATH has 52 squares', api.PATH.length === 52, 'got ' + api.PATH.length);
check('PATH squares are unique', new Set(api.PATH.map(p => p.join(','))).size === 52);
check('PATH squares in 0..14 range',
  api.PATH.every(([r, c]) => r >= 0 && r < 15 && c >= 0 && c < 15));
check('8 safe squares', api.SAFE.size === 8);
check('safe indexes valid', [...api.SAFE].every(i => i >= 0 && i < 52));

// start squares are 13 apart
const starts = api.DEF.map(d => d.start).sort((a, b) => a - b);
check('start squares spaced 13 apart', starts.join(',') === '0,13,26,39');

// each start square has its star exactly 8 steps later
const safeNoStart = [...api.SAFE].filter(i => !starts.includes(i)).sort((a, b) => a - b);
check('each star is 8 steps after a start square',
  starts.every(st => safeNoStart.includes((st + 8) % 52)),
  'stars=' + safeNoStart.join(','));

// build the board and count cells (the script already ran its own init)
registry.cells.innerHTML = '';
registry.deco.innerHTML = '';
api.buildBoard(); api.buildDeco(); api.buildPips(); api.buildCards();
check('225 cells rendered', registry.cells.children.length === 225,
  'got ' + registry.cells.children.length);
check('deco: 4 base inners + centre', registry.deco.children.length === 5,
  'got ' + registry.deco.children.length);

const hasClass = (el, c) => el.className.split(' ').includes(c);
const clsCount = c => registry.cells.children.filter(el => hasClass(el, c)).length;
check('4 start squares', clsCount('start') === 4, 'got ' + clsCount('start'));
check('4 star squares', clsCount('star') === 4, 'got ' + clsCount('star'));
check('20 home-column cells', clsCount('home') === 20, 'got ' + clsCount('home'));
check('144 base cells', clsCount('base') === 144, 'got ' + clsCount('base'));

/* ================= 2. move legality ================= */
console.log('\n[2] Move rules');
resetGame(4);

const g = api.game;
// fresh board: only a 6 can bring a token out
check('from base: only 6 allowed', api.legalMoves(g.active[0], 5).length === 0 &&
  api.legalMoves(g.active[0], 6).length === 4);

// on track: exact count required
g.tokens[0] = [56, -1, -1, -1]; // one token 1 step from home
check('exact roll needed for home (2 = illegal)', api.legalMoves(0, 2).length === 0);
check('exact roll needed for home (1 = legal)', api.legalMoves(0, 1).length === 1);

g.tokens[0] = [51, -1, -1, -1];
check('51 + 6 reaches centre (legal)',
  api.legalMoves(0, 6).some(m => m.t === 0) &&
  api.legalMoves(0, 6).length === 4, // 1 track move + 3 base entries
  'got ' + api.legalMoves(0, 6).length);
check('51 + 5 falls short (legal)',
  api.legalMoves(0, 5).length === 1 &&
  api.legalMoves(0, 5).some(m => m.t === 0));

g.tokens[0] = [57, 57, 57, -1];
check('home tokens cannot move', api.legalMoves(0, 6).every(m => m.t === 3));

g.tokens[0] = [57, 57, 57, 57];
check('no moves when all home', api.legalMoves(0, 6).length === 0);

// three sixes forfeits the turn
resetGame(4);
const idxBefore = g.idx;
g.phase = 'roll';
api.handleRoll(6);           // six #1
g.phase = 'roll';
api.handleRoll(6);           // six #2
g.phase = 'roll';
api.handleRoll(6);           // six #3 -> forfeit
flush();
check('three sixes forfeits the turn',
  g.idx !== idxBefore && g.sixes === 0,
  'idx ' + idxBefore + '->' + g.idx + ' sixes=' + g.sixes);

/* ================= 3. full random games ================= */
console.log('\n[3] Full game simulations');

function playGame (playerCount) {
  resetGame(playerCount);
  g.phase = 'roll';
  let turns = 0, captures = 0, sixes = 0;

  while (g.phase !== 'over') {
    flush();
    if (g.phase === 'over') break;

    if (g.phase === 'roll') {
      const v = 1 + Math.floor(Math.random() * 6);
      if (v === 6) sixes++;
      const before = g.tokens.map(a => a.slice());
      api.handleRoll(v);
      flush();
      // count captures that happened during the turn resolution
      // (opponent token returned to base)
      for (let p = 0; p < 4; p++) {
        if (!g.active.includes(p)) continue;
        for (let t = 0; t < 4; t++) {
          if (before[p] && before[p][t] >= 0 && g.tokens[p][t] === -1) captures++;
        }
      }
      turns++;
    } else if (g.phase === 'select') {
      const m = g.movable[Math.floor(Math.random() * g.movable.length)];
      api.performMove(m);
      flush();
    } else if (g.phase === 'wait' || g.phase === 'moving') {
      flush();
    } else {
      throw new Error('unexpected phase: ' + g.phase);
    }
    if (turns > 3000) throw new Error('game did not finish in 3000 turns');
  }

  const winner = g.active.find(p => g.tokens[p].every(x => x === api.HOME));
  return { winner, turns, captures, sixes };
}

let allValid = true;
let totalTurns = 0, totalCaps = 0;
const runs = 60;
for (let i = 0; i < runs; i++) {
  const n = [2, 3, 4][i % 3];
  try {
    const res = playGame(n);
    totalTurns += res.turns;
    totalCaps += res.captures;
    const homeCount = g.tokens[res.winner].filter(x => x === api.HOME).length;
    if (homeCount !== 4) { allValid = false; console.log('  winner not complete!'); }
    // no token may be out of range
    for (const p of g.active) {
      for (const rel of g.tokens[p]) {
        if (rel < -1 || rel > api.HOME) { allValid = false; console.log('  bad rel ' + rel); }
      }
    }
  } catch (e) {
    allValid = false;
    console.log('  game error: ' + e.message);
  }
}
check(runs + ' random games finish with a valid winner', allValid);
check('captures happen in simulation', totalCaps > 0, 'captured ' + totalCaps + ' times');
console.log('        avg turns/game: ' + Math.round(totalTurns / runs) +
            ', total captures: ' + totalCaps);

/* ================= result ================= */
console.log('\n' + (failures ? failures + ' FAILURE(S)' : 'All tests passed.'));
process.exit(failures ? 1 : 0);
