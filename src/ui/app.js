// Solver controller. The strong engine computes YOUR moves; you enter the
// OPPONENT's moves by tapping. So:
//   youPlayer  = the side the engine plays (your recommended moves)
//   oppPlayer  = the side you enter by tapping (the real opponent)
// The AI move is driven by a Web Worker (book first, then search), with a
// main-thread fallback.

import { Board, ROWS, COLS } from '../engine/engine.js';
import { WINDOWS } from '../engine/constants.js';

const AI_TIME_MS = 2000; // "max difficulty" think budget per move
const DROP_MS = 380; // matches the CSS drop animation

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const boardEl = $('board');
const labelsEl = $('colLabels');
const consoleEl = $('console');
const overlay = $('overlay');

let board = new Board();
let youPlayer = 1; // engine side (your moves)
let oppPlayer = 2; // tapped side (opponent)
let firstChoice = 'you'; // 'you' | 'opp'
let state = 'idle'; // 'opp-input' | 'you-thinking' | 'animating' | 'over'
let cells = [];
let worker = null;
let fallbackBookLoaded = false;

// ---- Engine plumbing ---------------------------------------------------

function setupWorker() {
  try {
    worker = new Worker(new URL('../engine/worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
}

async function computeMove() {
  const moves = board.history.slice();
  if (worker) {
    return new Promise((resolve) => {
      const onMsg = (ev) => {
        worker.removeEventListener('message', onMsg);
        resolve(ev.data);
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ moves, timeMs: AI_TIME_MS });
    });
  }
  const [{ bestMove }, bookMod] = await Promise.all([
    import('../engine/search.js'),
    import('../engine/book.js'),
  ]);
  if (!fallbackBookLoaded) {
    await bookMod.loadBook(new URL('../../assets/book.json', import.meta.url));
    fallbackBookLoaded = true;
  }
  await wait(20);
  const b = Board.fromMoves(moves);
  const booked = bookMod.bookMove(b);
  if (booked >= 0) return { col: booked, book: true };
  return bestMove(b, { timeMs: AI_TIME_MS });
}

// ---- Rendering ---------------------------------------------------------

function buildBoard() {
  boardEl.innerHTML = '';
  labelsEl.innerHTML = '';
  cells = [];
  for (let c = 0; c < COLS; c++) {
    const col = document.createElement('div');
    col.className = 'col';
    col.dataset.col = String(c);
    col.setAttribute('role', 'button');
    col.tabIndex = 0;
    col.setAttribute('aria-label', `Column ${c + 1}`);
    cells[c] = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      col.appendChild(cell);
      cells[c][r] = cell;
    }
    col.addEventListener('click', () => onColumn(c));
    col.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onColumn(c);
      }
    });
    col.addEventListener('pointerenter', () => preview(c, true));
    col.addEventListener('pointerleave', () => preview(c, false));
    boardEl.appendChild(col);

    const label = document.createElement('span');
    label.textContent = String(c + 1);
    labelsEl.appendChild(label);
  }
  updatePlayable();
}

function classFor(value) {
  return value === youPlayer ? 'p-you' : 'p-opp';
}

function updatePlayable() {
  boardEl.classList.toggle('playable', state === 'opp-input');
}

function renderDiscs(animate = null) {
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const cell = cells[c][r];
      const v = board.cellAt(r, c);
      const current = cell.querySelector('.disc:not(.preview)');
      if (v === 0) {
        if (current) current.remove();
        continue;
      }
      if (current && current.dataset.v === String(v)) continue;
      cell.innerHTML = '';
      const disc = document.createElement('div');
      disc.className = `disc ${classFor(v)}`;
      disc.dataset.v = String(v);
      if (animate && animate.col === c && animate.row === r) {
        disc.style.setProperty('--fall', String(ROWS - r));
        disc.classList.add('drop');
      }
      cell.appendChild(disc);
    }
  }
}

function preview(col, on) {
  if (state !== 'opp-input') return;
  const r = board.landingRow(col);
  if (r < 0) return;
  const cell = cells[col][r];
  const existing = cell.querySelector('.preview');
  if (on && !existing && board.cellAt(r, col) === 0) {
    const ghost = document.createElement('div');
    ghost.className = `disc preview ${classFor(oppPlayer)}`;
    cell.appendChild(ghost);
  } else if (!on && existing) {
    existing.remove();
  }
}

function clearPreviews() {
  boardEl.querySelectorAll('.preview').forEach((d) => d.remove());
}

function clearWinHighlight() {
  boardEl.querySelectorAll('.win').forEach((d) => d.classList.remove('win'));
}

function highlightWin() {
  const stones = board.stonesOf(board.winner);
  for (const w of WINDOWS) {
    if ((stones & w) === w) {
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const bit = 1n << BigInt(c * (ROWS + 1) + r);
          if ((w & bit) !== 0n) cells[c][r].querySelector('.disc')?.classList.add('win');
        }
      }
    }
  }
}

function flashRec(col) {
  const el = boardEl.children[col];
  el.classList.remove('rec');
  void el.offsetWidth; // restart animation
  el.classList.add('rec');
}

// ---- Console & overlay -------------------------------------------------

function setConsole(mode, label, value, sub) {
  consoleEl.dataset.mode = mode;
  $('consoleLabel').textContent = label;
  $('consoleValue').textContent = value;
  $('consoleSub').textContent = sub;
}

function showOverlay(winner) {
  const emblem = $('overlayEmblem');
  if (winner === 0) {
    $('overlayTitle').textContent = 'Draw';
    $('overlaySub').textContent = 'The board filled with no five.';
    emblem.style.cssText = '--c0:#9aa6c8;--c1:#5b678a';
  } else if (winner === youPlayer) {
    $('overlayTitle').textContent = 'You win!';
    $('overlaySub').textContent = 'Your line connected.';
    emblem.style.cssText = '--c0:var(--you-0);--c1:var(--you-1)';
  } else {
    $('overlayTitle').textContent = 'Opponent wins';
    $('overlaySub').textContent = 'They got there first this time.';
    emblem.style.cssText = '--c0:var(--opp-0);--c1:var(--opp-1)';
  }
  overlay.hidden = false;
}

function hideOverlay() {
  overlay.hidden = true;
}

// ---- Game flow ---------------------------------------------------------

function checkEnd() {
  if (board.wins()) {
    state = 'over';
    updatePlayable();
    highlightWin();
    const youWon = board.winner === youPlayer;
    setConsole(youWon ? 'play' : 'await', 'Game over', youWon ? 'WIN' : 'LOSS', youWon ? 'Your line connected' : 'Opponent connected five');
    showOverlay(board.winner);
    return true;
  }
  if (board.isFull) {
    state = 'over';
    updatePlayable();
    setConsole('think', 'Game over', '=', 'Draw — board full');
    showOverlay(0);
    return true;
  }
  return false;
}

async function drop(col) {
  const row = board.landingRow(col);
  board.play(col);
  state = 'animating';
  updatePlayable();
  renderDiscs({ col, row });
  await wait(DROP_MS);
}

function toOppInput() {
  state = 'opp-input';
  updatePlayable();
  setConsole('await', "Opponent's turn", '▼', 'Tap the column they played');
}

async function youTurn() {
  if (board.isOver) return;
  state = 'you-thinking';
  updatePlayable();
  setConsole('think', 'Computing', '…', 'Finding your best move');
  const { col } = await computeMove();
  await drop(col);
  if (checkEnd()) return;
  setConsole('play', 'Play this column', `▸ ${col + 1}`, 'Then enter the opponent’s reply');
  flashRec(col);
  toOppInput();
}

async function onColumn(col) {
  if (state !== 'opp-input' || !board.canPlay(col)) return;
  clearPreviews();
  await drop(col);
  if (checkEnd()) return;
  await youTurn();
}

function undo() {
  if (state === 'you-thinking' || state === 'animating' || board.moves === 0) return;
  board.undo();
  while (board.moves > 0 && board.currentPlayer === youPlayer) board.undo();
  hideOverlay();
  clearWinHighlight();
  renderDiscs();
  if (board.currentPlayer === youPlayer) youTurn();
  else toOppInput();
}

function newGame() {
  if (firstChoice === 'you') {
    youPlayer = 1;
    oppPlayer = 2;
  } else {
    oppPlayer = 1;
    youPlayer = 2;
  }
  board = new Board();
  hideOverlay();
  buildBoard();
  if (board.currentPlayer === youPlayer) youTurn();
  else toOppInput();
}

// ---- Wiring ------------------------------------------------------------

function init() {
  setupWorker();
  buildBoard();
  toOppInput();
  setConsole('await', "Opponent's turn", '▼', 'Tap their move — or press New game');

  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      firstChoice = btn.dataset.first;
    });
  });

  $('newGame').addEventListener('click', newGame);
  $('overlayNew').addEventListener('click', newGame);
  $('undo').addEventListener('click', undo);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
