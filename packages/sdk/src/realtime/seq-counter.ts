export interface SeqCounter {
  /** Allocates the next seq. */
  next(): number;
  /** Highest seq allocated so far; the seed itself if none yet. */
  last(): number;
}

/**
 * Per-actor outbound seq counter seeded from the wall clock. Receivers keep
 * their dedup table across a sender's reload or restart, so a counter that
 * restarted at 1 would have every event dropped as a duplicate.
 *
 * ponytail: assumes the previous instance sent under one event per ms over its
 * lifetime and that the wall clock never went backwards.
 */
export function createSeqCounter(seed: () => number = Date.now): SeqCounter {
  let last = seed();
  return { next: () => ++last, last: () => last };
}
