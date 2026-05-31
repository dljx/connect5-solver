// Mutable game state for gravity Connect-5, using the two-bitboard trick:
//   position = bitboard of the side-to-move's discs
//   mask     = bitboard of all discs (both players)
// key = position + mask uniquely encodes the position (reversible hash).

import {
  ROWS,
  COLS,
  H1,
  bottomMaskCol,
  topMaskCol,
  columnMaskCol,
  COLUMN_ORDER,
  isWin,
  mirrorBits,
  popcount,
} from './constants.js';

export class Board {
  constructor() {
    this.position = 0n; // side-to-move's discs
    this.mask = 0n; // all discs
    this.moves = 0; // plies played
    this.history = []; // columns played, in order
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
      for (let r = 0; r < ROWS; r++) {
        const v = grid[c] ? grid[c][r] : 0;
        if (!v) continue;
        const bit = 1n << BigInt(c * H1 + r);
        if (v === 1) p1 |= bit;
        else p2 |= bit;
      }
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
    return col >= 0 && col < COLS && (this.mask & topMaskCol(col)) === 0n;
  }

  /** Columns that can still be played, in center-first search order. */
  legalMoves() {
    return COLUMN_ORDER.filter((c) => this.canPlay(c));
  }

  /** Would dropping in `col` complete a 5-in-a-row for the side to move? */
  isWinningMove(col) {
    if (!this.canPlay(col)) return false;
    const moveBit = (this.mask + bottomMaskCol(col)) & columnMaskCol(col);
    return isWin(this.position | moveBit);
  }

  play(col) {
    if (!this.canPlay(col)) throw new Error(`illegal move: column ${col}`);
    this._stack.push([this.position, this.mask]);
    this.position ^= this.mask; // switch perspective to the other player
    this.mask |= this.mask + bottomMaskCol(col); // add the dropped disc
    this.moves += 1;
    this.history.push(col);
  }

  undo() {
    const prev = this._stack.pop();
    if (!prev) throw new Error('nothing to undo');
    [this.position, this.mask] = prev;
    this.moves -= 1;
    this.history.pop();
  }

  /** Row index where a disc dropped into `col` would land (or -1 if full). */
  landingRow(col) {
    if (!this.canPlay(col)) return -1;
    let row = 0;
    while ((this.mask & (1n << BigInt(col * H1 + row))) !== 0n) row++;
    return row;
  }

  /** True if the player who just moved has 5-in-a-row. */
  wins() {
    return this.moves > 0 && isWin(this.lastPlayerStones);
  }

  /** Winning player (1 or 2), or 0 if the position is not won. */
  get winner() {
    return this.wins() ? 3 - this.currentPlayer : 0;
  }

  get isFull() {
    return this.moves >= ROWS * COLS;
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
    const bit = 1n << BigInt(col * H1 + row);
    if ((this.mask & bit) === 0n) return 0;
    return (this.stonesOf(1) & bit) !== 0n ? 1 : 2;
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
