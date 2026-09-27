/* ============================================================
   Ludo — local pass & play (2–4 players)
   ============================================================ */

/* ---------- Board data ---------- */

// The 52 squares of the outer track, in clockwise order [row, col]
const PATH = [
  [6,0],[6,1],[6,2],[6,3],[6,4],[6,5],
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
  [0,7],
  [0,8],[1,8],[2,8],[3,8],[4,8],[5,8],
  [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  [7,14],
  [8,14],[8,13],[8,12],[8,11],[8,10],[8,9],
  [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  [14,7],
  [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],
  [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  [7,0]
];

// Safe squares (4 start squares + 4 stars), as indexes into PATH
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// A token's relative position ("rel"):
//   -1        in base
//   0..51     on the outer track (0 = own start square)
//   52..56    in own home column (5 squares)
//   57        home (the centre)
const HOME = 57;

const DEF = [
  { key: 'red',    label: 'Red',    color: '#e53935', start: 0,  base: [0,0], arrow: '\u2192',
    home: [[7,1],[7,2],[7,3],[7,4],[7,5]],     centre: [7, 6.45] },
  { key: 'green',  label: 'Green',  color: '#43a047', start: 13, base: [0,9], arrow: '\u2193',
    home: [[1,7],[2,7],[3,7],[4,7],[5,7]],     centre: [6.45, 7] },
  { key: 'yellow', label: 'Yellow', color: '#fbc02d', start: 26, base: [9,9], arrow: '\u2190',
    home: [[7,13],[7,12],[7,11],[7,10],[7,9]], centre: [7, 7.55] },
  { key: 'blue',   label: 'Blue',   color: '#1e88e5', start: 39, base: [9,0], arrow: '\u2191',
    home: [[13,7],[12,7],[11,7],[10,7],[9,7]], centre: [7.55, 7] }
];

// Token slots inside a base (offsets from the base's top-left corner)
const BASE_SLOTS = [[1.5,1.5],[1.5,4.5],[4.5,1.5],[4.5,4.5]];

// Which colours play at each player count (diagonally opposite for 2)
const BY_COUNT = { 2: [0,2], 3: [0,1,2], 4: [0,1,2,3] };

const PIP_MAP = { 1:[4], 2:[0,8], 3:[0,4,8], 4:[0,2,6,8], 5:[0,2,4,6,8], 6:[0,2,3,5,6,8] };

/* ---------- DOM ---------- */
const board     = document.getElementById('board');
const cellsEl   = document.getElementById('cells');
const decoEl    = document.getElementById('deco');
const tokensEl  = document.getElementById('tokens');
const diceEl    = document.getElementById('dice');
const pipsEl    = diceEl.querySelector('.pips');
const rollBtn   = document.getElementById('rollBtn');
const msgEl     = document.getElementById('message');
const turnCard  = document.getElementById('turnCard');
const turnDot   = document.getElementById('turnDot');
const turnName  = document.getElementById('turnName');
const listEl    = document.getElementById('playerList');
const startScreen = document.getElementById('startScreen');
const winScreen   = document.getElementById('winScreen');
const rulesScreen = document.getElementById('rulesScreen');
const nameFields  = document.getElementById('nameFields');
const countSeg    = document.getElementById('countSeg');
const soundBtn    = document.getElementById('soundBtn');

/* ---------- State ---------- */
const game = {
  active: [],        // player indexes taking part
  idx: 0,            // whose turn (index into active)
  phase: 'idle',     // idle | roll | rolling | select | moving | wait | over
  dice: null,
  sixes: 0,          // consecutive sixes this turn
  movable: [],       // legal moves while phase === 'select'
  pending: null,     // token currently being resolved
  names: {},
  tokens: [[],[],[],[]]
};

let tokenEls = [[],[],[],[]];
let cardEls  = [];
let timers = [];
let stepIv = null;
let rollIv = null;
let soundOn = true;
let chosenCount = 4;

const cur = () => game.active[game.idx];
const nameOf = p => game.names[p] || DEF[p].label;

function later (fn, ms) { timers.push(setTimeout(fn, ms)); }
function clearTimers () {
  timers.forEach(clearTimeout); timers = [];
  if (stepIv) { clearInterval(stepIv); stepIv = null; }
  if (rollIv) { clearInterval(rollIv); rollIv = null; }
}

/* ---------- Sound (tiny WebAudio blips, no files) ---------- */
let actx = null;
function tone (freq, dur, type, gain, delay) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator();
    const g = actx.createGain();
    const t0 = actx.currentTime + (delay || 0);
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.05, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  } catch (e) { /* audio not available */ }
}
const soundCapture = () => { tone(240, .16, 'sawtooth', .06); tone(150, .22, 'sawtooth', .06, .12); };
const soundHome    = () => { tone(523, .09, 'triangle', .06); tone(659, .09, 'triangle', .06, .09); tone(784, .14, 'triangle', .06, .18); };
const soundWin     = () => { [523,659,784,1047,784,1047].forEach((f,i)=>tone(f, .18, 'triangle', .07, i*.13)); };

/* ---------- Board construction ---------- */
function baseOf (r, c) {
  if (r < 6 && c < 6) return 0;
  if (r < 6 && c > 8) return 1;
  if (r > 8 && c > 8) return 2;
  if (r > 8 && c < 6) return 3;
  return -1;
}

function buildBoard () {
  const pathIdx = {};
  PATH.forEach(([r,c], i) => pathIdx[r * 15 + c] = i);

  const startAt = {};
  DEF.forEach((d, p) => startAt[d.start] = p);

  const homeAt = {};
  DEF.forEach((d, p) => d.home.forEach(([r,c]) => homeAt[r * 15 + c] = p));

  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const key = r * 15 + c;
      const el = document.createElement('div');
      el.className = 'cell';

      const b = baseOf(r, c);
      const inCentre = r >= 6 && r <= 8 && c >= 6 && c <= 8;

      if (b >= 0) {
        el.classList.add('base', 'base-' + DEF[b].key);
      } else if (!inCentre && key in pathIdx) {
        el.classList.add('track');
        const gi = pathIdx[key];
        const sp = startAt[gi];
        if (sp !== undefined) {
          el.classList.add('start', 'start-' + DEF[sp].key);
          el.innerHTML = '<span class="arrow">' + DEF[sp].arrow + '</span>';
        } else if (SAFE.has(gi)) {
          el.classList.add('star');
          el.textContent = '\u2605';
        }
      } else if (key in homeAt) {
        const p = homeAt[key];
        el.classList.add('home', 'home-' + DEF[p].key);
      }

      cellsEl.appendChild(el);
    }
  }
}

function buildDeco () {
  // white rounded squares inside each base
  DEF.forEach(d => {
    const [br, bc] = d.base;
    const inner = document.createElement('div');
    inner.className = 'base-inner';
    inner.style.left   = ((bc + 1) / 15 * 100) + '%';
    inner.style.top    = ((br + 1) / 15 * 100) + '%';
    inner.style.width  = (4 / 15 * 100) + '%';
    inner.style.height = (4 / 15 * 100) + '%';
    decoEl.appendChild(inner);
  });

  // centre triangle
  const centre = document.createElement('div');
  centre.className = 'centre';
  centre.style.left = (6 / 15 * 100) + '%';
  centre.style.top = (6 / 15 * 100) + '%';
  centre.style.width = (3 / 15 * 100) + '%';
  centre.style.height = (3 / 15 * 100) + '%';
  ['red','green','yellow','blue'].forEach(k => {
    const t = document.createElement('div');
    t.className = 'tri tri-' + k;
    centre.appendChild(t);
  });
  decoEl.appendChild(centre);
}

function buildPips () {
  for (let i = 0; i < 9; i++) pipsEl.appendChild(document.createElement('i'));
}
function setFace (v) {
  const on = PIP_MAP[v] || [];
  [...pipsEl.children].forEach((el, i) => {
    el.className = on.includes(i) ? 'on' : 'off';
  });
}
function showDice (v) {
  if (v == null) {
    diceEl.classList.add('idle');
    [...pipsEl.children].forEach(el => el.className = 'off');
  } else {
    diceEl.classList.remove('idle');
    setFace(v);
  }
}

/* ---------- Tokens ---------- */
function cellPos (p, rel, t) {
  if (rel === -1) {
    const [br, bc] = DEF[p].base;
    return [br + BASE_SLOTS[t][0], bc + BASE_SLOTS[t][1]];
  }
  if (rel <= 51) return PATH[(DEF[p].start + rel) % 52];
  if (rel <= 56) return DEF[p].home[rel - 52];
  return DEF[p].centre;
}

function buildTokens () {
  tokensEl.innerHTML = '';
  tokenEls = [[],[],[],[]];
  game.active.forEach(p => {
    for (let t = 0; t < 4; t++) {
      const el = document.createElement('div');
      el.className = 'token ' + DEF[p].key;
      el.innerHTML = '<span class="core"></span>';
      el.addEventListener('click', () => {
        if (game.phase !== 'select') return;
        const m = game.movable.find(x => x.p === p && x.t === t);
        if (m) performMove(m);
      });
      tokensEl.appendChild(el);
      tokenEls[p][t] = el;
    }
  });
}

function renderTokens () {
  if (!game.active.length) return;
  const cell = board.clientWidth / 15;
  if (!cell) return;

  const items = [];
  game.active.forEach(p => {
    for (let t = 0; t < 4; t++) {
      const rel = game.tokens[p][t];
      if (rel === undefined) continue;
      const [r, c] = cellPos(p, rel, t);
      items.push({ p, t, rel, key: r.toFixed(3) + '_' + c.toFixed(3), r, c });
    }
  });

  const groups = {};
  items.forEach(it => (groups[it.key] = groups[it.key] || []).push(it));

  items.forEach(it => {
    const g = groups[it.key];
    const n = g.length;
    const i = g.indexOf(it);
    let dx = 0, dy = 0;
    if (n > 1) {
      const atHome = it.rel === HOME;
      const radius = atHome ? Math.min(cell * 0.11 * n, cell * 0.26) : Math.min(cell * 0.15, 7);
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      dx = Math.cos(ang) * radius;
      dy = Math.sin(ang) * radius;
    }
    const size = (it.rel === HOME ? 0.58 : 0.74) * cell;
    const x = (it.c + 0.5) * cell + dx - size / 2;
    const y = (it.r + 0.5) * cell + dy - size / 2;
    const el = tokenEls[it.p][it.t];
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  });
}

function hopToken (p, t) {
  const el = tokenEls[p][t];
  el.classList.remove('hop');
  void el.offsetWidth;
  el.classList.add('hop');
}

/* ---------- Messages / UI ---------- */
function msg (text) {
  msgEl.textContent = text;
  msgEl.classList.remove('pop');
  void msgEl.offsetWidth;
  msgEl.classList.add('pop');
}

function buildCards () {
  listEl.innerHTML = '';
  cardEls = game.active.map(p => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML =
      '<span class="chip" style="background:' + DEF[p].color + '"></span>' +
      '<span class="pname"></span>' +
      '<span class="pcount">0/4 home</span>';
    card.querySelector('.pname').textContent = nameOf(p);
    listEl.appendChild(card);
    return card;
  });
}

function updateUI () {
  if (!game.active.length) return;
  const p = cur();
  turnCard.style.borderLeftColor = DEF[p].color;
  turnDot.style.background = DEF[p].color;
  turnName.textContent = nameOf(p);

  game.active.forEach((pp, i) => {
    const card = cardEls[i];
    if (!card) return;
    card.classList.toggle('active', pp === p);
    const homes = game.tokens[pp].filter(x => x === HOME).length;
    card.querySelector('.pcount').textContent = homes + '/4 home';
  });

  rollBtn.disabled = game.phase !== 'roll';

  game.active.forEach(pp => {
    for (let t = 0; t < 4; t++) {
      const el = tokenEls[pp][t];
      if (!el) continue;
      const pickable = game.phase === 'select' &&
        game.movable.some(m => m.p === pp && m.t === t);
      el.classList.toggle('selectable', pickable);
    }
  });
}

/* ---------- Rules engine ---------- */
function legalMoves (p, v) {
  const out = [];
  for (let t = 0; t < 4; t++) {
    const r = game.tokens[p][t];
    if (r === HOME) continue;
    if (r === -1) { if (v === 6) out.push({ p, t, steps: 1 }); continue; }
    if (r + v <= HOME) out.push({ p, t, steps: v });
  }
  return out;
}

/* ---------- Turn flow ---------- */
function rollDice () {
  if (game.phase !== 'roll' || !game.active.length) return;
  game.phase = 'rolling';
  updateUI();
  diceEl.classList.add('rolling');

  let ticks = 0;
  rollIv = setInterval(() => {
    setFace(1 + Math.floor(Math.random() * 6));
    tone(260 + Math.random() * 180, .045, 'square', .035);
    if (++ticks >= 9) {
      clearInterval(rollIv); rollIv = null;
      diceEl.classList.remove('rolling');
      const v = 1 + Math.floor(Math.random() * 6);
      showDice(v);
      tone(540, .1, 'triangle', .05);
      handleRoll(v);
    }
  }, 85);
}

function handleRoll (v) {
  const p = cur();
  game.dice = v;
  game.sixes = (v === 6) ? game.sixes + 1 : 0;

  if (game.sixes >= 3) {
    game.sixes = 0;
    game.phase = 'wait';
    msg(nameOf(p) + ' rolled three 6s \u2014 turn forfeited!');
    updateUI();
    later(nextTurn, 1400);
    return;
  }

  const moves = legalMoves(p, v);
  if (!moves.length) {
    game.phase = 'wait';
    msg(nameOf(p) + ' rolled ' + v + ' \u2014 no legal move.');
    updateUI();
    later(nextTurn, 1100);
    return;
  }

  if (moves.length === 1) {
    game.phase = 'wait';
    msg(nameOf(p) + ' rolled ' + v + '.');
    updateUI();
    later(() => performMove(moves[0]), 550);
    return;
  }

  game.movable = moves;
  game.phase = 'select';
  msg(nameOf(p) + ' rolled ' + v + ' \u2014 choose a token.');
  updateUI();
}

function performMove (m) {
  const p = cur();
  game.phase = 'moving';
  game.movable = [];
  game.pending = m.t;
  updateUI();

  // coming out of the base: one hop onto the start square
  if (game.tokens[p][m.t] === -1) {
    game.tokens[p][m.t] = 0;
    renderTokens();
    hopToken(p, m.t);
    tone(700, .1, 'triangle', .05);
    later(resolve, 340);
    return;
  }

  let done = 0;
  stepIv = setInterval(() => {
    game.tokens[p][m.t]++;
    hopToken(p, m.t);
    tone(580 + done * 30, .05, 'triangle', .04);
    renderTokens();
    if (++done >= m.steps) {
      clearInterval(stepIv); stepIv = null;
      later(resolve, 240);
    }
  }, 165);
}

function resolve () {
  const p = cur();
  const t = game.pending;
  const rel = game.tokens[p][t];
  let text = null;

  // captures (not on safe squares)
  if (rel <= 51) {
    const g = (DEF[p].start + rel) % 52;
    if (!SAFE.has(g)) {
      const hit = [];
      game.active.forEach(q => {
        if (q === p) return;
        for (let k = 0; k < 4; k++) {
          const rq = game.tokens[q][k];
          if (rq >= 0 && rq <= 51 && (DEF[q].start + rq) % 52 === g) {
            game.tokens[q][k] = -1;
            hit.push(q);
          }
        }
      });
      if (hit.length) {
        renderTokens();
        soundCapture();
        text = nameOf(p) + ' captured ' + nameOf(hit[0]) + "'s token!";
      }
    }
  }

  if (rel === HOME) {
    soundHome();
    text = nameOf(p) + ' got a token home!';
  }

  if (game.tokens[p].every(x => x === HOME)) { win(p); return; }

  // rolling a 6 grants another roll
  if (game.dice === 6) {
    msg(text || ('Six! ' + nameOf(p) + ' rolls again.'));
    game.phase = 'roll';
    game.pending = null;
    updateUI();
    return;
  }

  if (text) {
    msg(text);
    later(nextTurn, 1000);
  } else {
    later(nextTurn, 260);
  }
}

function nextTurn () {
  game.sixes = 0;
  game.dice = null;
  game.movable = [];
  game.pending = null;
  game.idx = (game.idx + 1) % game.active.length;
  game.phase = 'roll';
  showDice(null);
  updateUI();
  msg(nameOf(cur()) + "'s turn \u2014 roll the dice.");
}

function win (p) {
  clearTimers();
  game.phase = 'over';
  game.pending = null;
  updateUI();
  soundWin();
  document.getElementById('winTitle').textContent = nameOf(p) + ' wins!';
  winScreen.classList.remove('hidden');
}

/* ---------- Start / reset ---------- */
function buildNameFields (n) {
  nameFields.innerHTML = '';
  BY_COUNT[n].forEach(p => {
    const row = document.createElement('div');
    row.className = 'name-row';
    row.innerHTML =
      '<span class="chip" style="background:' + DEF[p].color + '"></span>';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 16;
    input.value = DEF[p].label;
    input.placeholder = DEF[p].label;
    input.dataset.p = p;
    row.appendChild(input);
    nameFields.appendChild(row);
  });
}

function startGame () {
  clearTimers();
  game.active = BY_COUNT[chosenCount].slice();
  game.names = {};
  nameFields.querySelectorAll('input').forEach(inp => {
    const p = +inp.dataset.p;
    game.names[p] = inp.value.trim() || DEF[p].label;
  });
  game.tokens = [[],[],[],[]];
  game.active.forEach(p => game.tokens[p] = [-1,-1,-1,-1]);
  game.idx = 0;
  game.phase = 'roll';
  game.dice = null;
  game.sixes = 0;
  game.movable = [];
  game.pending = null;

  buildTokens();
  buildCards();
  renderTokens();
  showDice(null);
  updateUI();
  msg(nameOf(cur()) + "'s turn \u2014 roll the dice.");
  startScreen.classList.add('hidden');
}

function openStartScreen () {
  clearTimers();
  game.phase = 'idle';
  winScreen.classList.add('hidden');
  rulesScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
}

/* ---------- Wiring ---------- */
rollBtn.addEventListener('click', rollDice);
diceEl.addEventListener('click', rollDice);
diceEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); rollDice(); }
});

document.addEventListener('keydown', e => {
  if (e.code !== 'Space') return;
  if (!startScreen.classList.contains('hidden')) return;
  if (!winScreen.classList.contains('hidden')) return;
  if (!rulesScreen.classList.contains('hidden')) return;
  e.preventDefault();
  rollDice();
});

countSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  chosenCount = +b.dataset.n;
  [...countSeg.children].forEach(x => x.classList.toggle('active', x === b));
  buildNameFields(chosenCount);
});

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('againBtn').addEventListener('click', openStartScreen);
document.getElementById('newGameBtn').addEventListener('click', openStartScreen);
document.getElementById('rulesBtn').addEventListener('click', () => rulesScreen.classList.remove('hidden'));
document.getElementById('closeRules').addEventListener('click', () => rulesScreen.classList.add('hidden'));

soundBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  soundBtn.textContent = soundOn ? '\uD83D\uDD0A' : '\uD83D\uDD07';
  soundBtn.classList.toggle('muted', !soundOn);
  if (soundOn) tone(660, .09, 'triangle', .05);
});

window.addEventListener('resize', renderTokens);

/* ---------- Init ---------- */
buildBoard();
buildDeco();
buildPips();
buildNameFields(chosenCount);
showDice(null);
msg('Set up your game to begin!');
