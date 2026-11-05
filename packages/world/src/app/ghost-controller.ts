import { clampToFootprint } from "@officexr/sdk";
import type {
  Actions,
  FootprintRect,
  PlayerId,
  ProximitySettings,
  Store,
} from "@officexr/sdk";
import type { EffectiveTunables } from "../characters/resolve.ts";
import { yawFromDirection } from "../renderer/lookControls.ts";

/** World-axis mapping for keys: forward is the top of the 2D view, i.e. -Z; right is +X. */
export const GHOST_FORWARD = { x: 0, z: -1 } as const;

export interface GhostKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export type GhostTunables = Pick<
  EffectiveTunables,
  "playerSpeed" | "charRadius"
> &
  Pick<ProximitySettings, "proximityRadius">;

type Point = { x: number; z: number };
type Intent =
  | { type: "none" }
  | { type: "point"; target: Point }
  | { type: "follow"; playerId: PlayerId };

const NO_KEYS: GhostKeys = {
  forward: false,
  back: false,
  left: false,
  right: false,
};
const EPS = 1e-6;

/** Headless 2D-mode movement: ignores map geometry, is solid against other players, stays in the footprint. */
export class GhostController {
  private keys: GhostKeys = NO_KEYS;
  private intent: Intent = { type: "none" };

  constructor(
    private readonly actions: Pick<Actions, "setSelfPosition">,
    private readonly store: Pick<Store, "getState">,
    private readonly selfId: PlayerId,
    private readonly footprint: readonly FootprintRect[],
    private readonly getTunables: () => GhostTunables,
  ) {}

  setKeys(keys: GhostKeys): void {
    this.keys = keys;
    if (keys.forward || keys.back || keys.left || keys.right) {
      this.intent = { type: "none" };
    }
  }

  moveTo(point: Point): void {
    this.intent = { type: "point", target: { x: point.x, z: point.z } };
  }

  goTo(playerId: PlayerId): void {
    this.intent = { type: "follow", playerId };
  }

  step(dtSec: number): void {
    const state = this.store.getState();
    const self = state.players[this.selfId];
    if (!self) {
      return;
    }
    const tun = this.getTunables();
    const from = clampToFootprint(this.footprint, self.pos);
    const dir = this.direction(from, state.players, tun);
    const maxStep = tun.playerSpeed * dtSec;

    let moved = from;
    if (dir) {
      const reach = Math.min(maxStep, dir.dist);
      const next = { x: from.x + dir.x * reach, z: from.z + dir.z * reach };
      const minDist = tun.charRadius * 2;
      const resolved = clampToFootprint(
        this.footprint,
        this.resolveCollisions(from, next, state.players, minDist),
      );
      // The footprint clamp can pull the ghost back into someone's circle; refuse the move then.
      moved = this.overlapsAny(from, resolved, state.players, minDist)
        ? from
        : resolved;
      if (
        this.intent.type === "point" &&
        Math.hypot(moved.x - from.x, moved.z - from.z) < EPS
      ) {
        this.intent = { type: "none" };
      }
    }

    const vel =
      dtSec > 0
        ? { x: (moved.x - from.x) / dtSec, y: 0, z: (moved.z - from.z) / dtSec }
        : { x: 0, y: 0, z: 0 };
    const yaw = dir ? yawFromDirection(dir) : self.yaw;
    this.actions.setSelfPosition(
      { x: moved.x, y: self.pos.y, z: moved.z },
      vel,
      yaw,
      false,
    );
  }

  /** Unit direction of intent plus the distance left to cover, or null when idle. */
  private direction(
    from: Point,
    players: Record<PlayerId, { pos: Point }>,
    tun: GhostTunables,
  ): (Point & { dist: number }) | null {
    const k = this.keys;
    const kx = Number(k.right) - Number(k.left);
    const kz = (Number(k.forward) - Number(k.back)) * GHOST_FORWARD.z;
    if (kx !== 0 || kz !== 0) {
      const len = Math.hypot(kx, kz);
      return { x: kx / len, z: kz / len, dist: Infinity };
    }
    let target: Point;
    let stopAt = EPS;
    if (this.intent.type === "point") {
      target = this.intent.target;
    } else if (this.intent.type === "follow") {
      const other = players[this.intent.playerId];
      if (!other) {
        this.intent = { type: "none" };
        return null;
      }
      target = other.pos;
      stopAt = tun.proximityRadius;
    } else {
      return null;
    }
    const dist = Math.hypot(target.x - from.x, target.z - from.z);
    if (dist <= stopAt) {
      this.intent = { type: "none" };
      return null;
    }
    return {
      x: (target.x - from.x) / dist,
      z: (target.z - from.z) / dist,
      dist: dist - stopAt,
    };
  }

  /** The distance an other player must keep: `minDist`, or the current distance when already overlapping. */
  private limitFor(from: Point, other: Point, minDist: number): number {
    return Math.min(minDist, Math.hypot(from.x - other.x, from.z - other.z));
  }

  private overlapsAny(
    from: Point,
    p: Point,
    players: Record<PlayerId, { pos: Point }>,
    minDist: number,
  ): boolean {
    return Object.entries(players).some(
      ([id, other]) =>
        id !== this.selfId &&
        Math.hypot(p.x - other.pos.x, p.z - other.pos.z) <
          this.limitFor(from, other.pos, minDist) - EPS,
    );
  }

  /**
   * Pushes `next` out of every other player's circle. When already overlapping
   * the limit is the current distance, so the ghost may slide or back away but
   * never closes in, and is never shoved.
   */
  private resolveCollisions(
    from: Point,
    next: Point,
    players: Record<PlayerId, { pos: Point }>,
    minDist: number,
  ): Point {
    const mx = next.x - from.x;
    const mz = next.z - from.z;
    const mLen = Math.hypot(mx, mz) || 1;
    const move = { x: mx / mLen, z: mz / mLen };
    let p = next;
    for (let pass = 0; pass < 2; pass++) {
      for (const [id, other] of Object.entries(players)) {
        if (id === this.selfId) {
          continue;
        }
        const limit = this.limitFor(from, other.pos, minDist);
        const dx = p.x - other.pos.x;
        const dz = p.z - other.pos.z;
        const d = Math.hypot(dx, dz);
        if (d >= limit) {
          continue;
        }
        const raw =
          d > EPS
            ? { x: dx / d, z: dz / d }
            : { x: from.x - other.pos.x, z: from.z - other.pos.z };
        const n = Math.hypot(raw.x, raw.z) || 1;
        let out = { x: raw.x / n, z: raw.z / n };
        // Head-on: projecting straight back out would stall forever, so go round to a fixed side.
        const cross = move.x * out.z - move.z * out.x;
        if (Math.abs(cross) < 0.05) {
          const side = cross < 0 ? -1 : 1;
          const bent = {
            x: out.x - side * move.z * 0.5,
            z: out.z + side * move.x * 0.5,
          };
          const bLen = Math.hypot(bent.x, bent.z);
          out = { x: bent.x / bLen, z: bent.z / bLen };
        }
        p = { x: other.pos.x + out.x * limit, z: other.pos.z + out.z * limit };
      }
    }
    return p;
  }
}
