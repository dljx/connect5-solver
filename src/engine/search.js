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

// Gravity-urgency bonuses: empty cells at low gravity depth (close to playable)
// make a partial line far more dangerous than a buried one. These bonuses scale
// the window score by how soon the threat could actually fire.
const GRA_CAP = 4;                    // gravity depth ≥ this → no urgency contribution
const GRA_WT  = [0, 0, 2, 15, 200];  // per gravity-unit, indexed by disc count in window
// A 3-in-a-row with BOTH extending cells immediately playable is a double threat
// in the making: the opponent will have two winning options in one move.
const DOUBLE_LIVE_3 = 500;

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
    let gravSum = 0;  // sum of urgency contributions from empty cells
    let liveCount = 0; // empties at gravity depth 0 (immediately playable)
    for (let i = 0; i < 5; i++) {
      const idx = win[i];
      const v = cells[idx];
      if (v === me) p++;
      else if (v === opp) o++;
      else {
        emptyCount++;
        empty = idx;
        // Gravity depth: how many discs must precede this cell in its column.
        // idx = col*ROWS + row, so col = idx/ROWS|0, row = idx%ROWS.
        const d = (idx % ROWS) - heights[(idx / ROWS) | 0];
        if (d <= 0) { liveCount++; gravSum += GRA_CAP; }
        else if (d < GRA_CAP) gravSum += GRA_CAP - d;
      }
    }
    if (o === 0 && p > 0) {
      score += WINDOW_WEIGHT[p] + GRA_WT[p] * gravSum;
      if (p === 3 && liveCount === 2) score += DOUBLE_LIVE_3;
    } else if (p === 0 && o > 0) {
      score -= WINDOW_WEIGHT[o] + GRA_WT[o] * gravSum;
      if (o === 3 && liveCount === 2) score -= DOUBLE_LIVE_3;
    }
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

// ─── VCF (Victory by Continuous Forcing) search ───────────────────────────
//
// Standard alpha-beta can't see forcing sequences 25+ plies deep. VCF only
// searches moves that create an immediately-playable winning square ("four
// threat") for the attacker, then the single forced block by the defender,
// and recurses. The tree is extremely narrow (1-3 threat moves × 1 forced
// response per ply-pair), so a 28-ply sequence costs ~a few hundred nodes.
//
// Used at the root of each engine turn to:
//   (a) detect our own forcing wins and return them instantly, and
//   (b) tag moves that hand the opponent a VCF sequence so they are
//       placed last in root move ordering — effectively avoiding them.

const VCF_PLY = 28;        // max depth of forcing chain to search
const VCF_WIN_CAP  = 80000; // node budget for checking if engine has VCF
const VCF_MOVE_CAP = 8000;  // node budget per move for opponent-VCF detection

/**
 * Returns true if the side to move can force a win via a continuous chain of
 * four-threats. `nodes.n` is incremented for each position examined; search
 * aborts early (returning false) if `nodes.n` exceeds `nodes.cap`.
 *
 * `trace`, if provided, will have `trace.col` set to the first VCF move when
 * a win is found — used by the caller to return the actual winning column.
 */
function vcfWin(board, maxPly, nodes, trace) {
  if (++nodes.n > nodes.cap) return false;

  const me = board.currentPlayer;
  const { cells, heights } = board;

  // Immediate win (base case — also the anchor of each recursive call).
  for (let c = 0; c < COLS; c++) {
    if (heights[c] < ROWS && makesFive(cells, heights[c], c, me)) return true;
  }
  if (maxPly <= 0) return false;

  // Try every column as a potential threat move, center-first for best pruning.
  for (let i = 0; i < COLS; i++) {
    const c = COLUMN_ORDER[i];
    const r = heights[c];
    if (r >= ROWS) continue;

    // Tentatively place to count how many winning squares I'd have afterwards.
    cells[c * ROWS + r] = me;
    heights[c] = r + 1;

    let nThreats = 0;
    let tc1 = -1; // the single threatened column (if nThreats === 1)
    for (let tc = 0; tc < COLS; tc++) {
      const tr = heights[tc];
      if (tr < ROWS && makesFive(cells, tr, tc, me)) {
        nThreats++;
        tc1 = tc;
        if (nThreats >= 2) break;
      }
    }

    cells[c * ROWS + r] = 0; // revert tentative
    heights[c] = r;

    if (nThreats === 0) continue; // not a threat move — skip

    // Commit the move properly (updates bitboards for key/TT correctness).
    board.play(c);

    if (nThreats >= 2) {
      // Double threat: opponent can only block one → we win.
      if (trace && trace.col < 0) trace.col = c;
      board.undo();
      return true;
    }

    // Single threat at column tc1. Opponent MUST block there — unless they
    // have an immediate win of their own (which they'd play instead).
    const opp = 3 - me;
    let oppWins = false;
    for (let oc = 0; oc < COLS; oc++) {
      if (board.heights[oc] < ROWS && makesFive(board.cells, board.heights[oc], oc, opp)) {
        oppWins = true;
        break;
      }
    }

    let found = false;
    if (!oppWins && board.canPlay(tc1)) {
      board.play(tc1); // force the block
      found = vcfWin(board, maxPly - 2, nodes, null); // null: don't re-trace
      board.undo();
    }

    board.undo(); // undo our threat move c

    if (found) {
      if (trace && trace.col < 0) trace.col = c;
      return true;
    }
  }

  return false;
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
 * Order candidate moves to maximize alpha-beta cutoffs: TT move and killer
 * first, central columns next, moves handing opponent an immediate reply
 * pushed back. At the root, `vcfLosing` (a Set of columns) marks moves that
 * give the opponent a full VCF forcing win — those are penalised even harder.
 */
function orderedMoves(board, ttMove, killer, history, vcfLosing) {
  const legal = board.legalMoves(); // already center-first
  const scored = [];
  for (let i = 0; i < legal.length; i++) {
    const col = legal[i];
    let s = legal.length - i; // center bias
    if (col === ttMove) s += 100000;
    if (col === killer) s += 5000;
    if (history) s += Math.min(history[col] | 0, 4000); // history heuristic (capped)
    if (givesOpponentWin(board, col)) s -= 50000; // suicidal: lets opponent win next move
    if (vcfLosing?.has(col)) s -= 80000; // gives opponent a full VCF forcing win
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

  // ── VCF root analysis ───────────────────────────────────────────────────
  // Run once per engine turn (not per search node): cheap relative to IDA.
  // Skip in the very early game (< 12 moves) where VCF sequences are rare.
  let vcfNodes = 0;
  const vcfLosing = new Set(); // moves that hand the opponent a VCF forcing win

  if (board.moves >= 12) {
    // (a) Can WE force a win via a VCF chain right now?
    const trace = { col: -1 };
    const winNodes = { n: 0, cap: VCF_WIN_CAP };
    if (vcfWin(board, VCF_PLY, winNodes, trace)) {
      const vcfCol = trace.col >= 0 ? trace.col : board.legalMoves()[0];
      return { col: vcfCol, score: WIN_BASE - board.moves, depth: VCF_PLY, nodes: winNodes.n };
    }
    vcfNodes = winNodes.n;

    // (b) Which of our moves hand the OPPONENT a VCF forcing win?
    for (const c of board.legalMoves()) {
      board.play(c);
      const loseNodes = { n: 0, cap: VCF_MOVE_CAP };
      if (vcfWin(board, VCF_PLY, loseNodes, null)) vcfLosing.add(c);
      vcfNodes += loseNodes.n;
      board.undo();
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  const ctx = {
    tt: opts.tt ?? new TranspositionTable(),
    nodes: vcfNodes,
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

    // Pass vcfLosing to root ordering only — not to recursive nodes.
    for (const col of orderedMoves(board, bestCol, -1, ctx.history, vcfLosing)) {
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
