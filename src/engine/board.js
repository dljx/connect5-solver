// Mutable game state for gravity Connect-5.
//
// Two representations are kept in lock-step:
//   * A fast integer board used by the search hot path: `cells` (a flat
//     0/1/2 array, cells[col*ROWS+row], row 0 = bottom) and `heights` (the
//     next free row per column). All per-node work (move generation, win
//     detection, evaluation, ordering) reads these plain-number arrays.
//   * The classic Pascal-Pons bitboards `position` (side-to-move's discs) and
//     `mask` (all discs), kept only so that `key()`/`canonical()` stay exact
//     and the opening book (keyed by those) needs no regeneration.
//
// Keeping the bitboards costs ~3 BigInt ops per move; everything else is now
// plain-number array math, which is ~100x cheaper than the old all-BigInt core.

import {
  ROWS,
  COLS,
  bottomMaskCol,
  COLUMN_ORDER,
  mirrorBits,
  popcount,
} from './constants.js';

const NCELLS = ROWS * COLS;

// Axes for win detection: horizontal, vertical, diag "/", diag "\".
const AXES = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * Would a disc of player `p` placed at (row, col) complete a run of 5+? Counts
 * existing same-colour discs outward along each axis (so it also works when the
 * disc is already present, e.g. for `wins()`). Overlines (6+) count as wins.
 */
function makesFive(cells, row, col, p) {
  for (const [dr, dc] of AXES) {
    let run = 1;
    for (let s = 1; ; s++) {
      const r = row + dr * s;
      const c = col + dc * s;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || cells[c * ROWS + r] !== p) break;
      run++;
    }
    for (let s = 1; ; s++) {
      const r = row - dr * s;
      const c = col - dc * s;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || cells[c * ROWS + r] !== p) break;
      run++;
    }
    if (run >= 5) return true;
  }
  return false;
}

export class Board {
  constructor() {
    this.position = 0n; // side-to-move's discs (bitboard, for key/canonical only)
    this.mask = 0n; // all discs (bitboard)
    this.moves = 0; // plies played
    this.history = []; // columns played, in order
    this.cells = new Int8Array(NCELLS); // 0 empty, 1 player1, 2 player2
    this.heights = new Int8Array(COLS); // next free row per column
    this._stack = []; // [position, mask] snapshots for undo
  }

  /** Rebuild a board by replaying a list of columns. */
  static fromMoves(cols) {
    const b = new Board();
    for (const c of cols) b.play(c);
    return b;
  }

  /**
   * Build a board directly from a grid of cell values, where grid[col][row] is
   * 0 (empty), 1 (first player), or 2 (second player) and row 0 is the bottom.
   * Used by the "Fix board" editor to resume from an arbitrary physical
   * position. Columns are assumed filled bottom-up (the editor enforces this).
   * The side to move is inferred from the disc counts. History is empty, so
   * undo is unavailable until further moves are played.
   */
  static fromCells(grid) {
    const b = new Board();
    let p1 = 0n;
    let p2 = 0n;
    for (let c = 0; c < COLS; c++) {
      let h = 0;
      for (let r = 0; r < ROWS; r++) {
        const v = grid[c] ? grid[c][r] : 0;
        if (!v) continue;
        b.cells[c * ROWS + r] = v;
        h = r + 1;
        const bit = 1n << BigInt(c * (ROWS + 1) + r);
        if (v === 1) p1 |= bit;
        else p2 |= bit;
      }
      b.heights[c] = h;
    }
    b.mask = p1 | p2;
    b.moves = popcount(b.mask);
    b.position = b.moves % 2 === 0 ? p1 : p2; // first player moves on even plies
    return b;
  }

  clone() {
    const b = new Board();
    b.position = this.position;
    b.mask = this.mask;
    b.moves = this.moves;
    b.history = this.history.slice();
    b.cells = this.cells.slice();
    b.heights = this.heights.slice();
    b._stack = this._stack.slice();
    return b;
  }

  /** 1 on even plies (first player), 2 on odd plies. */
  get currentPlayer() {
    return this.moves % 2 === 0 ? 1 : 2;
  }

  /** Disc bitboard of the player who just moved (empty before any move). */
  get lastPlayerStones() {
    return this.position ^ this.mask;
  }

  canPlay(col) {
    return col >= 0 && col < COLS && this.heights[col] < ROWS;
  }

  /** Columns that can still be played, in center-first search order. */
  legalMoves() {
    const out = [];
    for (let i = 0; i < COLS; i++) {
      const c = COLUMN_ORDER[i];
      if (this.heights[c] < ROWS) out.push(c);
    }
    return out;
  }

  /** Would dropping in `col` complete a 5-in-a-row for the side to move? */
  isWinningMove(col) {
    if (!this.canPlay(col)) return false;
    return makesFive(this.cells, this.heights[col], col, this.currentPlayer);
  }

  play(col) {
    const row = this.heights[col];
    if (col < 0 || col >= COLS || row >= ROWS) throw new Error(`illegal move: column ${col}`);
    this.cells[col * ROWS + row] = this.currentPlayer;
    this.heights[col] = row + 1;
    this._stack.push([this.position, this.mask]);
    this.position ^= this.mask; // switch perspective to the other player
    this.mask |= this.mask + bottomMaskCol(col); // add the dropped disc
    this.moves += 1;
    this.history.push(col);
  }

  undo() {
    const prev = this._stack.pop();
    if (!prev) throw new Error('nothing to undo');
    const col = this.history.pop();
    const row = this.heights[col] - 1;
    this.heights[col] = row;
    this.cells[col * ROWS + row] = 0;
    [this.position, this.mask] = prev;
    this.moves -= 1;
  }

  /** Row index where a disc dropped into `col` would land (or -1 if full). */
  landingRow(col) {
    return this.canPlay(col) ? this.heights[col] : -1;
  }

  /** True if the player who just moved has 5-in-a-row. */
  wins() {
    if (this.moves === 0) return false;
    const p = 3 - this.currentPlayer; // the player who just moved
    for (let c = 0; c < COLS; c++) {
      const h = this.heights[c];
      for (let r = 0; r < h; r++) {
        if (this.cells[c * ROWS + r] === p && makesFive(this.cells, r, c, p)) return true;
      }
    }
    return false;
  }

  /** Winning player (1 or 2), or 0 if the position is not won. */
  get winner() {
    return this.wins() ? 3 - this.currentPlayer : 0;
  }

  get isFull() {
    return this.moves >= NCELLS;
  }

  get isOver() {
    return this.wins() || this.isFull;
  }

  /** Disc bitboard for a given player number (1 or 2). */
  stonesOf(player) {
    return player === this.currentPlayer ? this.position : this.lastPlayerStones;
  }

  /** 0 = empty, 1 = player 1, 2 = player 2, at a given cell. */
  cellAt(row, col) {
    return this.cells[col * ROWS + row];
  }

  /** Unique reversible position key for the transposition table. */
  key() {
    return this.position + this.mask;
  }

  /**
   * Canonical key under left-right mirror symmetry (the only symmetry gravity
   * preserves). Returns the smaller of the position's key and its mirror's key,
   * plus whether the mirror was chosen. Used to share book/TT entries between a
   * position and its reflection.
   */
  canonical() {
    const key = this.position + this.mask;
    const mkey = mirrorBits(this.position) + mirrorBits(this.mask);
    return mkey < key ? { key: mkey, mirrored: true } : { key, mirrored: false };
  }
}

export { makesFive };
