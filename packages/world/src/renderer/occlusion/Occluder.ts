export interface Occluder {
    markCrossings(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void;
  clearMarks(): void;
  fadedCount(): number;
  stepFade(dtSec: number): void;
    restore(): void;
  dispose(): void;
}
