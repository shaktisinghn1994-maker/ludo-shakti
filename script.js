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
  { key: 'red',    label: 'Red',    color: '#c62828', lite: '#e05252', start: 0,  base: [0,0], arrow: '\u2192',
    home: [[7,1],[7,2],[7,3],[7,4],[7,5]],     centre: [7, 6.45] },
  { key: 'green',  label: 'Green',  color: '#0f8a5f', lite: '#2fb184', start: 13, base: [0,9], arrow: '\u2193',
    home: [[1,7],[2,7],[3,7],[4,7],[5,7]],     centre: [6.45, 7] },
  { key: 'yellow', label: 'Yellow', color: '#d99b1c', lite: '#f0bb4b', start: 26, base: [9,9], arrow: '\u2190',
    home: [[7,13],[7,12],[7,11],[7,10],[7,9]], centre: [7, 7.55] },
  { key: 'blue',   label: 'Blue',   color: '#1a5fc4', lite: '#4b8ae6', start: 39, base: [9,0], arrow: '\u2191',
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

/* Haptic micro-feedback — follows the sound toggle, and quietly does nothing
   on devices/browsers that do not expose the Vibration API. */
/* Haptic micro-feedback — follows the sound toggle, and quietly does nothing
   on devices/browsers that do not expose the Vibration API. Chrome also
   refuses to vibrate before a real user gesture, so we arm ourselves on the
   first pointer/key interaction and stay silent until then. */
let hapticsArmed = false;
if (typeof document !== 'undefined' && document.addEventListener) {
  const arm = () => { hapticsArmed = true; };
  document.addEventListener('pointerdown', arm, true);
  document.addEventListener('keydown', arm, true);
}
function buzz (pattern) {
  if (!soundOn || !hapticsArmed) return;
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch (e) { /* not permitted */ }
}

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
  // full-quadrant sheen: soft depth + subtle texture over each base (painted
  // first so the white inner squares stay above it)
  DEF.forEach(d => {
    const [br, bc] = d.base;
    const q = document.createElement('div');
    q.className = 'quad quad-' + d.key;
    q.style.left   = (bc / 15 * 100) + '%';
    q.style.top    = (br / 15 * 100) + '%';
    q.style.width  = (6 / 15 * 100) + '%';
    q.style.height = (6 / 15 * 100) + '%';
    decoEl.appendChild(q);
  });

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
    diceEl.classList.remove('landed');
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

// Chess-king silhouette used for every token (fill = currentColor, so the
// player's colour comes from the .token.red/.green/.yellow/.blue class).
// Drawn tall and slender in a tight 64x68 box so the piece fills its cell.
const KING_SHAPES =
  '<path d="M29 1h6v4h6v5h-6v5h-6V10h-6V5h6z"/>' +                 /* cross */
  '<path d="M17 34C19 28 22 23 24 18l3 7 5-10 5 10 3-7c3 5 6 10 8 16z"/>' + /* crown */
  '<rect x="19" y="33" width="26" height="5" rx="1.5"/>' +         /* collar */
  '<path d="M24 38h16c0 7 3 12 6 19H18c3-7 6-12 6-19z"/>' +        /* body */
  '<rect x="14" y="56" width="36" height="9" rx="3"/>';           /* base */

// Three passes: flat colour, a light->dark sheen, then the outline on top so
// the part divisions stay crisp. Each token gets its own gradient id.
let kingSeq = 0;
function kingSVG () {
  const id = 'kingShade' + (kingSeq++);
  return '<svg class="king" viewBox="0 0 64 68" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<defs><linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" ' +
      'x1="12" y1="1" x2="52" y2="66">' +
      '<stop offset="0" stop-color="#fff" stop-opacity=".55"/>' +
      '<stop offset=".32" stop-color="#fff" stop-opacity=".12"/>' +
      '<stop offset=".62" stop-color="#000" stop-opacity="0"/>' +
      '<stop offset="1" stop-color="#000" stop-opacity=".42"/>' +
    '</linearGradient></defs>' +
    '<g fill="currentColor">' + KING_SHAPES + '</g>' +
    '<g fill="url(#' + id + ')">' + KING_SHAPES + '</g>' +
    '<g fill="none" stroke="rgba(0,0,0,.5)" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">' +
      KING_SHAPES + '</g>' +
  '</svg>';
}

function buildTokens () {
  tokensEl.innerHTML = '';
  tokenEls = [[],[],[],[]];
  game.active.forEach(p => {
    for (let t = 0; t < 4; t++) {
      const el = document.createElement('div');
      el.className = 'token ' + DEF[p].key;
      el.innerHTML = '<span class="core">' + kingSVG() + '</span>';
      el.addEventListener('click', () => {
        if (game.phase !== 'select') return;
        const m = game.movable.find(x => x.p === p && x.t === t);
        if (m) { buzz(8); performMove(m); }
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
    el.classList.toggle('in-base', it.rel === -1);
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

/* progress ring geometry (viewBox 46x46, r=19) */
const RING_R = 19;
const RING_C = 2 * Math.PI * RING_R;

function buildCards () {
  listEl.innerHTML = '';
  cardEls = game.active.map(p => {
    const card = document.createElement('div');
    card.className = 'player-card';
    const d = DEF[p];
    const initial = (nameOf(p) || d.label).trim().charAt(0).toUpperCase();
    card.innerHTML =
      '<span class="avatar" style="--pc:' + d.color + ';--pc2:' + d.lite + '">' +
        '<svg class="ring" viewBox="0 0 46 46" aria-hidden="true">' +
          '<circle class="ring-track" cx="23" cy="23" r="' + RING_R + '"></circle>' +
          '<circle class="ring-fill"  cx="23" cy="23" r="' + RING_R + '"></circle>' +
          '<circle class="ring-timer" cx="23" cy="23" r="' + RING_R + '"></circle>' +
        '</svg>' +
        '<span class="disc">' + initial + '</span>' +
      '</span>' +
      '<span class="pinfo">' +
        '<span class="pname"></span>' +
        '<span class="pstat">In base</span>' +
      '</span>' +
      '<span class="pcount">0/4</span>';

    const refs = {
      name:  card.querySelector('.pname'),
      stat:  card.querySelector('.pstat'),
      count: card.querySelector('.pcount'),
      fill:  card.querySelector('.ring-fill'),
      timer: card.querySelector('.ring-timer')
    };
    refs.name.textContent = nameOf(p);
    refs.fill.style.strokeDasharray = RING_C.toFixed(2);
    refs.fill.style.strokeDashoffset = RING_C.toFixed(2);
    refs.timer.style.strokeDasharray = RING_C.toFixed(2);
    refs.timer.style.strokeDashoffset = RING_C.toFixed(2);
    refs.timer.style.opacity = 0;
    card._r = refs;

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

  // subtle crossfade whenever the turn actually changes
  if (turnCard._last !== p) {
    turnCard._last = p;
    turnCard.classList.remove('turn-swap');
    void turnCard.offsetWidth;
    turnCard.classList.add('turn-swap');
    turnDot.style.transform = 'scale(1.35)';
    later(() => { turnDot.style.transform = ''; }, 320);
  }

  game.active.forEach((pp, i) => {
    const card = cardEls[i];
    if (!card) return;
    card.classList.toggle('active', pp === p);
    const r = card._r;
    if (!r) return;
    const homes = game.tokens[pp].filter(x => x === HOME).length;
    const outs  = game.tokens[pp].filter(x => x >= 0 && x !== HOME).length;
    r.count.textContent = homes + '/4';
    r.fill.style.strokeDashoffset = (RING_C * (1 - homes / 4)).toFixed(1);
    r.stat.textContent = homes === 4 ? 'All home \uD83C\uDFC6'
      : outs > 0 ? outs + (outs === 1 ? ' running' : ' running')
      : 'In base';
    r.count.title = homes + ' of 4 tokens home';
  });

  rollBtn.disabled = game.phase !== 'roll';
  diceEl.classList.toggle('ready', game.phase === 'roll' || game.phase === 'rolling');

  game.active.forEach(pp => {
    for (let t = 0; t < 4; t++) {
      const el = tokenEls[pp][t];
      if (!el) continue;
      const pickable = game.phase === 'select' &&
        game.movable.some(m => m.p === pp && m.t === t);
      el.classList.toggle('selectable', pickable);
    }
  });

  resetTurnTimer();
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
  buzz(10);

  let ticks = 0;
  rollIv = setInterval(() => {
    setFace(1 + Math.floor(Math.random() * 6));
    tone(260 + Math.random() * 180, .045, 'square', .035);
    if (++ticks >= 9) {
      clearInterval(rollIv); rollIv = null;
      diceEl.classList.remove('rolling');
      const v = 1 + Math.floor(Math.random() * 6);
      showDice(v);
      diceEl.classList.add('landed');
      later(() => diceEl.classList.remove('landed'), 540);
      buzz(6);
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
      const knocked = [];
      game.active.forEach(q => {
        if (q === p) return;
        for (let k = 0; k < 4; k++) {
          const rq = game.tokens[q][k];
          if (rq >= 0 && rq <= 51 && (DEF[q].start + rq) % 52 === g) {
            const pos = cellXY(q, rq, k);
            if (pos) knocked.push(Object.assign({ q, k }, pos));
            game.tokens[q][k] = -1;
            hit.push(q);
          }
        }
      });
      if (hit.length) {
        renderTokens();
        knocked.forEach(b => captureFX(b.q, b.k, b));
        soundCapture();
        buzz([14, 45, 14]);
        text = nameOf(p) + ' captured ' + nameOf(hit[0]) + "'s token!";
      }
    }
  }

  if (rel === HOME) {
    soundHome();
    buzz(16);
    const home = cellXY(p, HOME, t);
    if (home) fxBurst(home.x, home.y, DEF[p].color, 34);
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
  buzz([25, 60, 25]);
  fxRain(180);
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
  clearTurnTimer();
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

function toggleSound () {
  soundOn = !soundOn;
  prefs.sound = soundOn;
  savePrefs();
  syncSoundUI();
  if (soundOn) tone(660, .09, 'triangle', .05);
}

soundBtn.addEventListener('click', toggleSound);

/* ---------- Settings (theme / sound / turn timer) ---------- */
const settingsPop = document.getElementById('settingsPop');
const settingsBtn = document.getElementById('settingsBtn');
const themeSeg    = document.getElementById('themeSeg');
const timerSeg    = document.getElementById('timerSeg');
const soundSwitch = document.getElementById('soundSwitch');
const rootEl      = document.documentElement || null;

/* localStorage may be unavailable (tests / private mode) — keep everything in
   memory so a failed read/write never breaks the game. */
const prefs = (() => {
  let saved = {};
  try { saved = JSON.parse(window.localStorage.getItem('ludo.prefs') || '{}') || {}; }
  catch (e) { saved = {}; }
  return Object.assign({ theme: 'light', sound: true, timer: 0 }, saved);
})();

function savePrefs () {
  try { window.localStorage.setItem('ludo.prefs', JSON.stringify(prefs)); }
  catch (e) { /* ignore */ }
}

function applyTheme (t) {
  prefs.theme = t;
  if (rootEl) {
    if (t === 'dark') rootEl.setAttribute('data-theme', 'dark');
    else rootEl.removeAttribute('data-theme');
  }
  const seg = themeSeg && themeSeg.children ? themeSeg.children : [];
  Array.prototype.forEach.call(seg, b => {
    b.classList.toggle('active', b.dataset.theme === t);
  });
  savePrefs();
}

function syncSoundUI () {
  soundBtn.textContent = soundOn ? '\uD83D\uDD0A' : '\uD83D\uDD07';
  soundBtn.classList.toggle('muted', !soundOn);
  if (soundSwitch) soundSwitch.classList.toggle('on', soundOn);
}

function applyTimer (secs) {
  prefs.timer = +secs;
  const seg = timerSeg && timerSeg.children ? timerSeg.children : [];
  Array.prototype.forEach.call(seg, b => {
    b.classList.toggle('active', +b.dataset.time === +secs);
  });
  savePrefs();
  resetTurnTimer();
}

settingsBtn.addEventListener('click', e => {
  e.stopPropagation();
  const open = settingsPop.classList.contains('hidden');
  settingsPop.classList.toggle('hidden', !open);
  settingsBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', e => {
  if (!settingsPop.classList.contains('hidden') &&
      !(settingsPop.contains && settingsPop.contains(e.target)) &&
      e.target !== settingsBtn) {
    settingsPop.classList.add('hidden');
    settingsBtn.setAttribute('aria-expanded', 'false');
  }
});

themeSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) applyTheme(b.dataset.theme);
});
timerSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) applyTimer(b.dataset.time);
});
soundSwitch.addEventListener('click', toggleSound);

window.addEventListener('resize', () => { renderTokens(); fxResize(); });

/* ---------- Turn timer (opt-in: Settings → Turn timer) ---------- */
let timerIv = null;
let timeLeft = 0;

function paintTimer () {
  const card = cardEls[game.idx];
  if (!card || !card._r || !prefs.timer) return;
  const frac = Math.max(0, Math.min(1, timeLeft / prefs.timer));
  card._r.timer.style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(1);
}

function clearTurnTimer () {
  if (timerIv) { clearInterval(timerIv); timerIv = null; }
  cardEls.forEach(c => {
    if (!c) return;
    c.classList.remove('timing', 'urgent');
    if (c._r && c._r.timer) c._r.timer.style.opacity = 0;
  });
}

function resetTurnTimer () {
  clearTurnTimer();
  if (!prefs.timer || !game.active.length || game.phase !== 'roll') return;
  const card = cardEls[game.idx];
  if (!card || !card._r) return;
  timeLeft = prefs.timer;
  card.classList.add('timing');
  card._r.timer.style.opacity = '';
  paintTimer();
  timerIv = setInterval(() => {
    timeLeft = Math.round((timeLeft - 0.1) * 10) / 10;
    if (timeLeft <= 0) {
      clearTurnTimer();
      if (game.phase === 'roll') {
        msg('Time\u2019s up \u2014 rolling for ' + nameOf(cur()) + '!');
        rollDice();
      }
      return;
    }
    paintTimer();
    if (timeLeft <= 5) card.classList.add('urgent');
  }, 100);
}

/* ---------- FX: canvas confetti + particles (dependency-free) ---------- */
const fxCanvas = document.getElementById('fx');
const fxCtx = (fxCanvas && typeof fxCanvas.getContext === 'function')
  ? fxCanvas.getContext('2d') : null;
const fxParts = [];
const FX_COLORS = ['#c62828', '#0f8a5f', '#d99b1c', '#1a5fc4', '#ffd54f', '#ffffff'];
let fxRunning = false;
let fxLast = 0;

const raf = fn => (typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame(fn)
  : setTimeout(() => fn(Date.now()), 16));

function fxResize () {
  if (!fxCtx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  fxCanvas.width = Math.max(1, Math.round(w * dpr));
  fxCanvas.height = Math.max(1, Math.round(h * dpr));
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function fxFrame (t) {
  if (!fxCtx) { fxRunning = false; return; }
  const dt = Math.min(50, (t - (fxLast || t)) / 1000) || 0;
  fxLast = t;
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  fxCtx.clearRect(0, 0, w, h);
  for (let i = fxParts.length - 1; i >= 0; i--) {
    const p = fxParts[i];
    p.life -= dt;
    if (p.life <= 0) { fxParts.splice(i, 1); continue; }
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    fxCtx.globalAlpha = Math.max(0, Math.min(1, p.life / p.fade));
    if (p.kind === 'dot') {
      fxCtx.fillStyle = p.color;
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      fxCtx.fill();
    } else {
      fxCtx.save();
      fxCtx.translate(p.x, p.y);
      fxCtx.rotate(p.rot);
      fxCtx.fillStyle = p.color;
      fxCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      fxCtx.restore();
    }
  }
  fxCtx.globalAlpha = 1;
  if (fxParts.length) raf(fxFrame);
  else { fxRunning = false; fxLast = 0; }
}

function fxStart () {
  if (!fxCtx || fxRunning) return;
  fxRunning = true;
  fxLast = 0;
  raf(fxFrame);
}

/* soft burst of dust circles — used when a token is captured */
function fxPoof (x, y, color) {
  if (!fxCtx) return;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 50 + Math.random() * 150;
    fxParts.push({
      kind: 'dot', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, g: 380,
      r: 3.5 + Math.random() * 5,
      life: 0.45 + Math.random() * 0.3, fade: 0.32,
      color: Math.random() < 0.55 ? color : '#ffffff',
      rot: 0, vr: 0, w: 0, h: 0
    });
  }
  fxStart();
}

/* upward confetti pop — used when a token reaches home */
function fxBurst (x, y, color, n) {
  if (!fxCtx) return;
  const count = n || 30;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const sp = 140 + Math.random() * 260;
    fxParts.push({
      kind: 'rect', x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 520,
      w: 7 + Math.random() * 7, h: 10 + Math.random() * 8,
      life: 1.1 + Math.random() * 0.7, fade: 0.6,
      color: FX_COLORS[(Math.random() * FX_COLORS.length) | 0],
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 14
    });
  }
  fxStart();
}

/* full-screen confetti rain — used on a win */
function fxRain (n) {
  if (!fxCtx) return;
  const w = window.innerWidth || 800;
  const count = n || 170;
  for (let i = 0; i < count; i++) {
    fxParts.push({
      kind: 'rect',
      x: Math.random() * w, y: -20 - Math.random() * 220,
      vx: (Math.random() - 0.5) * 90, vy: 130 + Math.random() * 190, g: 90,
      w: 8 + Math.random() * 8, h: 11 + Math.random() * 9,
      life: 3.2 + Math.random() * 2.2, fade: 1.2,
      color: FX_COLORS[(Math.random() * FX_COLORS.length) | 0],
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 11
    });
  }
  fxStart();
}

/* Exact viewport point of a cell, derived from the board grid so it stays
   correct even while the token element is still sliding into place. */
function cellXY (p, rel, t) {
  if (!board || typeof board.getBoundingClientRect !== 'function') return null;
  const rc = cellPos(p, rel, t);
  const b = board.getBoundingClientRect();
  if (!b || !b.width || !rc) return null;
  const cell = b.width / 15;
  return {
    x: b.left + (rc[1] + 0.5) * cell,
    y: b.top + (rc[0] + 0.5) * cell,
    w: cell * 0.74,
    h: cell * 0.74
  };
}

/* capture: poof where it stood + a clone that flies back to the base */
function captureFX (q, k, from) {
  if (!from) return;
  fxPoof(from.x, from.y, DEF[q].color);
  const el = tokenEls[q] && tokenEls[q][k];
  if (!el || typeof el.cloneNode !== 'function' || !document.body) return;
  const to = cellXY(q, -1, k);
  if (!to) return;
  const clone = el.cloneNode(true);
  clone.classList.add('fx-ghost');
  const s = clone.style;
  s.left = (from.x - from.w / 2) + 'px';
  s.top = (from.y - from.h / 2) + 'px';
  s.width = from.w + 'px';
  s.height = from.h + 'px';
  s.opacity = '1';
  s.transform = 'none';
  document.body.appendChild(clone);
  raf(() => {
    s.transform = 'translate(' + (to.x - from.x) + 'px,' + (to.y - from.y) + 'px) scale(.5) rotate(-190deg)';
    s.opacity = '0';
  });
  setTimeout(() => { if (clone.parentNode) clone.parentNode.removeChild(clone); }, 700);
}

/* ---------- Init ---------- */
soundOn = prefs.sound !== false;
applyTheme(prefs.theme === 'dark' ? 'dark' : 'light');
applyTimer(prefs.timer || 0);
syncSoundUI();
fxResize();
buildBoard();
buildDeco();
buildPips();
buildNameFields(chosenCount);
showDice(null);
msg('Set up your game to begin!');
