import test from 'node:test';
import assert from 'node:assert/strict';

import { Board } from '../src/engine/board.js';
import { mirrorBits, bitIndex, COLS } from '../src/engine/constants.js';
import { setBook, bookMove } from '../src/engine/book.js';

test('mirrorBits maps column c to COLS-1-c', () => {
  const bb = 1n << BigInt(bitIndex(0, 0)); // bottom of column 0
  assert.equal(mirrorBits(bb), 1n << BigInt(bitIndex(0, COLS - 1)));
});

test('mirrorBits is an involution', () => {
  const b = Board.fromMoves([0, 3, 3, 4, 8]);
  assert.equal(mirrorBits(mirrorBits(b.mask)), b.mask);
  assert.equal(mirrorBits(mirrorBits(b.position)), b.position);
});

test('a position and its mirror share a canonical key', () => {
  const a = Board.fromMoves([0, 1, 2]);
  const b = Board.fromMoves([COLS - 1, COLS - 2, COLS - 3]); // mirror image
  assert.equal(a.canonical().key, b.canonical().key);
});

test('bookMove gives mirror-consistent moves', () => {
  const a = Board.fromMoves([3]);
  setBook({ [a.canonical().key.toString()]: 2 });
  const mirror = Board.fromMoves([COLS - 1 - 3]);
  const ca = bookMove(a);
  const cm = bookMove(mirror);
  assert.ok(ca >= 0 && cm >= 0);
  assert.equal(cm, COLS - 1 - ca); // reflected position -> reflected move
  setBook(null);
});

test('bookMove returns -1 when the position is absent or no book loaded', () => {
  setBook(null);
  assert.equal(bookMove(new Board()), -1);
  setBook({});
  assert.equal(bookMove(new Board()), -1);
  setBook(null);
});
