// Board geometry and bitboard layout for gravity Connect-5 on a 7x9 grid.
//
// Bitboard layout (Pascal-Pons Connect-Four style): column-major, with one
// extra "sentinel" row per column so that vertical/diagonal runs can never wrap
// from the top of one column into the bottom of the next.
//
//   bit index = col * H1 + row     (row 0 = bottom of the column)
//   H1 = ROWS + 1  -> the +1 row is the always-empty sentinel.

export const ROWS = 7;
export const COLS = 9;
export const WIN = 5; // discs in a row needed to win (5 or more)

export const H1 = ROWS + 1; // bits per column, including the sentinel row
export const SIZE = COLS * H1; // total bits used (72)

export const bitIndex = (row, col) => col * H1 + row;

// Shift distances for the four directions used by the shift-AND win test:
//   vertical = 1, horizontal = H1, diagonal "\" = H1 - 1, diagonal "/" = H1 + 1.
export const DIRS = [1n, BigInt(H1), BigInt(H1 - 1), BigInt(H1 + 1)];

// Search move order: explore central columns first (they create more lines).
export const COLUMN_ORDER = [4, 3, 5, 2, 6, 1, 7, 0, 8];

// Per-column bit masks.
export const bottomMaskCol = (col) => 1n << BigInt(col * H1);
export const topMaskCol = (col) => 1n << BigInt(ROWS - 1 + col * H1);
export const columnMaskCol = (col) =>
  ((1n << BigInt(ROWS)) - 1n) << BigInt(col * H1);

// Mask of every playable cell (excludes sentinel rows).
export const BOARD_MASK = (() => {
  let m = 0n;
  for (let c = 0; c < COLS; c++) m |= columnMaskCol(c);
  return m;
})();

/**
 * True if `pos` (one player's disc bitboard) contains 5-or-more in a row in any
 * direction. Overlines (6+) naturally satisfy this. Three shift-ANDs per
 * direction: keep cells that start a run of 5 (p, p+s, p+2s, p+3s, p+4s).
 */
export function isWin(pos) {
  for (const s of DIRS) {
    let m = pos & (pos >> s);
    m &= m >> (2n * s);
    if ((m & (pos >> (4n * s))) !== 0n) return true;
  }
  return false;
}

/** Count set bits in a BigInt (Brian Kernighan's method). */
export function popcount(x) {
  let n = 0;
  while (x > 0n) {
    x &= x - 1n;
    n++;
  }
  return n;
}

/**
 * Every length-5 line ("window") on the board, as a bitmask. Used by the
 * heuristic evaluation: a window owned by exactly one player is progress toward
 * a five. 92 windows total (35 horizontal, 27 vertical, 30 diagonal).
 */
export const WINDOWS = (() => {
  const wins = [];
  const add = (cells) => {
    let m = 0n;
    for (const [r, c] of cells) m |= 1n << BigInt(bitIndex(r, c));
    wins.push(m);
  };
  const line = (r, c, dr, dc) =>
    Array.from({ length: WIN }, (_, i) => [r + dr * i, c + dc * i]);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c + WIN <= COLS; c++) add(line(r, c, 0, 1)); // horizontal
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r + WIN <= ROWS; r++) add(line(r, c, 1, 0)); // vertical
  for (let r = 0; r + WIN <= ROWS; r++)
    for (let c = 0; c + WIN <= COLS; c++) add(line(r, c, 1, 1)); // diag up-right
  for (let r = WIN - 1; r < ROWS; r++)
    for (let c = 0; c + WIN <= COLS; c++) add(line(r, c, -1, 1)); // diag down-right
  return wins;
})();
