export interface Occluder {
  markCrossings(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void;
  lowestCoverBottom(px: number, feetY: number, pz: number): number;
  markCutaway(cutY: number, px: number, pz: number): void;
  clearMarks(): void;
  fadedCount(): number;
  cutCount(): number;
  stepFade(dtSec: number): void;
  restore(): void;
  dispose(): void;
}
