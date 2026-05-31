// Tests for the "Fix board" reconstruction (Board.fromCells) and the
// gravity-aware threat evaluation that hardens the engine against the
// double-threat traps that used to beat it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/engine/board.js';
import { bestMove, evaluate } from '../src/engine/search.js';
import { ROWS, COLS } from '../src/engine/constants.js';

/** Make an empty COLS x ROWS grid (grid[col][row]). */
function emptyGrid() {
  return Array.from({ length: COLS }, () => Array(ROWS).fill(0));
}

test('fromCells reconstructs cells and infers the side to move', () => {
  const g = emptyGrid();
  g[0][0] = 1;
  g[0][1] = 2;
  g[1][0] = 1; // p1 has 2 discs, p2 has 1 -> 3 plies played -> player 2 to move
  const b = Board.fromCells(g);
  assert.equal(b.cellAt(0, 0), 1);
  assert.equal(b.cellAt(1, 0), 2);
  assert.equal(b.cellAt(0, 1), 1);
  assert.equal(b.cellAt(0, 2), 0);
  assert.equal(b.moves, 3);
  assert.equal(b.currentPlayer, 2);
});

test('evaluate flags an opponent double threat as near-lost', () => {
  // Player 2 is to move; player 1 (opponent) has four on row 0 (cols 2..5)
  // with both ends (cols 1 and 6) open and playable -> unstoppable.
  const g = emptyGrid();
  for (const c of [2, 3, 4, 5]) g[c][0] = 1; // opponent's open four
  g[0][0] = 2; g[0][1] = 2; g[0][2] = 2; // p2 filler (3 discs) -> p2 to move
  const b = Board.fromCells(g);
  assert.equal(b.currentPlayer, 2);
  assert.ok(evaluate(b) < -50000, `expected near-loss, got ${evaluate(b)}`);
});

test('engine blocks the only open end of an opponent four', () => {
  // Engine = player 1, to move. Opponent (p2) has cols 2..5 on row 0; the
  // left end (col 1) is sealed, so col 6 is the one winning square to block.
  const g = emptyGrid();
  for (const c of [2, 3, 4, 5]) g[c][0] = 2;
  g[1][0] = 1; // seals the left end
  g[8][0] = 1; g[8][1] = 1; g[8][2] = 1; // p1 filler -> 4 vs 4 -> p1 to move
  const b = Board.fromCells(g);
  assert.equal(b.currentPlayer, 1);
  const { col } = bestMove(b, { timeMs: 500 });
  assert.equal(col, 6);
});
