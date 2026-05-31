import test from 'node:test';
import assert from 'node:assert/strict';

import { Board } from '../src/engine/board.js';
import { bestMove } from '../src/engine/search.js';

const randomMove = (b) => {
  const m = b.legalMoves();
  return m[Math.floor(Math.random() * m.length)];
};

test('engine (as player 1) never loses to a random opponent', () => {
  for (let g = 0; g < 8; g++) {
    const b = new Board();
    while (!b.isOver) {
      const col = b.currentPlayer === 1 ? bestMove(b, { maxDepth: 6 }).col : randomMove(b);
      b.play(col);
    }
    assert.notEqual(b.winner, 2, 'engine as P1 lost to random');
  }
});

test('engine (as player 2) never loses to a random opponent', () => {
  for (let g = 0; g < 8; g++) {
    const b = new Board();
    while (!b.isOver) {
      const col = b.currentPlayer === 2 ? bestMove(b, { maxDepth: 6 }).col : randomMove(b);
      b.play(col);
    }
    assert.notEqual(b.winner, 1, 'engine as P2 lost to random');
  }
});
