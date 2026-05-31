// Negamax alpha-beta search with iterative deepening, a transposition table,
// center-first move ordering, and a time budget. Exact when it can reach
// terminal positions; otherwise it falls back to a heuristic at the horizon.

import { COLUMN_ORDER, WINDOWS, popcount } from './constants.js';
import { TranspositionTable, EXACT, LOWER, UPPER } from './transposition.js';

// Win scores sit just below WIN_BASE; subtracting the disc count makes faster
// wins score higher (and slower losses score "less bad").
export const WIN_BASE = 100000;
export const WIN_THRESHOLD = WIN_BASE - 1000;

const WINDOW_WEIGHT = [0, 1, 10, 100, 1000]; // by disc count in an uncontested window

/** Heuristic score from the side-to-move's perspective. */
export function evaluate(board) {
  const me = board.stonesOf(board.currentPlayer);
  const opp = board.stonesOf(3 - board.currentPlayer);
  let score = 0;
  for (const w of WINDOWS) {
    const p = popcount(me & w);
    const o = popcount(opp & w);
    if (o === 0 && p > 0) score += WINDOW_WEIGHT[p];
    else if (p === 0 && o > 0) score -= WINDOW_WEIGHT[o];
  }
  return score;
}

function orderedMoves(board, ttMove) {
  const moves = board.legalMoves();
  if (ttMove >= 0 && board.canPlay(ttMove)) {
    return [ttMove, ...moves.filter((c) => c !== ttMove)];
  }
  return moves;
}

function negamax(board, alpha, beta, depth, ctx) {
  ctx.nodes++;

  // If the side to move can win right now, that's the best possible outcome.
  for (const col of board.legalMoves()) {
    if (board.isWinningMove(col)) return WIN_BASE - (board.moves + 1);
  }
  if (board.isFull) return 0; // drawn
  if (depth === 0) return evaluate(board);

  const alphaOrig = alpha;
  const key = board.key();
  const entry = ctx.tt.get(key);
  let ttMove = -1;
  if (entry) {
    ttMove = entry.move;
    if (entry.depth >= depth) {
      if (entry.flag === EXACT) return entry.value;
      if (entry.flag === LOWER && entry.value > alpha) alpha = entry.value;
      else if (entry.flag === UPPER && entry.value < beta) beta = entry.value;
      if (alpha >= beta) return entry.value;
    }
  }

  let best = -Infinity;
  let bestMove = -1;
  for (const col of orderedMoves(board, ttMove)) {
    board.play(col);
    const score = -negamax(board, -beta, -alpha, depth - 1, ctx);
    board.undo();
    if (score > best) {
      best = score;
      bestMove = col;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cutoff
    if (ctx.deadline && performance.now() >= ctx.deadline) {
      ctx.timedOut = true;
      break;
    }
  }

  let flag = EXACT;
  if (best <= alphaOrig) flag = UPPER;
  else if (best >= beta) flag = LOWER;
  if (!ctx.timedOut) ctx.tt.set(key, best, depth, flag, bestMove);
  return best;
}

/**
 * Choose the best column for the side to move.
 * @param {Board} board
 * @param {{maxDepth?: number, timeMs?: number, tt?: TranspositionTable}} [opts]
 * @returns {{col: number, score: number, depth: number, nodes: number}}
 */
export function bestMove(board, opts = {}) {
  const { maxDepth = 60, timeMs = 1000 } = opts;

  // Immediate win short-circuit.
  for (const col of board.legalMoves()) {
    if (board.isWinningMove(col)) {
      return { col, score: WIN_BASE - (board.moves + 1), depth: 1, nodes: 1 };
    }
  }

  const ctx = {
    tt: opts.tt ?? new TranspositionTable(),
    nodes: 0,
    deadline: timeMs > 0 ? performance.now() + timeMs : 0,
    timedOut: false,
  };

  const legal = board.legalMoves();
  let bestCol = legal[0];
  let bestScore = -Infinity;
  let reached = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    ctx.timedOut = false;
    let localBest = -Infinity;
    let localCol = bestCol;
    let alpha = -Infinity;
    const beta = Infinity;

    for (const col of orderedMoves(board, bestCol)) {
      board.play(col);
      const score = -negamax(board, -beta, -alpha, depth - 1, ctx);
      board.undo();
      if (ctx.timedOut) break;
      if (score > localBest) {
        localBest = score;
        localCol = col;
      }
      if (score > alpha) alpha = score;
    }

    if (!ctx.timedOut) {
      bestCol = localCol;
      bestScore = localBest;
      reached = depth;
    } else {
      break;
    }

    if (Math.abs(bestScore) >= WIN_THRESHOLD) break; // proven result
    if (legal.length <= 1) break;
  }

  return { col: bestCol, score: bestScore, depth: reached, nodes: ctx.nodes };
}
