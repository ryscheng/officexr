export interface Occluder {
  markCrossings(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void;
  lowestCoverBottom(px: number, feetY: number, pz: number): number;
  markCutaway(cutY: number, px: number, pz: number): void;
  setIgnored(ids: ReadonlySet<string>): void;
  blocksSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ignore: ReadonlySet<string>): boolean;
  clearMarks(): void;
  clearCutaway(): void;
  fadedCount(): number;
  cutCount(): number;
  stepFade(dtSec: number): void;
  restore(): void;
  dispose(): void;
}
