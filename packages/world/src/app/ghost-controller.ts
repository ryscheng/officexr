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

export const NO_KEYS: Readonly<GhostKeys> = Object.freeze({
  forward: false,
  back: false,
  left: false,
  right: false,
});
const EPS = 1e-6;

/** Headless 2D-mode movement: ignores map geometry, is solid against other players, stays in the footprint. */
export class GhostController {
  private keys: GhostKeys = NO_KEYS;
  private intent: Intent = { type: "none" };

  constructor(
    private readonly actions: Pick<Actions, "setSelfPosition">,
    private readonly store: Pick<Store, "getState">,
    private readonly selfId: PlayerId,
    private footprint: readonly FootprintRect[],
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

  setFootprint(footprint: readonly FootprintRect[]): void {
    this.footprint = footprint;
  }

  cancel(): void {
    this.intent = { type: "none" };
  }

  /** The player being followed, or null once the follow ends (arrived, cancelled, keys pressed). */
  followTarget(): PlayerId | null {
    return this.intent.type === "follow" ? this.intent.playerId : null;
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
      const attempt = (flip: 1 | -1): Point =>
        clampToFootprint(
          this.footprint,
          this.resolveCollisions(
            from,
            next,
            state.players,
            minDist,
            maxStep,
            flip,
          ),
        );
      // The footprint clamp can pull the ghost back into someone's circle, so try the other
      // head-on side before refusing the move.
      const first = attempt(1);
      const second = this.overlapsAny(from, first, state.players, minDist)
        ? attempt(-1)
        : first;
      moved = this.overlapsAny(from, second, state.players, minDist)
        ? from
        : second;
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
      stopAt = Math.max(tun.proximityRadius, tun.charRadius * 2);
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
    maxStep: number,
    flip: 1 | -1,
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
        // Head-on: projecting straight back out would stall forever, so swing round the circle,
        // by the arc that keeps the whole move within `maxStep` of `from`.
        const cross = move.x * out.z - move.z * out.x;
        if (Math.abs(cross) < 0.05) {
          const fx = from.x - other.pos.x;
          const fz = from.z - other.pos.z;
          const fd = Math.hypot(fx, fz) || limit;
          const cosArc =
            (fd * fd + limit * limit - maxStep * maxStep) / (2 * fd * limit);
          const arc = Math.acos(Math.min(1, Math.max(-1, cosArc)));
          const angle = Math.atan2(fz, fx) + (cross < 0 ? -1 : 1) * flip * arc;
          out = { x: Math.cos(angle), z: Math.sin(angle) };
        }
        p = { x: other.pos.x + out.x * limit, z: other.pos.z + out.z * limit };
      }
    }
    return p;
  }
}
