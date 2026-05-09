// Deterministic clock for tests. Supplies now() and a way to advance time.

export interface Clock {
  now(): number;
}

export class FakeClock implements Clock {
  private t: number;
  constructor(initial = 0) {
    this.t = initial;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(t: number): void {
    this.t = t;
  }
}
