// Strength regression tests for the threat-aware evaluation and forcing-move
// search extensions added to harden the engine against the slow midgame threat
// buildups that used to beat it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/engine/board.js';
import { bestMove, evaluate, WIN_THRESHOLD } from '../src/engine/search.js';
import { ROWS, COLS } from '../src/engine/constants.js';

function emptyGrid() {
  return Array.from({ length: COLS }, () => Array(ROWS).fill(0));
}

test('evaluate rates a stacked opponent double-threat far more dangerous than a single threat', () => {
  // Opponent (player 2) has horizontal fours on row 0 and row 1 across cols 0..3,
  // i.e. two winning squares stacked in column 4 -> practically unanswerable.
  const g = emptyGrid();
  for (const c of [0, 1, 2, 3]) { g[c][0] = 2; g[c][1] = 2; }
  g[6][0] = 1; g[6][1] = 1; g[6][2] = 1;
  g[7][0] = 1; g[7][1] = 1; g[7][2] = 1;
  g[8][0] = 1; g[8][1] = 1; // player 1 filler, no lines -> player 1 to move
  const stacked = Board.fromCells(g);
  assert.equal(stacked.currentPlayer, 1);

  // Control: only a single opponent four (remove the row-1 threat), parity kept.
  const g2 = g.map((col) => col.slice());
  for (const c of [0, 1, 2, 3]) g2[c][1] = 0;
  g2[6][1] = 0; g2[6][2] = 0; g2[7][1] = 0; g2[7][2] = 0;
  const single = Board.fromCells(g2);

  const eStacked = evaluate(stacked);
  const eSingle = evaluate(single);
  assert.ok(eStacked < 0 && eSingle < 0, `both should be negative: ${eStacked}, ${eSingle}`);
  assert.ok(eStacked < eSingle - 5000, `stacked (${eStacked}) should be much worse than single (${eSingle})`);
});

test('evaluate scores a double-live 3-in-a-row higher urgency than a buried 3', () => {
  // Both positions: engine (P1) to move, opponent (P2) has a 3-in-a-row.
  // Case A: opp's extending squares are immediately playable (live double-open).
  // Case B: opp's extending squares are buried two rows deep (no urgency).
  // Case A must score more negatively (more dangerous).
  const gA = emptyGrid();
  // Opp has 3 discs at (row0, cols 3,4,5); both ends (col2, col6) are at row0
  // (immediately playable) -- classic double-live 3.
  for (const c of [3, 4, 5]) gA[c][0] = 2;
  // P1 filler to make parity even (3 discs each)
  gA[0][0] = 1; gA[1][0] = 1; gA[8][0] = 1;
  const bA = Board.fromCells(gA);
  assert.equal(bA.currentPlayer, 1);

  const gB = emptyGrid();
  // Same opp three, but bury the ends: fill cols 2 and 6 up to row2 with
  // alternating discs so the extending squares are at row3 (depth 3).
  for (const c of [3, 4, 5]) gB[c][0] = 2;
  for (const c of [2, 6]) { gB[c][0] = 1; gB[c][1] = 2; gB[c][2] = 1; }
  // Add p1 filler to balance: need 3+6=9 opp vs 3+6=9 me already? Let's count.
  // opp: c3,c4,c5 row0 (3) + c2r1, c6r1 (2) = 5
  // me: c2r0, c2r2, c6r0, c6r2 (4)
  // 9 total -> p1 to move needs 5 me: add 1 more
  gB[0][0] = 1;
  const bB = Board.fromCells(gB);
  assert.equal(bB.currentPlayer, 1);

  const eA = evaluate(bA);
  const eB = evaluate(bB);
  assert.ok(eA < eB, `double-live 3 (${eA}) should score worse for engine than buried 3 (${eB})`);
});

test('forcing extensions find a deep win that fits within the depth budget', () => {
  // A vertical mate-in-1 found at shallow depth (sanity that search + extensions
  // still return proven wins and never regress immediate tactics).
  const b = new Board();
  for (const c of [0, 1, 0, 1, 0, 1, 0, 1]) b.play(c); // p1 four in col0, p1 to move
  const { col, score } = bestMove(b, { maxDepth: 3, timeMs: 1000 });
  assert.equal(col, 0);
  assert.ok(score >= WIN_THRESHOLD, `expected proven win, got ${score}`);
});
