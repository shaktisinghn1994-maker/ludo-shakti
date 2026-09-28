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

/* Online room state (the "Online rooms" section at the bottom drives it).
   Declared up here so every hook below can safely touch it during load. */
const net = {
  on: false,        // socket open and hello received
  room: false,      // we intend to be in a room (true while connecting too)
  hello: false,
  bye: false,       // we closed the socket on purpose
  role: null,       // 'host' | 'guest'
  code: null,
  token: null,
  seat: -1,         // our seat (== index into game.active)
  p: -1,            // colour index we play
  count: 2,
  seats: [],
  started: false,
  hostDown: false,
  ws: null,
  snap: null,
  q: [],
  busy: false,
  applying: false,  // true while a remote change is being painted locally
  lastErr: '',      // last room-side error (handy when a reload does not come back)
  winShown: false
};

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

/* Cartoon "ha-ha-ha" laugh for a capture — synthesised on the fly, so there is
   still no audio file in the project. Every syllable is a sawtooth pushed
   through a formant band-pass with a steep pitch drop; a detuned square adds
   body, and the phrase descends so it reads as a voice, not a beep. */
function soundLaugh (delay) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t0base = actx.currentTime + (delay || 0);
    const syll = [1.00, 0.93, 0.85, 0.76, 0.65];   // each "ha" a touch lower
    syll.forEach((mul, i) => {
      const t0 = t0base + i * 0.135;
      const dur = 0.17;
      const top = 330 * mul;                        // ~330 Hz → ~215 Hz
      const osc = actx.createOscillator();
      const sub = actx.createOscillator();
      const flt = actx.createBiquadFilter();
      const g   = actx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(top * 1.3, t0);
      osc.frequency.exponentialRampToValueAtTime(top * 0.7, t0 + dur);
      sub.type = 'square';
      sub.frequency.setValueAtTime(top * 0.65, t0);
      sub.frequency.exponentialRampToValueAtTime(top * 0.36, t0 + dur);

      flt.type = 'bandpass';
      flt.frequency.value = 780 + 160 * (1 - mul);   // formant ≈ 780–940 Hz
      flt.Q.value = 3.4;

      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.11, t0 + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

      osc.connect(flt);
      sub.connect(flt);
      flt.connect(g);
      g.connect(actx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.05);
      sub.start(t0); sub.stop(t0 + dur + 0.05);
    });
  } catch (e) { /* audio not available */ }
}

/* Haptic micro-feedback — follows the sound toggle, and quietly does nothing
   on devices/browsers that do not expose the Vibration API. */
/* Haptic micro-feedback — follows the sound toggle, and quietly does nothing
   on devices/browsers that do not expose the Vibration API. Chrome also
   refuses to vibrate before a real user gesture, so we arm ourselves on the
   first pointer/key interaction and stay silent until then. */
let hapticsArmed = false;
if (typeof document !== 'undefined' && document.addEventListener) {
  /* only *real* interaction counts: synthetic events (tests, automations) must
     not arm the vibration API, or Chrome logs a blocked-call warning */
  const arm = e => { if (!e || e.isTrusted !== false) hapticsArmed = true; };
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
        if (!m) return;
        if (net.room && !myTurn()) return;
        if (net.room && net.role === 'guest') { netSend({ t: 'a', a: { k: 'tap', p: p, t: t } }); return; }
        buzz(8);
        performMove(m);
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
  netSync();
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
        '<span class="prow">' +
          '<span class="pname"></span>' +
          '<span class="pedit" title="Edit name">✏️</span>' +
        '</span>' +
        '<span class="pstat">In base</span>' +
      '</span>' +
      '<span class="pcount">0/4</span>';

    if (typeof card.setAttribute === 'function') {
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('title', 'Tap to edit this player\u2019s name');
    }

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

    /* the card doubles as the name editor entry point */
    card.addEventListener('click', () => openRename(p));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        openRename(p);
      }
    });

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

  const myGo = myTurn();
  rollBtn.disabled = game.phase !== 'roll' || !myGo;
  diceEl.classList.toggle('ready', (game.phase === 'roll' || game.phase === 'rolling') && myGo);

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
  if (typeof chatSyncSender === 'function') chatSyncSender();
  netSync();
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
  if (paused) return;
  if (net.room && !myTurn()) { olToast('Waiting for ' + nameOf(cur()) + '…'); return; }
  if (net.room && net.role === 'guest') { netSend({ t: 'a', a: 'roll' }); return; }
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
    game.queued = moves[0];                 // remembered so a pause can resume it
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
  game.queued = null;
  game.resolved = false;
  const from = game.tokens[p][m.t];
  game.currentMove = { p, t: m.t, steps: m.steps, to: (from === -1 ? 0 : from + m.steps) };
  updateUI();
  netEmit({ k: 'mv', p: p, t: m.t, from: from, to: game.currentMove.to });

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
  if (game.resolved) return;                // never resolve the same step twice
  game.resolved = true;
  game.currentMove = null;
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
        soundLaugh(.2);                       // the taunt that follows the thud
        buzz([14, 45, 14]);
        text = nameOf(p) + ' captured ' + nameOf(hit[0]) + "'s token!";
        chatSystem(text);
      }
    }
  }

  if (rel === HOME) {
    soundHome();
    buzz(16);
    const home = cellXY(p, HOME, t);
    if (home) fxBurst(home.x, home.y, DEF[p].color, 34);
    text = nameOf(p) + ' got a token home!';
    chatSystem(text + ' \uD83C\uDF89');
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
  chatSystem(nameOf(p) + ' wins the game! \uD83C\uDFC6');
}

/* ---------- Names: persisted per colour + editor ----------
   Names belong to the colour (Red 0, Green 1, Yellow 2, Blue 3) rather than to
   a single match, so "Shakti" you typed last week is waiting next game too. */
const savedNames = (() => {
  try { return JSON.parse(window.localStorage.getItem('ludo.names') || '{}') || {}; }
  catch (e) { return {}; }
})();

function persistNames () {
  try { window.localStorage.setItem('ludo.names', JSON.stringify(savedNames)); }
  catch (e) { /* private mode / tests */ }
}

function storedName (p) { return savedNames[p] || DEF[p].label; }

/* repaint cards, avatar initials, turn card and the chat "as …" label */
function paintNames () {
  if (!game.active.length) return;
  buildCards();
  updateUI();
}

function setName (p, raw, before) {
  const v = (raw || '').trim().slice(0, 16) || DEF[p].label;
  const from = before !== undefined ? before : (game.names[p] || storedName(p));
  savedNames[p] = v;
  if (game.active.length) game.names[p] = v;
  persistNames();
  const field = nameFields.querySelector('input[data-p="' + p + '"]');
  if (field) field.value = v;
  paintNames();
  if (from !== v) {
    /* keep the status line honest: "Red's turn" -> "Shakti's turn" */
    const line = msgEl && msgEl.textContent;
    if (line && line.indexOf(from) >= 0) msgEl.textContent = line.split(from).join(v);
    chatSystem(from + ' is now ' + v);
    if (net.on && !net.applying) netSend({ t: 'rename', p: p, v: v });
  }
}

/* ---------- Name editor modal ---------- */
const renameModal = document.getElementById('renameModal');
const renameChips = document.getElementById('renameChips');
const renameInput = document.getElementById('renameInput');
const renameDot   = document.getElementById('renameDot');
let renameSel = null;
let renameStaged = {};   // p -> text typed but not saved yet
let renameOrig = {};     // p -> value before this editing session

function renameRoster () {
  return game.active.length ? game.active.slice() : BY_COUNT[chosenCount].slice();
}
function renameValue (p) {
  return renameStaged[p] !== undefined ? renameStaged[p] : (game.names[p] || storedName(p));
}

function buildRenameChips () {
  if (!renameChips) return;
  renameChips.innerHTML = '';
  renameRoster().forEach(p => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rename-chip' + (p === renameSel ? ' active' : '');
    b.dataset.p = p;
    b.innerHTML = '<i style="background:' + DEF[p].color + '"></i><span></span>';
    const label = b.querySelector('span');
    if (label) label.textContent = renameValue(p) || DEF[p].label;
    b.addEventListener('click', () => selectRename(p));
    renameChips.appendChild(b);
  });
}

/* live preview: the card, turn card and chat label update as you type */
function previewRename (p) {
  const v = (renameValue(p) || '').trim() || DEF[p].label;
  if (game.active.length) { game.names[p] = v; paintNames(); }
  const field = nameFields.querySelector('input[data-p="' + p + '"]');
  if (field) field.value = v;
}

function selectRename (p) {
  renameSel = p;
  const d = DEF[p];
  if (renameDot) renameDot.style.background = d.color;
  if (renameInput) {
    renameInput.value = renameValue(p) || '';
    renameInput.placeholder = d.label;
    if (typeof renameInput.focus === 'function') renameInput.focus();
    if (typeof renameInput.select === 'function') renameInput.select();
  }
  if (renameChips) Array.prototype.forEach.call(renameChips.children, c => {
    c.classList.toggle('active', +c.dataset.p === p);
  });
}

function openRename (p) {
  if (!renameModal) return;
  renameStaged = {};
  renameOrig = {};
  renameSel = null;
  renameRoster().forEach(q => { renameOrig[q] = game.names[q]; });
  buildRenameChips();
  selectRename(typeof p === 'number' ? p : renameRoster()[0]);
  renameModal.classList.remove('hidden');
  clearTurnTimer();
  if (settingsPop) {
    settingsPop.classList.add('hidden');
    settingsBtn.setAttribute('aria-expanded', 'false');
  }
}

function closeRename () {
  if (!renameModal) return;
  renameModal.classList.add('hidden');
  renameStaged = {};
  renameSel = null;
  resetTurnTimer();
}

function saveRename () {
  const staged = renameStaged;
  const keys = Object.keys(staged);
  keys.forEach(k => setName(+k, staged[k], renameOrig[+k]));
  closeRename();
}

function cancelRename () {
  const keys = Object.keys(renameStaged);
  keys.forEach(k => {
    const p = +k;
    const back = renameOrig[p];
    if (back !== undefined && game.active.length) game.names[p] = back;
    const field = nameFields.querySelector('input[data-p="' + p + '"]');
    if (field) field.value = back !== undefined ? back : storedName(p);
  });
  if (keys.length) paintNames();
  closeRename();
}

/* ---------- Name editor wiring ---------- */
if (renameInput) {
  renameInput.addEventListener('input', () => {
    if (renameSel === null) return;
    renameStaged[renameSel] = renameInput.value;
    previewRename(renameSel);
    buildRenameChips();
  });
  renameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); saveRename(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); }
  });
}
const renameSaveBtn = document.getElementById('renameSave');
if (renameSaveBtn) renameSaveBtn.addEventListener('click', saveRename);
const renameCancelBtn = document.getElementById('renameCancel');
if (renameCancelBtn) renameCancelBtn.addEventListener('click', cancelRename);
const renameCloseBtn = document.getElementById('renameClose');
if (renameCloseBtn) renameCloseBtn.addEventListener('click', cancelRename);
if (renameModal) renameModal.addEventListener('click', e => {
  if (e.target === renameModal) cancelRename();
});
const namesBtn = document.getElementById('namesBtn');
if (namesBtn) namesBtn.addEventListener('click', () => {
  openRename(game.active.length ? cur() : renameRoster()[0]);
});

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
    input.value = storedName(p);          // last used name for this colour
    input.placeholder = DEF[p].label;
    input.dataset.p = p;
    row.appendChild(input);
    nameFields.appendChild(row);
  });
}

function startGame () {
  clearTimers();
  paused = null;
  winScreen.classList.add('hidden');
  game.active = BY_COUNT[chosenCount].slice();
  game.names = {};
  nameFields.querySelectorAll('input').forEach(inp => {
    const p = +inp.dataset.p;
    const v = (inp.value || '').trim() || DEF[p].label;
    game.names[p] = v;
    savedNames[p] = v;                     // remember for the next match
  });
  persistNames();
  game.tokens = [[],[],[],[]];
  game.active.forEach(p => game.tokens[p] = [-1,-1,-1,-1]);
  game.idx = 0;
  game.phase = 'roll';
  game.dice = null;
  game.sixes = 0;
  game.movable = [];
  game.pending = null;
  game.queued = null;
  game.currentMove = null;
  game.resolved = false;

  buildTokens();
  buildCards();
  renderTokens();
  showDice(null);
  updateUI();
  msg(nameOf(cur()) + "'s turn \u2014 roll the dice.");
  startScreen.classList.add('hidden');
  syncStartChrome();
  chatSystem('New game \u2014 ' + game.active.map(p => nameOf(p)).join(' vs '));
}

/* ---------- Pause / resume (New Game in the middle of a match) ----------
   The start screen used to be a one-way door: opening it killed every pending
   timer, so there was no way back into a running match. Now we first settle
   anything in flight (a half-walked token jumps to its square and its capture/
   home effects are applied immediately), then snapshot what is left over. */
let paused = null;

function settleBeforePause () {
  if (game.phase === 'rolling') {
    // the tumble never landed — put the dice back to "roll me"
    game.phase = 'roll';
    showDice(null);
    return;
  }
  if (game.phase !== 'moving') return;

  if (stepIv) { clearInterval(stepIv); stepIv = null; }
  if (!game.resolved) {
    const cm = game.currentMove;
    if (cm) { game.tokens[cm.p][cm.t] = cm.to; renderTokens(); }
    game.currentMove = null;
    game.pending = cm ? cm.t : game.pending;
    game.phase = 'wait';
    resolve();                       // capture / home / win happen right now
  }
  if (game.phase === 'moving') game.phase = 'wait';
}

function openStartScreen () {
  /* inside a room the room owns the match: "new game" means back to the lobby */
  if (net.room) { olOpen(); return; }
  const live = game.active.length > 0 && game.phase !== 'idle' && game.phase !== 'over';
  paused = null;
  if (live) {
    settleBeforePause();
    if (game.phase !== 'over') {
      paused = {
        phase: game.phase,
        queued: game.queued || null,
        oweNextTurn: game.phase === 'wait' && !game.queued,
        text: (msgEl && msgEl.textContent) || ''
      };
    }
  }
  clearTimers();
  clearTurnTimer();
  if (!paused) game.phase = 'idle';
  winScreen.classList.add('hidden');
  rulesScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  syncStartChrome();
}

function syncStartChrome () {
  const show = !!paused;
  const r = document.getElementById('resumeBtn');
  const x = document.getElementById('closeStart');
  if (r) r.classList.toggle('hidden', !show);
  if (x) x.classList.toggle('hidden', !show);
}

function resumeGame () {
  const st = paused;
  paused = null;
  startScreen.classList.add('hidden');
  syncStartChrome();
  if (!st) return;

  game.phase = st.phase;
  renderTokens();
  showDice(game.dice == null ? null : game.dice);
  if (st.oweNextTurn) later(nextTurn, 800);
  else if (st.queued) later(() => performMove(st.queued), 320);
  updateUI();
  msg(st.text || (nameOf(cur()) + "'s turn \u2014 roll the dice."));
}

/* ---------- Wiring ---------- */
rollBtn.addEventListener('click', rollDice);
diceEl.addEventListener('click', rollDice);
diceEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); rollDice(); }
});

function isTyping (el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (renameModal && !renameModal.classList.contains('hidden')) { cancelRename(); return; }
    if (olScreen && !olScreen.classList.contains('hidden')) { olCloseScreen(); return; }
    if (chatPanel && !chatPanel.classList.contains('hidden')) { closeChat(); return; }
    if (settingsPop && !settingsPop.classList.contains('hidden')) {
      settingsPop.classList.add('hidden');
      settingsBtn.setAttribute('aria-expanded', 'false');
      return;
    }
    if (!rulesScreen.classList.contains('hidden')) { rulesScreen.classList.add('hidden'); return; }
    if (paused) { resumeGame(); return; }
    return;
  }
  if (e.code !== 'Space') return;
  if (isTyping(e.target)) return;
  if (!startScreen.classList.contains('hidden')) return;
  if (olScreen && !olScreen.classList.contains('hidden')) return;
  if (!winScreen.classList.contains('hidden')) return;
  if (!rulesScreen.classList.contains('hidden')) return;
  if (renameModal && !renameModal.classList.contains('hidden')) return;
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

/* back door out of the start screen while a match is still running */
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('closeStart').addEventListener('click', () => { if (paused) resumeGame(); });
startScreen.addEventListener('click', e => {
  if (paused && e.target === startScreen) resumeGame();
});
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

/* ---------- Chat: text · emoji · stickers ----------
   One shared room per game for now (pass & play on one device): whoever's
   turn it is, is holding the device. Everything goes through pushChat(), so
   when multiplayer lands this same renderer becomes the room chat — only the
   transport (localStorage → WebSocket) changes. */
const chatPanel = document.getElementById('chatPanel');
const chatLog   = document.getElementById('chatLog');
const chatForm  = document.getElementById('chatForm');
const chatInput = document.getElementById('chatText');
const chatTray  = document.getElementById('chatTray');
const chatGrid  = document.getElementById('chatGrid');
const chatBtnEl = document.getElementById('chatBtn');

const EMOJIS = [
  '😂', '🤣', '😅', '😆', '😉', '😍', '😎', '🤓', '🥳', '😱', '😴', '😡', '🤔', '🤗',
  '😇', '😈', '👻', '💀', '🤡', '🥶', '🤭', '😬', '🙈', '🙉', '🙈',
  '👍', '👎', '👏', '🙏', '💪', '🤝', '🤞', '✌️', '👌', '👋', '🫡', '🫰',
  '🔥', '💯', '🎉', '🎊', '✨', '⭐', '🏆', '🥇', '🎲', '🎯', '🚀', '⚡',
  '❤️', '💔', '💛', '💚', '💙', '💜', '🌈', '🍕', '☕', '🍻', '🐢', '💤'
];

const STICKERS = [
  { art: '😂',                 label: 'LOL' },
  { art: '🤣🤣🤣',             label: 'Cannot stop laughing' },
  { art: '😈',                 label: 'Evil laugh' },
  { art: '🎉🥳',               label: 'Party!' },
  { art: '🔥',                 label: 'On fire' },
  { art: '💯',                 label: 'Perfect' },
  { art: '👏👏👏',             label: 'Bravo' },
  { art: '😱',                 label: 'No way!' },
  { art: '🏆',                 label: 'Winner!' },
  { art: '🎲',                 label: 'Roll it!' },
  { art: '😴',                 label: 'Boring...' },
  { art: '💪',                 label: 'You got this' },
  { art: '💔',                 label: 'Ouch' },
  { art: '🤗',                 label: 'Group hug' },
  { art: '🤞',                 label: 'So lucky' },
  { art: '🗣️',                 label: 'Talk to me' }
];

let chatMsgs = (() => {
  try {
    const v = JSON.parse(window.localStorage.getItem('ludo.chat') || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
})();
let chatSeq = chatMsgs.reduce((m, x) => Math.max(m, (x && x.id) || 0), 0);

function saveChat () {
  try { window.localStorage.setItem('ludo.chat', JSON.stringify(chatMsgs.slice(-80))); }
  catch (e) { /* private mode / tests */ }
}

function chatSender () {
  if (net.on && net.seat >= 0 && game.active[net.seat] !== undefined) return game.active[net.seat];
  return game.active.length ? cur() : 0;
}

/* colour this device plays: the room seat when online, Red otherwise */
function myColour () {
  if (net.on && net.seat >= 0 && game.active[net.seat] !== undefined) return game.active[net.seat];
  return game.active.length ? game.active[0] : 0;
}

function chatSyncSender () {
  const p = chatSender();
  const dot = document.getElementById('chatDot');
  const as  = document.getElementById('chatAs');
  if (dot) dot.style.background = DEF[p].color;
  if (as)  as.textContent = nameOf(p);
}

function chatStamp (t) {
  const d = new Date(t || Date.now());
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

function renderChatItem (m) {
  if (!chatLog || !m) return;
  const empty = document.getElementById('chatEmpty');
  if (empty) empty.classList.add('hidden');
  const el = document.createElement('div');
  if (m.sys) {
    el.className = 'chat-sys';
    el.textContent = m.text;
  } else {
    const mine = m.p === myColour();
    el.className = 'chat-msg' + (mine ? ' mine' : '');
    el.style.cssText = '--pc:' + (DEF[m.p] || DEF[0]).color;

    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = nameOf(m.p);

    const bub = document.createElement('div');
    bub.className = 'chat-bubble' +
      (m.kind === 'sticker' ? ' chat-sticker' : m.kind === 'emoji' ? ' chat-emoji' : '');
    bub.textContent = m.text;

    const time = document.createElement('span');
    time.className = 'chat-time';
    time.textContent = chatStamp(m.t);

    el.appendChild(name);
    el.appendChild(bub);
    el.appendChild(time);
  }
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

function pushChat (m) {
  m.id = ++chatSeq;
  m.t = Date.now();
  chatMsgs.push(m);
  if (chatMsgs.length > 80) chatMsgs.splice(0, chatMsgs.length - 80);
  saveChat();
  renderChatItem(m);
}

/* system lines: captures, home runs, wins, new games */
function chatSystem (text) {
  if (!text) return;
  pushChat({ sys: true, text: text });
  netSend({ t: 'chat', sys: true, text: text });     // the room shares one log
}

function isEmojiOnly (s) {
  if (!s || s.length > 12) return false;
  return Array.from(s).every(ch => {
    const cp = ch.codePointAt(0);
    return cp === 0x200d || cp === 0xfe0f ||
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x2600 && cp <= 0x27bf) ||
      (cp >= 0x2b00 && cp <= 0x2bff);
  });
}

function sendChat (text, kind) {
  const t = (text || '').trim();
  if (!t) return;
  pushChat({ p: chatSender(), text: t, kind: kind || 'text' });
  netSend({ t: 'chat', kind: kind || 'text', text: t });
}

function buildChatGrid (tab) {
  if (!chatGrid) return;
  chatGrid.innerHTML = '';
  const sticker = tab === 'sticker';
  const list = sticker ? STICKERS : EMOJIS;
  list.forEach(item => {
    const b = document.createElement('button');
    b.type = 'button';
    if (sticker) {
      b.className = 'st';
      b.title = item.label;
      b.textContent = item.art;
      b.addEventListener('click', () => {
        sendChat(item.art, 'sticker');
        tone(880, .07, 'triangle', .045);
        buzz(8);
      });
    } else {
      b.textContent = item;
      b.addEventListener('click', () => {
        chatInput.value = (chatInput.value || '') + item;
        if (typeof chatInput.focus === 'function') chatInput.focus();
      });
    }
    chatGrid.appendChild(b);
  });
}

function chatTrayToggle (force) {
  if (!chatTray) return;
  const show = force === undefined ? chatTray.classList.contains('hidden') : !!force;
  chatTray.classList.toggle('hidden', !show);
  if (show && (!chatGrid.children || !chatGrid.children.length)) buildChatGrid('emoji');
}

function openChat () {
  if (!chatPanel) return;
  chatPanel.classList.remove('hidden');
  if (chatBtnEl) chatBtnEl.setAttribute('aria-expanded', 'true');
  if (settingsPop) { settingsPop.classList.add('hidden'); settingsBtn.setAttribute('aria-expanded', 'false'); }
  chatTrayToggle(false);
  chatSyncSender();
  chatLog.scrollTop = chatLog.scrollHeight;
}

function closeChat () {
  if (!chatPanel) return;
  chatPanel.classList.add('hidden');
  if (chatBtnEl) chatBtnEl.setAttribute('aria-expanded', 'false');
  chatTrayToggle(false);
}

/* ---------- Chat wiring ---------- */
if (chatBtnEl) chatBtnEl.addEventListener('click', e => {
  e.stopPropagation();
  if (chatPanel.classList.contains('hidden')) openChat();
  else closeChat();
});
const chatCloseEl = document.getElementById('chatClose');
if (chatCloseEl) chatCloseEl.addEventListener('click', closeChat);

const chatClearEl = document.getElementById('chatClear');
if (chatClearEl) chatClearEl.addEventListener('click', () => {
  chatMsgs = [];
  saveChat();
  if (chatLog) chatLog.innerHTML = '<div id="chatEmpty" class="chat-empty"><span>\uD83D\uDCAC</span>Say hi \uD83D\uDC4B \u2014 messages stay on this device.</div>';
});

const chatEmojiBtn = document.getElementById('chatEmoji');
if (chatEmojiBtn) chatEmojiBtn.addEventListener('click', () => chatTrayToggle());

const chatTabs = chatTray ? chatTray.querySelector('.chat-tabs') : null;
if (chatTabs) chatTabs.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  Array.prototype.forEach.call(chatTabs.children, x => x.classList.toggle('active', x === b));
  buildChatGrid(b.dataset.tab);
});

if (chatForm) chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const v = (chatInput && chatInput.value) || '';
  if (!v.trim()) return;
  sendChat(v, isEmojiOnly(v.trim()) ? 'emoji' : 'text');
  chatInput.value = '';
  tone(720, .06, 'triangle', .04);
  buzz(6);
});

/* click-away closes it (mirrors the settings popover) */
document.addEventListener('click', e => {
  if (!chatPanel || chatPanel.classList.contains('hidden')) return;
  if (chatPanel.contains(e.target) || e.target === chatBtnEl) return;
  closeChat();
});

/* replay saved history */
chatMsgs.forEach(renderChatItem);

/* ---------- Online rooms: one code, the same match on every phone ----------
   The host runs the rules engine exactly as in pass & play and pushes state
   snapshots; everyone else mirrors that state and asks the room to forward
   their rolls and moves. The server seats players, keeps the chat log and
   enforces whose turn it is — it never needs to know the rules. */
const OL_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const OL_KEY = 'ludo.room';
const OL_NAME_KEY = 'ludo.me';

const olScreen    = document.getElementById('onlineScreen');
const olMain      = document.getElementById('olMain');
const olLobby     = document.getElementById('olLobby');
const olTabs      = document.getElementById('olTabs');
const olCreatePane = document.getElementById('olCreate');
const olJoinPane  = document.getElementById('olJoin');
const olNameIn    = document.getElementById('olHostName');
const olJoinIn    = document.getElementById('olJoinName');
const olCodeIn    = document.getElementById('olCode');
const olCountSeg  = document.getElementById('olCount');
const olCreateBtn = document.getElementById('olCreateBtn');
const olJoinBtn   = document.getElementById('olJoinBtn');
const olCopyBtn   = document.getElementById('olCopyBtn');
const olCodeOut   = document.getElementById('olCodeOut');
const olLinkOut   = document.getElementById('olLinkOut');
const olSeatList  = document.getElementById('olSeatList');
const olStatus    = document.getElementById('olStatus');
const olStartBtn  = document.getElementById('olStartBtn');
const olLeaveBtn  = document.getElementById('olLeaveBtn');
const olErrEl     = document.getElementById('olErr');
const olCloseEl   = document.getElementById('olClose');
const onlineBtn   = document.getElementById('onlineBtn');
const olNewGameBtn = document.getElementById('newGameBtn');

let olCountN = 2;

function olRand (n, alphabet) {
  const chars = alphabet || OL_CHARS;
  let out = '';
  try {
    const buf = new Uint8Array(n);
    const c = (typeof window !== 'undefined' && window.crypto) ? window.crypto
      : (typeof crypto !== 'undefined' ? crypto : null);
    if (!c || !c.getRandomValues) throw new Error('no crypto');
    c.getRandomValues(buf);
    for (let i = 0; i < n; i++) out += chars[buf[i] % chars.length];
  } catch (e) {
    for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/* only the seat whose turn it is may touch the board */
function myTurn () {
  if (!net.room) return true;
  if (!net.on || net.seat < 0 || !game.active.length) return false;
  return game.active[net.seat] === cur();
}

function netSend (o) {
  try { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(o)); } catch (e) {}
}
function netEmit (ev) { if (net.on && net.role === 'host') netSend({ t: 'e', ev: ev }); }

function netSnapshot () {
  return {
    act: game.active.slice(),
    idx: game.idx,
    ph: game.phase,
    dice: game.dice,
    six: game.sixes,
    mov: (game.movable || []).map(m => ({ p: m.p, t: m.t, steps: m.steps })),
    names: Object.assign({}, game.names),
    tok: [0, 1, 2, 3].map(p => (game.tokens[p] || []).slice()),
    msg: (msgEl && msgEl.textContent) || ''
  };
}

/* the host publishes after every state change; msg() and updateUI() both end here */
function netSync () {
  if (!net.on || net.role !== 'host' || !net.started) return;
  if (!game.active.length) return;
  netSend({ t: 's', snap: netSnapshot() });
}

/* ---------- receiving: one ordered queue so motion and state can't swap ---------- */
function netPush (item) { net.q.push(item); netPump(); }

function netPump () {
  if (net.busy) return;
  let item = net.q.shift();
  if (!item) return;
  if (item.k === 'snap') {
    while (net.q.length && net.q[0].k === 'snap') item = net.q.shift();   // newest wins
    netApply(item.s);
    netPump();
    return;
  }
  if (item.k === 'ev') {
    net.busy = true;
    netWalk(item.ev, () => { net.busy = false; netPump(); });
    return;
  }
  netPump();
}

/* replay the host's step-by-step walk so remote moves look identical */
function netWalk (ev, done) {
  const finish = () => done();
  if (!ev || game.active.indexOf(ev.p) < 0 || !game.tokens[ev.p] ||
      game.tokens[ev.p][ev.t] === undefined) { finish(); return; }

  if (ev.from === -1) {
    game.tokens[ev.p][ev.t] = 0;
    renderTokens();
    hopToken(ev.p, ev.t);
    tone(700, .1, 'triangle', .05);
    setTimeout(finish, 340);
    return;
  }

  game.tokens[ev.p][ev.t] = ev.from;
  renderTokens();
  const to = ev.to;
  const total = Math.max(1, to - ev.from);
  let n = 0;
  const iv = setInterval(() => {
    game.tokens[ev.p][ev.t] = Math.min(to, game.tokens[ev.p][ev.t] + 1);
    hopToken(ev.p, ev.t);
    tone(580 + n * 30, .05, 'triangle', .04);
    renderTokens();
    if (++n >= total || game.tokens[ev.p][ev.t] >= to) {
      clearInterval(iv);
      setTimeout(finish, 240);
    }
  }, 165);
}

function netApply (s) {
  if (!s || !Array.isArray(s.act) || !s.act.length) return;
  const prev = net.snap;
  const rebuild = !prev || game.active.join(',') !== s.act.join(',');
  net.snap = s;

  if (rebuild) {
    chosenCount = s.act.length;
    game.active = s.act.slice();
    game.idx = s.idx;
    game.phase = 'idle';
    game.tokens = [[], [], [], []];
    game.active.forEach(p => { game.tokens[p] = [-1, -1, -1, -1]; });
    game.movable = []; game.pending = null; game.queued = null;
    game.currentMove = null; game.resolved = true;
    net.winShown = false;
    buildTokens();
    buildCards();
    startScreen.classList.add('hidden');
    rulesScreen.classList.add('hidden');
    winScreen.classList.add('hidden');
  } else {
    netFx(s);                 // captures / home runs the walk just caused
  }

  netApplyNames(s.names);

  game.idx = s.idx;
  game.phase = s.ph;
  game.dice = s.dice;
  game.sixes = s.six;
  game.movable = (s.mov || []).slice();
  netPlace(s);

  diceEl.classList.toggle('rolling', s.ph === 'rolling');
  if (s.dice === null || s.dice === undefined) {
    if (s.ph !== 'rolling') showDice(null);
  } else if (!prev || prev.dice !== s.dice) {
    showDice(s.dice);
    diceEl.classList.remove('landed');
    void diceEl.offsetWidth;
    diceEl.classList.add('landed');
    later(() => diceEl.classList.remove('landed'), 540);
  }

  const text = s.msg || '';
  if (text && msgEl && msgEl.textContent !== text) msg(text);

  updateUI();

  if (s.ph === 'over') netShowWin(rebuild);
  else {
    net.winShown = false;
    if (!winScreen.classList.contains('hidden')) winScreen.classList.add('hidden');
  }
}

function netPlace (s) {
  if (!s.tok) return;
  s.tok.forEach((arr, p) => {
    if (!arr || game.active.indexOf(p) < 0) return;
    game.tokens[p] = arr.slice();
  });
  renderTokens();
}

/* what changed on screen since the last paint: knockouts and finishes */
function netFx (s) {
  if (!s.tok) return;
  s.tok.forEach((arr, p) => {
    if (!arr || game.active.indexOf(p) < 0) return;
    const now = game.tokens[p] || [];
    arr.forEach((nw, t) => {
      const old = now[t];
      if (old === undefined || old === nw) return;
      if (old >= 0 && old <= 51 && nw === -1) {
        const pos = cellXY(p, old, t);
        if (pos) captureFX(p, t, Object.assign({ q: p, k: t }, pos));
        soundCapture();
        soundLaugh(.2);
        buzz([14, 45, 14]);
      } else if (old !== HOME && nw === HOME) {
        const home = cellXY(p, HOME, t);
        if (home) fxBurst(home.x, home.y, DEF[p].color, 34);
        soundHome();
        buzz(16);
      }
    });
  });
}

function netShowWin (quiet) {
  const s = net.snap;
  const w = (s.act || []).find(p =>
    (s.tok[p] || []).length === 4 && s.tok[p].every(x => x === HOME));
  if (w === undefined) return;
  document.getElementById('winTitle').textContent = nameOf(w) + ' wins!';
  winScreen.classList.remove('hidden');
  if (!quiet && !net.winShown) { soundWin(); buzz([25, 60, 25]); fxRain(180); }
  net.winShown = true;
}

function netApplyNames (names) {
  if (!names) return;
  Object.keys(names).forEach(k => {
    const v = names[k];
    if (typeof v !== 'string') return;
    olApplyRename(+k, v, net.role === 'host');
  });
}

/* repaint a name without re-broadcasting it (the sender already told the room) */
function olApplyRename (p, v, persist) {
  const clean = (v || '').trim().slice(0, 16);
  if (!clean || !(p >= 0 && p <= 3)) return;
  const from = game.names[p] || storedName(p);
  if (clean === from) return;
  net.applying = true;
  game.names[p] = clean;
  if (persist) { savedNames[p] = clean; persistNames(); }
  const field = nameFields.querySelector('input[data-p="' + p + '"]');
  if (field) field.value = clean;
  paintNames();
  const line = msgEl && msgEl.textContent;
  if (line && line.indexOf(from) >= 0) msgEl.textContent = line.split(from).join(clean);
  net.applying = false;
}

/* ---------- messages ---------- */
function netMessage (data) {
  let m = null;
  try { m = JSON.parse(data); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;
  switch (m.t) {
    case 'hello':  return onHello(m);
    case 'seats':  return onSeats(m);
    case 's':      return netPush({ k: 'snap', s: m.snap });
    case 'e':      return netPush({ k: 'ev', ev: m.ev });
    case 'a':      return onRemoteAction(m);
    case 'chat':   return pushChat(m.m);
    case 'rename': return olApplyRename(m.p, m.v, net.role === 'host');
    case 'err':    net.lastErr = m.text || ''; return olToast(m.text);
    case 'bye':    return olBye(m.text || 'The room closed.');
  }
}

function onHello (m) {
  net.hello = true;
  net.seat = m.seat;
  net.p = m.p;
  net.role = m.owner ? 'host' : 'guest';
  net.count = m.count || net.count;
  olCountN = net.count;
  net.seats = m.seats || [];
  net.started = !!m.started;
  net.hostDown = false;
  try {
    window.localStorage.setItem(OL_KEY, JSON.stringify({
      code: net.code, token: net.token, role: net.role, count: net.count, name: olMyName()
    }));
  } catch (e) {}

  /* replay what the room has already seen, skipping lines we already have */
  if (Array.isArray(m.chat)) m.chat.forEach(x => {
    if (!x) return;
    if (chatMsgs.some(y => y && y.t === x.t && y.text === x.text && y.p === x.p)) return;
    pushChat(x);
  });

  if (m.snap) netPush({ k: 'snap', s: m.snap });    // restore after a reload

  syncOnlineChrome();
  if (m.started && m.snap) olCloseScreen();          // straight back into the match
  else { olShowLobby(); olScreen.classList.remove('hidden'); olErr(''); }
}

function onSeats (m) {
  net.seats = m.seats || net.seats;
  if (m.count) { net.count = m.count; olCountN = m.count; }
  if (m.started !== undefined) net.started = !!m.started;
  net.hostDown = !!m.hostDown;
  if (olScreen && !olScreen.classList.contains('hidden')) olPaintLobby();
  if (net.started && net.role === 'guest') olCloseScreen();
}

/* the room forwards a guest's action to the host, which owns the engine */
function onRemoteAction (m) {
  if (net.role !== 'host') return;
  const a = m.a;
  if (a === 'roll') {
    if (game.phase === 'roll' && myTurn()) rollDice();
    netSync();
    return;
  }
  if (a && a.k === 'tap') {
    const mv = (game.movable || []).find(x => x.p === a.p && x.t === a.t);
    if (mv && game.phase === 'select' && myTurn()) { buzz(8); performMove(mv); }
    netSync();                                       // always answer, even a no-op
  }
}

function olClosed () {
  const wasHello = net.hello;
  const role = net.role;
  if (net.bye) { net.bye = false; return; }
  net.on = false;
  net.ws = null;
  if (!wasHello) {
    /* handshake never finished (bad code / stale saved room) — no drama */
    if (!net.lastErr) net.lastErr = 'closed before hello';
    net.room = false;
    net.hello = false;
    try { window.localStorage.removeItem(OL_KEY); } catch (e) {}
    syncOnlineChrome();
    if (olScreen && !olScreen.classList.contains('hidden')) {
      olShowMain();
      olErr('Room not found — check the code.');
    }
    return;
  }
  olBye(role === 'host' ? 'Connection lost.' : 'The host closed the room.');
}

function olBye (text) {
  olDisconnect();
  olCloseScreen();
  winScreen.classList.add('hidden');
  rulesScreen.classList.add('hidden');
  paused = null;
  clearTimers();
  clearTurnTimer();
  game.phase = 'idle';
  startScreen.classList.remove('hidden');
  syncStartChrome();
  msg(text);
}

function olLeave () {
  if (net.on) netSend({ t: 'leave' });
  olBye('You left the room.');
}

function olDisconnect () {
  net.bye = true;
  try { if (net.ws) { net.ws.onclose = null; net.ws.close(); } } catch (e) {}
  net.ws = null;
  net.on = false; net.room = false; net.hello = false; net.bye = false;
  net.seat = -1; net.p = -1; net.snap = null; net.q = []; net.busy = false;
  net.seats = []; net.started = false; net.hostDown = false;
  net.role = null; net.code = null; net.winShown = false;
  try { window.localStorage.removeItem(OL_KEY); } catch (e) {}
  syncOnlineChrome();
}

function netStopLocal () {
  if (!game.active.length || game.phase === 'idle' || game.phase === 'over') return;
  settleBeforePause();
  clearTimers();
  clearTurnTimer();
  paused = null;
  game.phase = 'idle';
  winScreen.classList.add('hidden');
}

function olConnect (opts) {
  olErr('');
  if (net.on || net.room) olDisconnect();
  netStopLocal();
  net.room = true;
  net.on = false;
  net.hello = false;
  net.bye = false;
  net.role = opts.role;
  net.code = String(opts.code || '').toUpperCase();
  net.token = opts.token || olRand(16, 'abcdefghijklmnopqrstuvwxyz0123456789');
  net.seat = -1; net.p = -1; net.snap = null;
  net.q = []; net.busy = false; net.seats = [];
  net.started = false; net.hostDown = false; net.winShown = false;
  net.lastErr = '';
  net.count = opts.count || 2;
  olCountN = net.count;
  syncOnlineChrome();

  if (typeof WebSocket === 'undefined') {
    olErr('This browser cannot open a room.');
    net.room = false;
    syncOnlineChrome();
    return;
  }
  const proto = (typeof location !== 'undefined' && location.protocol === 'https:') ? 'wss://' : 'ws://';
  let ws;
  try {
    ws = new WebSocket(proto + location.host + '/room/' + net.code);
  } catch (e) {
    olErr('Could not reach the room service.');
    net.room = false;
    syncOnlineChrome();
    return;
  }
  net.ws = ws;
  ws.onopen = () => {
    net.on = true;
    netSend({ t: 'hi', role: net.role, name: opts.name, count: net.count, token: net.token });
    if (olStatus) olStatus.textContent = 'Connecting…';
    syncOnlineChrome();
  };
  ws.onmessage = e => netMessage(e.data);
  ws.onerror = () => {};
  ws.onclose = () => olClosed();
}

/* ---------- lobby ui ---------- */
function olErr (text) {
  if (!olErrEl) return;
  olErrEl.textContent = text || '';
  olErrEl.classList.toggle('hidden', !text);
}
function olToast (text) {
  if (!text) return;
  if (olScreen && !olScreen.classList.contains('hidden')) { olErr(text); return; }
  if (net.role === 'guest') msg(text);       // host messages are the source of truth
}
function syncOnlineChrome () {
  if (olNewGameBtn) olNewGameBtn.classList.toggle('hidden', !!net.room);
  if (onlineBtn) onlineBtn.classList.toggle('ol-live', !!net.on);
}
function olShareUrl () {
  try { return location.origin + '/?room=' + net.code; }
  catch (e) { return '/?room=' + (net.code || ''); }
}
function olShowMain () {
  if (olMain) olMain.classList.remove('hidden');
  if (olLobby) olLobby.classList.add('hidden');
}
function olShowLobby () {
  if (olMain) olMain.classList.add('hidden');
  if (olLobby) olLobby.classList.remove('hidden');
  olPaintLobby();
}
function olOpen () {
  if (!olScreen) return;
  olErr('');
  if (net.hello) olShowLobby(); else olShowMain();
  olScreen.classList.remove('hidden');
  if (onlineBtn && typeof onlineBtn.setAttribute === 'function') onlineBtn.setAttribute('aria-expanded', 'true');
  olPrefill();
}
function olCloseScreen () {
  if (!olScreen) return;
  olScreen.classList.add('hidden');
  if (olErrEl) olErrEl.classList.add('hidden');
  if (onlineBtn && typeof onlineBtn.setAttribute === 'function') onlineBtn.setAttribute('aria-expanded', 'false');
}
function olSavedName () {
  try { return window.localStorage.getItem(OL_NAME_KEY) || ''; } catch (e) { return ''; }
}
function olRememberName (n) { try { window.localStorage.setItem(OL_NAME_KEY, n); } catch (e) {} }
function olMyName () {
  if (olNameIn && olNameIn.value && olNameIn.value.trim()) return olNameIn.value.trim();
  if (olJoinIn && olJoinIn.value && olJoinIn.value.trim()) return olJoinIn.value.trim();
  return olSavedName() || 'Player';
}
function olPrefill () {
  const saved = olSavedName();
  if (olNameIn && !olNameIn.value) olNameIn.value = saved;
  if (olJoinIn && !olJoinIn.value) olJoinIn.value = saved;
}
function olSwitchTab (tab) {
  if (olCreatePane) olCreatePane.classList.toggle('hidden', tab !== 'create');
  if (olJoinPane) olJoinPane.classList.toggle('hidden', tab !== 'join');
  if (olTabs) Array.prototype.forEach.call(olTabs.children,
    b => b.classList.toggle('active', !!(b && b.dataset && b.dataset.tab === tab)));
}
function olPaintLobby () {
  if (olCodeOut) olCodeOut.textContent = net.code || '······';
  if (olLinkOut) olLinkOut.textContent = olShareUrl();
  if (olStartBtn) olStartBtn.classList.toggle('hidden', net.role !== 'host');

  const seats = net.seats.slice().sort((a, b) => a.seat - b.seat);
  const roster = BY_COUNT[net.count] || BY_COUNT[2];
  const rows = seats.slice();
  for (let i = seats.length; i < net.count; i++) rows.push(null);

  if (olSeatList) {
    olSeatList.innerHTML = '';
    rows.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = 'ol-seat';
      const p = s ? s.p : (roster[i] !== undefined ? roster[i] : roster[0]);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.background = DEF[p].color;
      const nm = document.createElement('b');
      nm.textContent = s ? s.name : 'Empty seat';
      li.appendChild(chip);
      li.appendChild(nm);
      if (s && s.seat === net.seat) {
        const you = document.createElement('span');
        you.className = 'ol-you';
        you.textContent = 'you';
        li.appendChild(you);
      }
      const st = document.createElement('span');
      st.className = 'ol-state' + (s && s.connected ? '' : ' wait');
      st.textContent = s ? (s.connected ? 'ready' : 'offline') : 'open';
      li.appendChild(st);
      olSeatList.appendChild(li);
    });
  }

  if (olStatus) {
    const ready = seats.filter(s => s.connected).length;
    if (net.hostDown) olStatus.textContent = 'The host lost connection — waiting…';
    else if (net.role === 'host') {
      olStatus.textContent = ready >= net.count
        ? 'Everyone is in — start the game!'
        : 'Share the code — waiting for friends (' + ready + '/' + net.count + ')…';
    } else {
      olStatus.textContent = net.started ? 'Starting…' : 'Waiting for the host to start the game…';
    }
  }
}
function olCopy () {
  const url = olShareUrl();
  const done = () => {
    if (!olCopyBtn) return;
    const old = olCopyBtn.textContent;
    olCopyBtn.textContent = 'Copied!';
    setTimeout(() => { olCopyBtn.textContent = old; }, 1400);
  };
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, done);
    } else done();
  } catch (e) { done(); }
}
function olStartGame () {
  if (net.role !== 'host' || !net.on) return;
  const seats = net.seats.slice().sort((a, b) => a.seat - b.seat);
  if (seats.length < net.count || seats.some(s => !s.connected)) {
    olErr('Waiting for everyone to join.');
    return;
  }
  olErr('');
  chosenCount = net.count;
  if (countSeg) Array.prototype.forEach.call(countSeg.children,
    b => b.classList.toggle('active', !!(b && b.dataset && +b.dataset.n === net.count)));
  buildNameFields(net.count);
  seats.forEach(s => {
    const inp = nameFields.querySelector('input[data-p="' + s.p + '"]');
    if (inp) inp.value = s.name;
  });
  net.started = true;                 // snapshots start flowing right away
  netSend({ t: 'start' });
  olCloseScreen();
  winScreen.classList.add('hidden');
  startGame();
}

/* ---------- wiring ---------- */
if (onlineBtn) onlineBtn.addEventListener('click', olOpen);
if (olCloseEl) olCloseEl.addEventListener('click', () => { olCloseScreen(); olErr(''); });
if (olScreen) olScreen.addEventListener('click', e => { if (e.target === olScreen) olCloseScreen(); });
if (olStartBtn) olStartBtn.addEventListener('click', olStartGame);
if (olLeaveBtn) olLeaveBtn.addEventListener('click', olLeave);
if (olCopyBtn) olCopyBtn.addEventListener('click', olCopy);

if (olTabs) olTabs.addEventListener('click', e => {
  const b = e.target && e.target.closest ? e.target.closest('button') : null;
  if (!b || !b.dataset || !b.dataset.tab) return;
  olSwitchTab(b.dataset.tab);
});
if (olCountSeg) olCountSeg.addEventListener('click', e => {
  const b = e.target && e.target.closest ? e.target.closest('button') : null;
  if (!b || !b.dataset || !b.dataset.n) return;
  olCountN = +b.dataset.n;
  Array.prototype.forEach.call(olCountSeg.children, x => x.classList.toggle('active', x === b));
});
if (olCreateBtn) olCreateBtn.addEventListener('click', () => {
  const name = ((olNameIn && olNameIn.value) || '').trim().slice(0, 16) || 'Host';
  olRememberName(name);
  olConnect({ role: 'host', code: olRand(6), name: name, count: olCountN });
  if (olStatus) olStatus.textContent = 'Creating room…';
});
if (olJoinBtn) olJoinBtn.addEventListener('click', () => {
  const code = String((olCodeIn && olCodeIn.value) || '').toUpperCase()
    .replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code.length < 4) { olErr('Enter the room code your friend shared.'); return; }
  const name = ((olJoinIn && olJoinIn.value) || '').trim().slice(0, 16) || 'Player';
  olRememberName(name);
  olConnect({ role: 'join', code: code, name: name, count: 2 });
  if (olStatus) olStatus.textContent = 'Joining…';
});
if (olCodeIn) olCodeIn.addEventListener('input', () => {
  olCodeIn.value = String(olCodeIn.value || '').toUpperCase()
    .replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

/* ?room=CODE opens the join form; a saved room rejoins after a reload */
(function olBoot () {
  if (typeof location === 'undefined') return;
  let room = null;
  try { room = new URLSearchParams(location.search).get('room'); } catch (e) {}
  if (room) {
    olSwitchTab('join');
    if (olCodeIn) olCodeIn.value = String(room).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    olOpen();
    return;
  }
  let saved = null;
  try { saved = JSON.parse(window.localStorage.getItem(OL_KEY) || 'null'); } catch (e) {}
  if (saved && saved.code && saved.token) {
    olConnect({
      role: saved.role === 'host' ? 'host' : 'join',
      code: saved.code,
      token: saved.token,
      name: saved.name || 'Player',
      count: saved.count || 2
    });
  }
})();

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
