// Public engine API surface (used by the UI, the Web Worker, and tools).
export { Board } from './board.js';
export { bestMove, evaluate, WIN_BASE, WIN_THRESHOLD } from './search.js';
export { ROWS, COLS, WIN } from './constants.js';
