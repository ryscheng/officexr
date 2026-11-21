export interface Occluder {
  /** Marks the parts of this occluder that cross a->b, for the next fade step. */
  markCrossings(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void;
  /** Fraction along a->b of the first entry into this occluder, or -1. */
  firstHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number;
  clearMarks(): void;
  stepFade(dtSec: number): void;
  /** Puts every part back as it was drawn before any fade. */
  restore(): void;
  dispose(): void;
}
