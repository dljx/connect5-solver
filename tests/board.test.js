import test from 'node:test';
import assert from 'node:assert/strict';

import { isWin, bitIndex, ROWS, COLS } from '../src/engine/constants.js';
import { Board } from '../src/engine/board.js';

// Build a raw bitboard from a list of [row, col] cells (row 0 = bottom).
const bits = (cells) =>
  cells.reduce((acc, [r, c]) => acc | (1n << BigInt(bitIndex(r, c))), 0n);

// --- isWin: pure 5-in-a-row detection on constructed bitboards ---

test('isWin: horizontal five', () => {
  assert.equal(isWin(bits([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]])), true);
});

test('isWin: vertical five', () => {
  assert.equal(isWin(bits([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])), true);
});

test('isWin: diagonal up-right five', () => {
  assert.equal(isWin(bits([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]])), true);
});

test('isWin: diagonal down-right five', () => {
  assert.equal(isWin(bits([[4, 0], [3, 1], [2, 2], [1, 3], [0, 4]])), true);
});

test('isWin: four in a row is not a win', () => {
  assert.equal(isWin(bits([[0, 0], [0, 1], [0, 2], [0, 3]])), false);
});

test('isWin: overline of six counts as a win', () => {
  assert.equal(isWin(bits([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]])), true);
});

test('isWin: no vertical wrap across the column sentinel', () => {
  // Top of column 0 + bottom of column 1 must not read as a vertical five.
  assert.equal(isWin(bits([[3, 0], [4, 0], [5, 0], [6, 0], [0, 1]])), false);
});

// --- Board: gravity mechanics, turn flow, undo, win reporting ---

test('Board: fresh board state', () => {
  const b = new Board();
  assert.equal(b.moves, 0);
  assert.equal(b.currentPlayer, 1);
  for (let c = 0; c < COLS; c++) assert.equal(b.canPlay(c), true);
});

test('Board: gravity stacking and cellAt', () => {
  const b = new Board();
  b.play(0); // player 1 lands at the bottom of column 0
  assert.equal(b.cellAt(0, 0), 1);
  b.play(0); // player 2 stacks on top
  assert.equal(b.cellAt(1, 0), 2);
  assert.equal(b.currentPlayer, 1);
});

test('Board: a column fills and rejects overfilling', () => {
  const b = new Board();
  for (let i = 0; i < ROWS; i++) b.play(0);
  assert.equal(b.canPlay(0), false);
  assert.throws(() => b.play(0));
});

test('Board: undo restores the exact prior state', () => {
  const b = new Board();
  b.play(3);
  const k = b.key();
  b.play(4);
  b.undo();
  assert.equal(b.key(), k);
  assert.equal(b.moves, 1);
});

test('Board: vertical win detected, winner is player 1', () => {
  const b = new Board();
  for (const c of [0, 1, 0, 1, 0, 1, 0, 1, 0]) b.play(c);
  assert.equal(b.wins(), true);
  assert.equal(b.winner, 1);
});

test('Board: horizontal win detected, winner is player 1', () => {
  const b = new Board();
  for (const c of [0, 5, 1, 6, 2, 7, 3, 8, 4]) b.play(c);
  assert.equal(b.wins(), true);
  assert.equal(b.winner, 1);
});

test('Board: isWinningMove flags the finishing drop', () => {
  const b = new Board();
  for (const c of [0, 1, 0, 1, 0, 1, 0, 1]) b.play(c); // p1: 4 in col0, p2: 4 in col1
  assert.equal(b.currentPlayer, 1);
  assert.equal(b.isWinningMove(0), true);
  assert.equal(b.isWinningMove(2), false);
});
