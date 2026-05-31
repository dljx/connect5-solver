// Negamax alpha-beta search with iterative deepening, a transposition table,
// center-first move ordering, and a time budget. Exact when it can reach
// terminal positions; otherwise it falls back to a heuristic at the horizon.

import {
  COLS,
  COLUMN_ORDER,
  WINDOWS,
  popcount,
  isWin,
  topMaskCol,
  bottomMaskCol,
  columnMaskCol,
} from './constants.js';
import { TranspositionTable, EXACT, LOWER, UPPER } from './transposition.js';

// Win scores sit just below WIN_BASE; subtracting the disc count makes faster
// wins score higher (and slower losses score "less bad").
export const WIN_BASE = 100000;
export const WIN_THRESHOLD = WIN_BASE - 1000;

// A two-way threat the opponent can't be stopped from converting. Kept below
// WIN_THRESHOLD so this *heuristic* verdict never masquerades as a proven mate
// (which would wrongly stop iterative deepening at the root).
const DOUBLE_THREAT = 90000;

const WINDOW_WEIGHT = [0, 1, 10, 100, 1000]; // by disc count in an uncontested window

/** How many distinct columns let `stones` complete a five right now (gravity-aware). */
function playableWinCount(stones, mask) {
  let n = 0;
  for (let c = 0; c < COLS; c++) {
    if ((mask & topMaskCol(c)) !== 0n) continue; // column full
    const moveBit = (mask + bottomMaskCol(c)) & columnMaskCol(c);
    if (isWin(stones | moveBit)) n++;
  }
  return n;
}

/** Heuristic score from the side-to-move's perspective. */
export function evaluate(board) {
  const me = board.stonesOf(board.currentPlayer);
  const opp = board.stonesOf(3 - board.currentPlayer);
  const mask = board.mask;

  // The opponent replies from here. If they already have two or more separate
  // playable winning moves, we can block at most one -> this position is lost.
  // (Our own immediate wins are handled before evaluate() is ever reached.)
  const oppThreats = playableWinCount(opp, mask);
  if (oppThreats >= 2) return -DOUBLE_THREAT;

  let score = 0;
  for (const w of WINDOWS) {
    const p = popcount(me & w);
    const o = popcount(opp & w);
    if (o === 0 && p > 0) score += WINDOW_WEIGHT[p];
    else if (p === 0 && o > 0) score -= WINDOW_WEIGHT[o];
  }
  if (oppThreats === 1) score -= 600; // we'll be forced to spend our move blocking
  return score;
}

/**
 * Order candidate moves to maximize alpha-beta cutoffs (deeper search per
 * second): TT move and killer move first, central columns next, and moves that
 * hand the opponent an immediate winning reply pushed to the back.
 */
function orderedMoves(board, ttMove, killer) {
  const legal = board.legalMoves(); // already center-first
  const scored = [];
  for (let i = 0; i < legal.length; i++) {
    const col = legal[i];
    let s = legal.length - i; // center bias
    if (col === ttMove) s += 100000;
    if (col === killer) s += 5000;
    board.play(col);
    let gives = false;
    for (const r of board.legalMoves()) {
      if (board.isWinningMove(r)) { gives = true; break; }
    }
    board.undo();
    if (gives) s -= 50000; // suicidal: lets the opponent win next move
    scored.push([col, s]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.map((e) => e[0]);
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
  const killer = ctx.killers[depth];
  for (const col of orderedMoves(board, ttMove, killer)) {
    board.play(col);
    const score = -negamax(board, -beta, -alpha, depth - 1, ctx);
    board.undo();
    if (score > best) {
      best = score;
      bestMove = col;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      ctx.killers[depth] = col; // remember the move that caused this cutoff
      break;
    }
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
    killers: [],
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

    for (const col of orderedMoves(board, bestCol, -1)) {
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
