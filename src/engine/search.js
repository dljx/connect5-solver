// Negamax alpha-beta search with iterative deepening, a transposition table,
// center-first move ordering, and a time budget. Exact when it can reach
// terminal positions; otherwise it falls back to a heuristic at the horizon.
//
// All per-node work reads the board's fast integer arrays (cells/heights); the
// BigInt bitboards are touched only for the transposition key.

import { COLS, ROWS, COLUMN_ORDER, WINDOW_CELLS } from './constants.js';
import { makesFive } from './board.js';
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

const NCELLS = ROWS * COLS;
// Scratch threat-square maps, reused across evaluate() calls to avoid allocation.
const threatMe = new Int8Array(NCELLS);
const threatOpp = new Int8Array(NCELLS);

// Threat magnitudes. Kept modest (comparable to, not dwarfing, the positional
// window score) so they bias the search without causing it to chase phantom,
// non-proven threats. The one provably-unanswerable case (two playable winning
// replies) is handled separately with -DOUBLE_THREAT.
const STACKED = 9000; // two winning squares in one column -> usually unanswerable
const TWO_COLS = 4500; // winning squares in two different columns -> often decisive
const ONE_LIVE = 1000; // a single immediately-playable threat (we must block)
const ONE_LATENT = 1500; // a single not-yet-playable threat (a standing danger)
const CAP = DOUBLE_THREAT - 1;

/** How many distinct columns let `player` complete a five right now (gravity-aware). */
function playableWins(board, player) {
  const { cells, heights } = board;
  let n = 0;
  for (let c = 0; c < COLS; c++) {
    const r = heights[c];
    if (r < ROWS && makesFive(cells, r, c, player)) n++;
  }
  return n;
}

/**
 * Heuristic score from the side-to-move's perspective.
 *
 * Beyond the old window-occupancy count, this finds every "winning square" (an
 * empty cell that completes a five) for each side and reasons about them with
 * gravity in mind: two winning squares stacked in one column, or spread across
 * two columns, are (near-)unanswerable and dominate the score. This lets the
 * engine recognise a losing structure ~10+ plies before the five is completed,
 * which is where it used to drift into lost games.
 */
export function evaluate(board, scale = 1) {
  const me = board.currentPlayer;
  const opp = 3 - me;
  const { cells, heights } = board;

  threatMe.fill(0);
  threatOpp.fill(0);
  let score = 0;
  for (let w = 0; w < WINDOW_CELLS.length; w++) {
    const win = WINDOW_CELLS[w];
    let p = 0;
    let o = 0;
    let empty = -1;
    let emptyCount = 0;
    for (let i = 0; i < 5; i++) {
      const idx = win[i];
      const v = cells[idx];
      if (v === me) p++;
      else if (v === opp) o++;
      else {
        emptyCount++;
        empty = idx;
      }
    }
    if (o === 0 && p > 0) score += WINDOW_WEIGHT[p];
    else if (p === 0 && o > 0) score -= WINDOW_WEIGHT[o];
    if (emptyCount === 1) {
      if (p === 4 && o === 0) threatMe[empty] = 1;
      else if (o === 4 && p === 0) threatOpp[empty] = 1;
    }
  }

  // Summarise winning squares per column (gravity: only the lowest empty in a
  // column is immediately playable; a square is "live" iff it sits at that row).
  let liveOpp = 0;
  let colsOpp = 0;
  let stackOpp = 0;
  let colsMe = 0;
  let stackMe = 0;
  for (let c = 0; c < COLS; c++) {
    const base = c * ROWS;
    const h = heights[c];
    let nO = 0;
    let lowO = -1;
    let nM = 0;
    for (let r = h; r < ROWS; r++) {
      if (threatOpp[base + r]) {
        nO++;
        if (lowO < 0) lowO = r;
      }
      if (threatMe[base + r]) nM++;
    }
    if (nO > 0) {
      colsOpp++;
      if (nO >= 2) stackOpp++;
      if (lowO === h) liveOpp++;
    }
    if (nM > 0) {
      colsMe++;
      if (nM >= 2) stackMe++;
    }
  }

  // Two playable winning replies for the opponent: provably unanswerable.
  if (liveOpp >= 2) return -DOUBLE_THREAT;

  let t = 0;
  if (stackOpp >= 1) t -= STACKED;
  if (colsOpp >= 2) t -= TWO_COLS;
  else if (colsOpp === 1) t -= liveOpp ? ONE_LIVE : ONE_LATENT;

  if (stackMe >= 1) t += STACKED;
  if (colsMe >= 2) t += TWO_COLS;
  else if (colsMe === 1) t += ONE_LATENT;
  score += scale * t;

  if (score > CAP) score = CAP;
  else if (score < -CAP) score = -CAP;
  return score;
}

/** Would playing `col` hand the opponent an immediate winning reply? (cells-only, no BigInt). */
function givesOpponentWin(board, col) {
  const { cells, heights } = board;
  const me = board.currentPlayer;
  const opp = 3 - me;
  const r = heights[col];
  cells[col * ROWS + r] = me; // tentative drop
  heights[col] = r + 1;
  let gives = false;
  for (let c = 0; c < COLS; c++) {
    const rr = heights[c];
    if (rr < ROWS && makesFive(cells, rr, c, opp)) { gives = true; break; }
  }
  cells[col * ROWS + r] = 0; // revert
  heights[col] = r;
  return gives;
}

/**
 * Order candidate moves to maximize alpha-beta cutoffs (deeper search per
 * second): TT move and killer move first, central columns next, and moves that
 * hand the opponent an immediate winning reply pushed to the back.
 */
function orderedMoves(board, ttMove, killer, history) {
  const legal = board.legalMoves(); // already center-first
  const scored = [];
  for (let i = 0; i < legal.length; i++) {
    const col = legal[i];
    let s = legal.length - i; // center bias
    if (col === ttMove) s += 100000;
    if (col === killer) s += 5000;
    if (history) s += Math.min(history[col] | 0, 4000); // history heuristic (capped)
    if (givesOpponentWin(board, col)) s -= 50000; // suicidal: lets the opponent win next move
    scored.push([col, s]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.map((e) => e[0]);
}

// How many forcing-move (threat) extensions a single search path may use. Each
// extension lets the search follow a "you must block this" sequence one ply
// deeper without spending a depth level, so it sees long forced wins/losses.
const MAX_EXT = 12;

function negamax(board, alpha, beta, depth, ctx, ext) {
  ctx.nodes++;

  // If the side to move can win right now, that's the best possible outcome.
  for (const col of board.legalMoves()) {
    if (board.isWinningMove(col)) return WIN_BASE - (board.moves + 1);
  }
  if (board.isFull) return 0; // drawn
  if (depth <= 0) return evaluate(board, ctx.scale);

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
  for (const col of orderedMoves(board, ttMove, killer, ctx.history)) {
    board.play(col);
    // Forcing extension: if this move leaves the mover threatening an immediate
    // win, the reply is essentially forced, so search it a ply deeper.
    const forcing = ctx.useExt && ext > 0 && playableWins(board, 3 - board.currentPlayer) >= 1;
    const nextDepth = forcing ? depth : depth - 1;
    const nextExt = forcing ? ext - 1 : ext;
    const score = -negamax(board, -beta, -alpha, nextDepth, ctx, nextExt);
    board.undo();
    if (score > best) {
      best = score;
      bestMove = col;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      ctx.killers[depth] = col; // remember the move that caused this cutoff
      ctx.history[col] += depth * depth; // reward moves that cause cutoffs
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
    history: new Array(COLS).fill(0),
    scale: opts.threatScale ?? 1, // heuristic threat weight (0 = off, for A/B)
    useExt: opts.useExt !== false, // forcing-move extensions (default on)
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

    for (const col of orderedMoves(board, bestCol, -1, ctx.history)) {
      board.play(col);
      const forcing = ctx.useExt && playableWins(board, 3 - board.currentPlayer) >= 1;
      const score = -negamax(board, -beta, -alpha, forcing ? depth : depth - 1, ctx, forcing ? MAX_EXT - 1 : MAX_EXT);
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
