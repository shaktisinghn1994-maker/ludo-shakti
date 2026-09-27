# 🎲 Ludo — Pass & Play

A complete Ludo board game for **2–4 players** in the browser. One device, taking turns — no server or internet needed.

## Play

Open `index.html` in any browser (double-click works), or run a local server:

```bash
node server.js        # then visit http://localhost:8787
```

## Features

- **Classic board & colors** — Red, Green, Yellow, Blue on a proper 15×15 Ludo board with a 52-square track, ★ safe squares, coloured home columns and the centre triangle
- **2–4 players** with editable names
- **Full Ludo rules**
  - Roll a **6** to bring a token out of the base
  - **Extra roll** on a 6; three 6s in a row forfeits the turn
  - Land on an opponent to send it back — except on ★ safe squares
  - Your own tokens stack; exact roll required to reach the centre
  - First to get all **4 tokens home** wins 🏆
- **Polish** — animated dice, step-by-step token movement, glowing highlights on movable tokens, sound effects (mutable), responsive layout for phones

## Project structure

| File         | Purpose                                   |
|--------------|-------------------------------------------|
| `index.html` | Page structure, start screen, rules, popup |
| `style.css`  | Board, tokens, dice, responsive layout     |
| `script.js`  | Game engine                               |
| `server.js`  | Optional local static server              |
| `test.js`    | Headless tests — `node test.js`           |

## Tests

```bash
node test.js
```

Validates board geometry (52 track squares, starts/stars/home columns), move legality (base entry, exact finish, three-sixes rule) and plays 60 full random games to completion.
