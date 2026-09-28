# 🎲 Ludo — Pass & Play

A complete Ludo board game for **2–4 players** in the browser — pass it around one device, or **share a room code and play live with friends on their own phones**. No build step and no dependencies (the display fonts come from Google Fonts when online and fall back to the system stack offline).

## Play

Open `index.html` in any browser (double-click works), or run a local server:

```bash
node server.js        # then visit http://localhost:8787
```

Or open the live game: **https://ludo-shakti.shaktisinghn1994.workers.dev**

## Play online with friends (room code) 🌐

Tap **🌐** in the top bar:

1. **Create a room** — pick your name and how many players (2–4), press *Create room* and you get a **6-character code** (no O/0/I/1, so it never gets misread).
2. **Share the link or the code** — *Copy link* sends `…?room=CODE`, or just tell them the code and they type it under **Join a room**.
3. Whoever creates the room is the **host** and presses **Start game** once everyone is seated; the lobby lists each seat with its colour, name and connection dot.

How the match stays in sync:

- the **host runs the game rules** — everyone else sends their taps to it and paints the snapshot that comes back, so a dice roll, a move or a capture lands on both screens in the same order
- **you can only act on your turn** — out of turn the dice is disabled and taps are refused
- a guest **rejoins automatically** after a refresh or a dropped connection and lands back in the same seat with the board restored
- the **chat becomes one shared room chat** (system lines for captures/home/wins included), and renaming a player updates everyone in the room
- leaving is explicit: the host's *Leave room* button closes the room for everybody

Technically: `worker.js` is a tiny Cloudflare Worker, `room.js` is a Durable Object that holds the roster, turns and chat for one room code, and the client talks to it over WebSocket (`/room/CODE`). No database, no accounts, no third-party service.

## Features

- **Classic board & colors** — Red, Green, Yellow, Blue on a proper 15×15 Ludo board with a 52-square track, ★ safe squares, coloured home columns and the centre triangle
- **2–4 players** with editable names
  - a **name editor** (tap a player card ✏️, or *Settings → Player names → Edit*): colour chips pick the player, typing previews the new name live on the card, avatar initial, turn card, status line and chat; **Save** keeps it, **Cancel**/**Esc** reverts
  - names persist per colour in `localStorage`, so "Shakti" is waiting for the next match and prefills the start screen
- **Full Ludo rules**
  - Roll a **6** to bring a token out of the base
  - **Extra roll** on a 6; three 6s in a row forfeits the turn
  - Land on an opponent to send it back — except on ★ safe squares
  - Your own tokens stack; exact roll required to reach the centre
  - First to get all **4 tokens home** wins 🏆
- **Premium UI**
  - Wooden board frame, gradient quadrant textures, glowing ★ safe squares, pulsing centre
  - Chess-king tokens with a socket dish, idle bob, glow ring on movable pieces
  - Glass HUD: avatar player cards with SVG progress rings, turn card, glowing dice widget
  - Motion: 3D dice tumble + landing bounce, eased step-by-step movement, capture poof + fly-back, confetti on home/win
  - Light & dark themes, ambient animated background, Fredoka/Nunito typography, SVG favicon
- **Chat 💬** — a floating chat sheet (bottom sheet on phones) with
  - free-text messages tagged with the sender's colour, timestamped bubbles, system lines for captures / home runs / wins
  - an **emoji picker** (tap to insert) and a **sticker tray** (tap to send, animated like a GIF) — all built in, no API key and no network calls
  - history persisted in `localStorage`, 🗑 to clear; every message flows through one `pushChat()` entry point, so the same renderer becomes the room chat when online multiplayer lands
- **New Game never eats your match** — opening *New Game* mid-game **pauses** it: the modal offers **← Resume game**, a ✕, **Esc**, or a tap outside the card to jump straight back. Any half-walked token is settled (its capture/home effects applied) before the pause, so the board never deadlocks
- **Sounds** — a synthesised cartoon *"ha-ha-ha"* laugh plays the moment you capture an opponent's token (Web Audio, no audio files), alongside dice/capture/home/win cues — all mutable
- **Settings (gear icon)** — light/dark theme, sound effects, optional turn timer (auto-roll, default off); persisted in `localStorage`
- **Feel** — haptic micro-interactions on mobile (armed only by a real user gesture), press ripples, ≥44px touch targets, phones play without horizontal scroll
- **Polish** — fully responsive layout

## Project structure

| File              | Purpose                                        |
|-------------------|------------------------------------------------|
| `index.html`      | Page structure, start/rules/win screens, settings, online rooms |
| `style.css`       | Board, tokens, HUD, themes, motion, responsive |
| `script.js`       | Game engine + canvas FX + the online room client |
| `worker.js`       | Cloudflare Worker entry (`/build`, `/room/:CODE`) |
| `room.js`         | Durable Object — seats, turn authority, chat, snapshots |
| `wrangler.jsonc`  | Deploy config (assets + ROOM binding)          |
| `server.js`       | Optional local static server                   |
| `test.js`         | Headless tests — `node test.js`                |
| `room-test.js`    | Room protocol tests against a live deployment  |
| `e2e-online.js`   | Two-browser end-to-end multiplayer test        |

## Tests

```bash
node test.js
```

Validates board geometry (52 track squares, starts/stars/home columns), move legality (base entry, exact finish, three-sixes rule) and plays 60 full random games to completion.

The multiplayer layer has two more suites that need the deployed Worker:

```bash
node room-test.js                 # 30 protocol checks: seats, turns, chat, history
node e2e-online.js                # 36 checks across two live browser profiles
```

`room-test.js` runs against the live URL by default (pass a base URL to point it
elsewhere). `e2e-online.js` needs two headless Chrome profiles — the launch
commands are in its header comment.
