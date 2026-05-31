# Connect 5 — 7×9, gravity, max-difficulty AI

A mobile-first web game: drop discs into one of **9 columns** on a **7-row** board
(Connect-Four style) and connect **five in a row** — horizontally, vertically, or
diagonally. You play against a maximum-strength engine and can choose who moves first.

The engine runs entirely **in your browser** (in a Web Worker), so the app is a static
site: free to host, always available, installable to your home screen, and playable offline.

## Play / preview locally

```bash
# from the project root
python -m http.server 8000
# then open http://localhost:8000  (also works in a phone-sized browser viewport)
```

## Run the tests

No dependencies — uses Node's built-in test runner:

```bash
node --test
```

## How it works

- **Bitboard board** (`src/engine/board.js`, `constants.js`): two `BigInt`s (`position` +
  `mask`) encode the position; 5-in-a-row is detected with shift-AND in 4 directions. A
  sentinel row per column prevents wrap-around. Overlines (6+) also win.
- **Search** (`src/engine/search.js`): negamax + alpha-beta, iterative deepening, a
  transposition table, center-first move ordering, and a per-move time budget. It plays
  perfect tactics, takes immediate wins, blocks threats, and is exact as the board fills.
- **Worker** (`src/engine/worker.js`): runs the search off the main thread so the UI never
  freezes while the engine thinks.
- **UI** (`index.html`, `styles.css`, `src/ui/app.js`): responsive board, drop animations,
  win highlighting, who-goes-first toggle, Hint and Undo.
- **PWA** (`manifest.webmanifest`, `sw.js`): installable + offline.

## Deploy (so you can use it on your phone)

Any static host works. The simplest free, always-on option is **GitHub Pages** — push this
folder to a public repo and enable Pages; you'll get a URL to open on your phone and
"Add to Home Screen".
