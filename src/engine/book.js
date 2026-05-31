// Opening book: a precomputed map of canonical position key -> best column,
// generated offline by tools/genbook.js. Lookups use the board's canonical
// (mirror-folded) key and un-mirror the stored move when needed.

import { COLS } from './constants.js';

let BOOK = null;

/** Inject a book object directly (used by tests and the loader). */
export function setBook(obj) {
  BOOK = obj;
}

export function hasBook() {
  return BOOK !== null;
}

/** Fetch and install the book JSON; never throws (missing book = no-op). */
export async function loadBook(url) {
  try {
    const res = await fetch(url);
    BOOK = res.ok ? await res.json() : {};
  } catch {
    BOOK = {};
  }
  return BOOK;
}

/** Best column from the book for the side to move, or -1 if not found. */
export function bookMove(board) {
  if (!BOOK) return -1;
  const { key, mirrored } = board.canonical();
  const stored = BOOK[key.toString()];
  if (stored === undefined) return -1;
  const col = mirrored ? COLS - 1 - stored : stored;
  return board.canPlay(col) ? col : -1;
}
