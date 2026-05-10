import type { PlayerId, PlayerState } from '../game-state/types.ts';

/**
 * Uniform XZ hash grid keyed by player position. Built fresh per tick by
 * rules that need spatial queries — players move every frame, so an
 * always-up-to-date persistent index isn't worth the bookkeeping.
 *
 * Choose `cellSize` to be at least the maximum query radius any caller
 * will use. With a 3 m proximity radius, `cellSize = 3` lets a query touch
 * at most 9 cells (its own cell + 8 neighbours).
 */
export class PlayerGrid {
  private readonly cellSize: number;
  private readonly buckets = new Map<number, PlayerId[]>();

  constructor(cellSize: number) {
    if (!(cellSize > 0)) {
      throw new Error(`PlayerGrid: cellSize must be > 0, got ${cellSize}`);
    }
    this.cellSize = cellSize;
  }

  /** Add a single player to the grid. */
  insert(id: PlayerId, x: number, z: number): void {
    const key = this.cellKey(x, z);
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(id);
    else this.buckets.set(key, [id]);
  }

  /**
   * Invoke `fn` for every player whose position lies within `radius` of
   * (x, z). The callback is invoked at most once per matching id — if a
   * player straddles a cell boundary their bucket appears in only one cell.
   */
  forEachInRadius(
    x: number,
    z: number,
    radius: number,
    fn: (id: PlayerId) => void,
  ): void {
    const r2 = radius * radius;
    const minI = Math.floor((x - radius) / this.cellSize);
    const maxI = Math.floor((x + radius) / this.cellSize);
    const minJ = Math.floor((z - radius) / this.cellSize);
    const maxJ = Math.floor((z + radius) / this.cellSize);
    for (let i = minI; i <= maxI; i++) {
      for (let j = minJ; j <= maxJ; j++) {
        const bucket = this.buckets.get(packKey(i, j));
        if (!bucket) continue;
        for (const id of bucket) fn(id);
      }
    }
    void r2; // r2 unused here — caller does the precise distance check
  }

  /** Build a grid populated from every player in `players`. */
  static fromPlayers(
    players: Record<PlayerId, PlayerState>,
    cellSize: number,
  ): PlayerGrid {
    const g = new PlayerGrid(cellSize);
    for (const id in players) {
      const p = players[id];
      g.insert(id, p.pos.x, p.pos.z);
    }
    return g;
  }

  private cellKey(x: number, z: number): number {
    const i = Math.floor(x / this.cellSize);
    const j = Math.floor(z / this.cellSize);
    return packKey(i, j);
  }
}

/** Pack two signed 32-bit-ish cell coords into a single number. The bias
 * keeps negative i/j inside positive territory so the hash is monotonic and
 * collision-free for |i|, |j| < 2^15 — plenty for any realistic map. */
function packKey(i: number, j: number): number {
  return (i + 0x8000) * 0x10000 + (j + 0x8000);
}
