// Offline opening-book generator. Walks every reachable position up to PLIES
// half-moves (folded by left-right symmetry), runs the engine on each, and
// writes assets/book.json mapping canonical key -> best column (canonical frame).
//
// Usage:  node tools/genbook.js            (defaults below)
//         PLIES=6 TIME=600 node tools/genbook.js
//
// More PLIES / TIME => stronger, larger book, longer build.

import { writeFileSync } from 'node:fs';
import { Board } from '../src/engine/board.js';
import { bestMove } from '../src/engine/search.js';
import { COLS } from '../src/engine/constants.js';

const MAX_PLIES = Number(process.env.PLIES ?? 4);
const TIME_MS = Number(process.env.TIME ?? 400);

const book = {};
const solved = new Set(); // canonical keys we've already searched
let frontier = [new Board()];

const start = Date.now();
for (let ply = 0; ply <= MAX_PLIES; ply++) {
  const next = [];
  const nextKeys = new Set(); // dedupe expansion by canonical key
  for (const b of frontier) {
    if (b.isOver) continue;
    const { key, mirrored } = b.canonical();
    const ks = key.toString();
    if (!solved.has(ks)) {
      solved.add(ks);
      const { col } = bestMove(b, { timeMs: TIME_MS });
      book[ks] = mirrored ? COLS - 1 - col : col; // store in canonical frame
    }
    if (ply < MAX_PLIES) {
      for (const c of b.legalMoves()) {
        const child = b.clone();
        child.play(c);
        const ck = child.canonical().key.toString();
        if (!nextKeys.has(ck)) {
          nextKeys.add(ck);
          next.push(child);
        }
      }
    }
  }
  frontier = next;
  console.log(`ply ${ply}: ${Object.keys(book).length} entries (${((Date.now() - start) / 1000).toFixed(1)}s)`);
}

const out = new URL('../assets/book.json', import.meta.url);
writeFileSync(out, JSON.stringify(book));
console.log(`wrote ${Object.keys(book).length} entries to assets/book.json`);
