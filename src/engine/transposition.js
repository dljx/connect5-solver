// Transposition table: caches search results keyed by the board's unique key.
// Flags describe how `value` relates to the true score:
//   EXACT  - value is the exact score
//   LOWER  - value is a lower bound (a beta cutoff happened)
//   UPPER  - value is an upper bound (no move beat alpha)

export const EXACT = 0;
export const LOWER = 1;
export const UPPER = 2;

export class TranspositionTable {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    return this.map.get(key);
  }

  set(key, value, depth, flag, move) {
    const existing = this.map.get(key);
    if (existing && existing.depth > depth) return; // keep the deeper result
    this.map.set(key, { value, depth, flag, move });
  }

  get size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }
}
