import test from 'node:test';
import assert from 'node:assert/strict';

import { Board } from '../src/engine/board.js';
import { bestMove, WIN_THRESHOLD } from '../src/engine/search.js';

const play = (cols) => {
  const b = new Board();
  for (const c of cols) b.play(c);
  return b;
};

test('takes the immediate winning move (vertical mate-in-1)', () => {
  // p1 has four in column 0, p1 to move.
  const b = play([0, 1, 0, 1, 0, 1, 0, 1]);
  const { col, score } = bestMove(b, { maxDepth: 4 });
  assert.equal(col, 0);
  assert.ok(score >= WIN_THRESHOLD, `expected winning score, got ${score}`);
});

test('blocks the opponent immediate threat', () => {
  // p1 has four in column 0, p2 to move -> must block column 0.
  const b = play([0, 1, 0, 1, 0, 1, 0]);
  const { col } = bestMove(b, { maxDepth: 6 });
  assert.equal(col, 0);
});

test('prefers its own win over blocking the opponent', () => {
  // p1 four in col0, p2 four in col2, p1 to move -> win at col0, do not block.
  const b = play([0, 2, 0, 2, 0, 2, 0, 2]);
  const { col, score } = bestMove(b, { maxDepth: 4 });
  assert.equal(col, 0);
  assert.ok(score >= WIN_THRESHOLD);
});

test('returns a legal move on the empty board', () => {
  const b = new Board();
  const { col } = bestMove(b, { maxDepth: 4 });
  assert.ok(b.canPlay(col));
});

test('reports a losing score when the opponent has an unstoppable double threat', () => {
  // p1 to move but p2 already has an open four (both ends open) on the bottom row:
  // . . p2 p2 p2 p2 . .  -> p2 wins next regardless. p1 cannot be saved.
  // Build: p2 discs at row0 cols 3,4,5,6 with cols 2 and 7 open; p1 discs elsewhere on row0.
  const b = play([0, 3, 1, 4, 8, 5, 0, 6]); // p1: c0(r0),c1,c8,c0(r1); p2: c3,c4,c5,c6
  // p1 to move (8 plies). p2 threatens to win at col2 OR col7 -> unstoppable.
  const { score } = bestMove(b, { maxDepth: 8 });
  assert.ok(score <= -WIN_THRESHOLD, `expected losing score, got ${score}`);
});
