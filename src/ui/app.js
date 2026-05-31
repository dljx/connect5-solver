// Solver controller. The strong engine computes YOUR moves; you enter the
// OPPONENT's moves by tapping. So:
//   youPlayer  = the side the engine plays (your recommended moves)
//   oppPlayer  = the side you enter by tapping (the real opponent)
// The AI move is driven by a Web Worker (book first, then search), with a
// main-thread fallback.

import { Board, ROWS, COLS } from '../engine/engine.js';
import { WINDOWS } from '../engine/constants.js';

const AI_TIME_MS = 4000; // "max difficulty" think budget per move
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
let state = 'idle'; // 'opp-input' | 'you-thinking' | 'animating' | 'over' | 'editing'
let cells = [];
let worker = null;
let fallbackBookLoaded = false;
let editGrid = null; // grid[col][row] while in "Fix board" mode
let editBrush = 1; // player number the editor currently paints

// ---- Engine plumbing ---------------------------------------------------

function setupWorker() {
  try {
    worker = new Worker(new URL('../engine/worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
}

async function computeMove() {
  // Send the actual board state (a cell grid) rather than a move list, so this
  // works even after "Fix board" rebuilds the position with no move history.
  const grid = gridFromBoard();
  if (worker) {
    return new Promise((resolve) => {
      const onMsg = (ev) => {
        worker.removeEventListener('message', onMsg);
        resolve(ev.data);
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ grid, timeMs: AI_TIME_MS });
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
  const b = Board.fromCells(grid);
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
      cell.addEventListener('click', (e) => {
        if (state === 'editing') {
          e.stopPropagation();
          editTapCell(c, r);
        }
      });
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

// Outline only the most recently placed disc: green for the engine's move
// (shown while waiting for the opponent's tap), red for the opponent's move
// (shown while the AI is thinking).
function markLastMove() {
  boardEl.querySelectorAll('.last-you, .last-opp').forEach((d) =>
    d.classList.remove('last-you', 'last-opp'),
  );
  const hist = board.history;
  if (!hist.length) return;
  const col = hist[hist.length - 1];
  let row = -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board.cellAt(r, col) !== 0) { row = r; break; }
  }
  if (row < 0) return;
  const cls = board.cellAt(row, col) === youPlayer ? 'last-you' : 'last-opp';
  cells[col][row].querySelector('.disc')?.classList.add(cls);
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
  // Keep the finished board on screen (no auto-reset / blocking pop-up); the
  // result goes to the readout and the user starts over with New game when ready.
  if (board.wins()) {
    state = 'over';
    updatePlayable();
    highlightWin();
    const youWon = board.winner === youPlayer;
    setConsole(
      youWon ? 'play' : 'await',
      youWon ? 'You win' : 'Opponent wins',
      youWon ? 'WIN' : 'LOSS',
      'Board kept — press New game when you’re ready',
    );
    return true;
  }
  if (board.isFull) {
    state = 'over';
    updatePlayable();
    setConsole('think', 'Draw', '=', 'Board kept — press New game when you’re ready');
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
  markLastMove();
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
  if (state === 'you-thinking' || state === 'animating' || state === 'editing') return;
  if (board._stack.length === 0) return; // nothing to step back (e.g. just after Fix board)
  board.undo();
  while (board.moves > 0 && board.currentPlayer === youPlayer) board.undo();
  hideOverlay();
  clearWinHighlight();
  renderDiscs();
  markLastMove();
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

// ---- Fix-board editor --------------------------------------------------
// Lets the user make the on-screen board match the real, physical board after
// a misplaced piece, then resume. Tap empty space to add a disc (it falls to
// the lowest slot), tap a disc to remove it (the column collapses). The color
// brush defaults to your discs since fixing your own move is the common case.

function gridFromBoard() {
  const g = [];
  for (let c = 0; c < COLS; c++) {
    g[c] = [];
    for (let r = 0; r < ROWS; r++) g[c][r] = board.cellAt(r, c);
  }
  return g;
}

function renderEditGrid() {
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const cell = cells[c][r];
      cell.innerHTML = '';
      const v = editGrid[c][r];
      if (!v) continue;
      const disc = document.createElement('div');
      disc.className = `disc ${classFor(v)}`;
      disc.dataset.v = String(v);
      cell.appendChild(disc);
    }
  }
}

function updateBrushUI() {
  $('brushYou').classList.toggle('is-active', editBrush === youPlayer);
  $('brushOpp').classList.toggle('is-active', editBrush === oppPlayer);
}

function editTapCell(c, r) {
  const col = editGrid[c];
  if (col[r] !== 0) {
    // Remove the tapped disc; everything above it drops down one (stays gravity-valid).
    for (let rr = r; rr < ROWS - 1; rr++) col[rr] = col[rr + 1];
    col[ROWS - 1] = 0;
  } else {
    // Add a disc of the current brush to the lowest empty slot in this column.
    for (let rr = 0; rr < ROWS; rr++) {
      if (col[rr] === 0) {
        col[rr] = editBrush;
        break;
      }
    }
  }
  renderEditGrid();
}

function enterEdit() {
  if (state === 'you-thinking' || state === 'animating') return;
  state = 'editing';
  editGrid = gridFromBoard();
  editBrush = youPlayer;
  hideOverlay();
  clearWinHighlight();
  clearPreviews();
  renderEditGrid();
  boardEl.classList.add('editing');
  boardEl.classList.remove('playable');
  $('fixBoard').classList.add('is-active');
  $('editbar').hidden = false;
  updateBrushUI();
  setConsole('think', 'Fix board', '✎', 'Tap empty space to add · tap a disc to remove');
}

function doneEdit() {
  if (state !== 'editing') return;
  board = Board.fromCells(editGrid);
  editGrid = null;
  boardEl.classList.remove('editing');
  $('fixBoard').classList.remove('is-active');
  $('editbar').hidden = true;
  clearWinHighlight();
  renderDiscs();
  if (board.isOver) {
    checkEnd();
    return;
  }
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

  $('fixBoard').addEventListener('click', () => (state === 'editing' ? doneEdit() : enterEdit()));
  $('editDone').addEventListener('click', doneEdit);
  $('brushYou').addEventListener('click', () => { editBrush = youPlayer; updateBrushUI(); });
  $('brushOpp').addEventListener('click', () => { editBrush = oppPlayer; updateBrushUI(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
