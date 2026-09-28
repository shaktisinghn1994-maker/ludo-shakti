# 🎲 Ludo — Pass & Play

A complete Ludo board game for **2–4 players** in the browser. One device, taking turns — no server needed, and no build step or dependencies (the display fonts come from Google Fonts when online and fall back to the system stack offline).

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

| File         | Purpose                                        |
|--------------|------------------------------------------------|
| `index.html` | Page structure, start/rules/win screens, settings |
| `style.css`  | Board, tokens, HUD, themes, motion, responsive |
| `script.js`  | Game engine + canvas FX (confetti/particles)   |
| `server.js`  | Optional local static server                   |
| `test.js`    | Headless tests — `node test.js`                |

## Tests

```bash
node test.js
```

Validates board geometry (52 track squares, starts/stars/home columns), move legality (base entry, exact finish, three-sixes rule) and plays 60 full random games to completion.
