// Web Worker: runs the search off the main thread so the UI stays responsive.
// Consults the opening book first (instant, precomputed moves), then searches.

import { Board } from './board.js';
import { bestMove } from './search.js';
import { bookMove, loadBook } from './book.js';
import { TranspositionTable } from './transposition.js';

const bookReady = loadBook(new URL('../../assets/book.json', import.meta.url));

// A transposition table kept alive across moves in a game: each move reuses the
// work done on previous ones, which effectively buys extra search depth. Reset
// it when a new/earlier position appears (new game or undo) or it grows too big.
let tt = new TranspositionTable();
let lastMoves = -1;
const TT_CAP = 600000;

self.onmessage = async (e) => {
  const { grid, moves = [], timeMs = 1500, maxDepth = 60 } = e.data || {};
  await bookReady;
  // Prefer a full cell grid (works for "Fix board" positions that have no move
  // history); fall back to a move list for older callers.
  const board = grid ? Board.fromCells(grid) : Board.fromMoves(moves);

  if (board.moves < lastMoves || tt.size > TT_CAP) tt = new TranspositionTable();
  lastMoves = board.moves;

  const booked = bookMove(board);
  if (booked >= 0) {
    self.postMessage({ col: booked, score: 0, depth: 0, nodes: 0, book: true });
    return;
  }
  self.postMessage({ ...bestMove(board, { timeMs, maxDepth, tt }), book: false });
};
