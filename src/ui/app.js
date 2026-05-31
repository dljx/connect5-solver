// Game controller: owns the Board, renders it to the DOM, handles input, and
// drives the AI move via a Web Worker (with a main-thread fallback).

import { Board, ROWS, COLS } from '../engine/engine.js';
import { WINDOWS } from '../engine/constants.js';

const AI_TIME_MS = 2000; // "max difficulty" think budget per move
const DROP_MS = 380; // must match the CSS drop animation

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const boardEl = $('board');
const statusEl = $('status');
const statusText = $('statusText');
const overlay = $('overlay');

let board = new Board();
let humanPlayer = 1; // 1 = you go first, 2 = AI goes first
let aiPlayer = 2;
let firstChoice = 'you';
let state = 'idle'; // 'human' | 'ai' | 'animating' | 'over'
let cells = []; // cells[col][row] -> element
let worker = null;

// ---- Worker / AI -------------------------------------------------------

function setupWorker() {
  try {
    worker = new Worker(new URL('../engine/worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null; // fall back to main-thread search
  }
}

function computeMove() {
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
  return import('../engine/search.js').then(async ({ bestMove }) => {
    await wait(30); // let the "thinking" state paint first
    return bestMove(Board.fromMoves(moves), { timeMs: AI_TIME_MS });
  });
}

// ---- Rendering ---------------------------------------------------------

function buildBoard() {
  boardEl.innerHTML = '';
  cells = [];
  for (let c = 0; c < COLS; c++) {
    const col = document.createElement('div');
    col.className = 'col';
    col.dataset.col = String(c);
    col.setAttribute('role', 'button');
    col.tabIndex = 0;
    col.setAttribute('aria-label', `Drop in column ${c + 1}`);
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
  }
}

function classFor(value) {
  return value === humanPlayer ? 'p-you' : 'p-ai';
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
  if (state !== 'human') return;
  const r = board.landingRow(col);
  if (r < 0) return;
  const cell = cells[col][r];
  const existing = cell.querySelector('.preview');
  if (on && !existing && board.cellAt(r, col) === 0) {
    const ghost = document.createElement('div');
    ghost.className = `disc preview ${classFor(humanPlayer)}`;
    cell.appendChild(ghost);
  } else if (!on && existing) {
    existing.remove();
  }
}

function clearPreviews() {
  boardEl.querySelectorAll('.preview').forEach((d) => d.remove());
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

// ---- Status & overlay --------------------------------------------------

function setStatus(mode, text) {
  statusEl.dataset.mode = mode;
  statusText.textContent = text;
}

function showOverlay(winner) {
  const emblem = $('overlayEmblem');
  if (winner === 0) {
    $('overlayTitle').textContent = 'Draw';
    $('overlaySub').textContent = 'The board is full.';
    emblem.style.cssText = '--c0:#9aa6c8;--c1:#5b678a';
  } else if (winner === humanPlayer) {
    $('overlayTitle').textContent = 'You win!';
    $('overlaySub').textContent = 'Nice — you beat the engine.';
    emblem.style.cssText = '--c0:var(--you-0);--c1:var(--you-1)';
  } else {
    $('overlayTitle').textContent = 'AI wins';
    $('overlaySub').textContent = 'The engine found the line.';
    emblem.style.cssText = '--c0:var(--ai-0);--c1:var(--ai-1)';
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
    highlightWin();
    setStatus('over', board.winner === humanPlayer ? 'You win!' : 'AI wins');
    showOverlay(board.winner);
    return true;
  }
  if (board.isFull) {
    state = 'over';
    setStatus('over', 'Draw');
    showOverlay(0);
    return true;
  }
  return false;
}

async function drop(col) {
  const row = board.landingRow(col);
  board.play(col);
  state = 'animating';
  renderDiscs({ col, row });
  await wait(DROP_MS);
}

async function onColumn(col) {
  if (state !== 'human' || !board.canPlay(col)) return;
  clearPreviews();
  await drop(col);
  if (checkEnd()) return;
  await aiTurn();
}

async function aiTurn() {
  if (board.isOver) return;
  state = 'ai';
  setStatus('ai', 'AI is thinking…');
  const { col } = await computeMove();
  await drop(col);
  if (checkEnd()) return;
  state = 'human';
  setStatus('human', 'Your move');
}

async function hint() {
  if (state !== 'human') return;
  setStatus('ai', 'Finding your best move…');
  const { col } = await computeMove();
  state = 'human';
  setStatus('human', `Hint: column ${col + 1}`);
  const el = boardEl.children[col];
  el.style.background = 'rgba(255,209,102,0.25)';
  setTimeout(() => (el.style.background = ''), 900);
}

function undo() {
  if (state === 'ai' || state === 'animating') return;
  if (board.moves === 0) return;
  board.undo(); // undo last ply
  if (board.currentPlayer !== humanPlayer && board.moves > 0) board.undo();
  hideOverlay();
  boardEl.querySelectorAll('.win').forEach((d) => d.classList.remove('win'));
  renderDiscs();
  if (board.currentPlayer === aiPlayer && !board.isOver) {
    aiTurn();
  } else {
    state = 'human';
    setStatus('human', 'Your move');
  }
}

function newGame() {
  humanPlayer = firstChoice === 'you' ? 1 : 2;
  aiPlayer = 3 - humanPlayer;
  board = new Board();
  hideOverlay();
  buildBoard();
  if (humanPlayer === 2) {
    aiTurn();
  } else {
    state = 'human';
    setStatus('human', 'Your move');
  }
}

// ---- Wiring ------------------------------------------------------------

function init() {
  setupWorker();
  buildBoard();
  state = 'human';
  setStatus('human', 'Your move');

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
  $('hint').addEventListener('click', hint);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
