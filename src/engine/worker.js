// Web Worker: runs the (potentially slow) search off the main thread so the UI
// stays responsive while the engine "thinks". Receives the move history and
// replays it, then posts back the chosen column and search stats.

import { Board } from './board.js';
import { bestMove } from './search.js';

self.onmessage = (e) => {
  const { moves = [], timeMs = 1500, maxDepth = 60 } = e.data || {};
  const board = Board.fromMoves(moves);
  const result = bestMove(board, { timeMs, maxDepth });
  self.postMessage(result);
};
