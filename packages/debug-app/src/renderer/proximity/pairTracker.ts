import type { Bus, PlayerId, PlayerState } from '@officexr/sdk';

/** State of a pair of characters with respect to each other. */
export type PairState = 'entering' | 'entered' | 'exiting';

/**
 * An ephemeral "MeetingArea": the spatial bubble that materialises every
 * time two characters successfully form a conversation (`proximity:entered`).
 *
 * The same abstraction is used for every conversation size:
 * - A 2-person chat between user and bot has its own MeetingArea.
 * - A 5-person huddle has one (larger) MeetingArea.
 *
 * The shape (a disc in the XZ plane) has these invariants:
 * - `center` damps toward the centroid of `members` each frame so a member
 *   leaving doesn't snap the centre.
 * - `radius` is **monotonic upward** — it grows when members are admitted,
 *   never shrinks while the area is live. This is the "don't disconnect
 *   the remaining people just because the connecting member walked away"
 *   property the user wants. The area only goes away when membership
 *   drops to ≤ 1.
 *
 * Bus events `proximity:entered / exiting` reflect entry into / ejection
 * from a MeetingArea. `proximity:entering / exited` continue to reflect
 * outer-ring overlap with anyone — independent of MeetingArea state.
 */
export interface MeetingArea {
  id: string;
  members: Set<PlayerId>;
  center: { x: number; z: number };
  radius: number;
}

export interface TrackerOptions {
  selfId: PlayerId;
  bus: Bus;
  /** WorldSettings.charRadius — the character body radius. */
  charRadius: number;
  /** WorldSettings.proximityRadius — inner ring radius. */
  proximityRadius: number;
  /** WorldSettings.proximityOuterRadius — outer ring radius. */
  proximityOuterRadius: number;
  /** WorldSettings.proximityEnterDebounceMs — hold time for `entered`. */
  enterDebounceMs: number;
  /** Wall-clock now, milliseconds. */
  nowMs: number;
  /** Frame delta-time in seconds, for damping. */
  dtSec: number;
}

/** Per-player visibility rule output: the strongest state we should
 * render for this player's disc, gated by the "no clutter" rule
 * (self-involved any-state, peer↔peer only when sharing an area). */
export type PlayerVisibilityState = PairState;

export interface TrackerOutput {
  /** All pairs that currently have a non-null state, keyed by
   * `min(aId,bId):max(aId,bId)`. */
  pairStates: Map<string, PairState>;
  /** What each player's disc should render this frame, or absent if the
   * disc should be invisible. Computed via the visibility rule:
   *   - self: max state across self's pairs.
   *   - peer: max state across pairs that are `entered`/`exiting` *and*
   *     share a MeetingArea with the peer (i.e. peer↔peer entering pairs
   *     don't show).  */
  playerStates: Map<PlayerId, PlayerVisibilityState>;
  /** Live MeetingAreas. */
  areas: MeetingArea[];
  /** The local player's current MeetingArea centroid, lifted to no
   * specific y. `null` when the local player is not in any area. */
  conversationFocus: { x: number; z: number } | null;
}

/** Internal per-pair tracking — held across frames in the tracker
 * instance the consumer keeps in a `useRef`. */
interface PairRecord {
  state: PairState;
  /** Timestamp (ms) at which inner overlap was first detected for this
   * "approach attempt". -1 when no timer is running. Used to enforce
   * `enterDebounceMs` before admitting to a MeetingArea. */
  debounceStartedAtMs: number;
  /** True iff this pair is currently inside any MeetingArea together
   * (both ends are members of the same area). Derived from the area
   * registry each tick; cached here to avoid scanning areas twice. */
  inSameArea: boolean;
}

interface InternalArea {
  id: string;
  members: Set<PlayerId>;
  // Live centre (damped). Updated each frame.
  centerX: number;
  centerZ: number;
  radius: number;
}

/**
 * Stateful per-frame proximity + MeetingArea tracker. Caller creates one
 * instance (e.g. via `useRef`) and calls `tick()` each frame.
 *
 * The tracker emits the proximity bus events itself — callers should not
 * subscribe to those *and* this tracker for the same purpose.
 */
export class PairTracker {
  private pairs = new Map<string, PairRecord>();
  private areas = new Map<string, InternalArea>();
  private areaCounter = 0;
  /** Output buffers (reused across ticks to avoid GC pressure). */
  private outPairs = new Map<string, PairState>();
  private outPlayer = new Map<PlayerId, PlayerVisibilityState>();
  private outAreas: MeetingArea[] = [];

  /** Per-tick work entry-point. Returns a view of the latest state. */
  tick(
    players: Record<PlayerId, PlayerState>,
    opts: TrackerOptions,
  ): TrackerOutput {
    const ids = Object.keys(players) as PlayerId[];

    const {
      selfId,
      bus,
      charRadius,
      proximityRadius,
      proximityOuterRadius,
      enterDebounceMs,
      nowMs,
      dtSec,
    } = opts;

    const outerLimit = 2 * charRadius + proximityOuterRadius;
    const innerLimit = 2 * charRadius + proximityRadius;
    const outerLimitSq = outerLimit * outerLimit;
    const innerLimitSq = innerLimit * innerLimit;
    const smallBuffer = charRadius * 2;

    // Step 0: forget pairs whose endpoints no longer exist in the world
    // (player disconnected). Also clean up areas referring to them.
    for (const key of [...this.pairs.keys()]) {
      const [a, b] = key.split('|') as [PlayerId, PlayerId];
      if (!players[a] || !players[b]) this.pairs.delete(key);
    }
    for (const area of this.areas.values()) {
      for (const m of [...area.members]) {
        if (!players[m]) area.members.delete(m);
      }
    }

    // Step 1: per-pair geometric measurement. Build up "did this pair
    // start outer overlapping this frame?" / "is it inner overlapping?"
    // bookkeeping. We don't mutate `state` yet — that's done after the
    // MeetingArea pass so we have a coherent view.
    const outerOverlap = new Set<string>();
    const innerOverlap = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        const pa = players[a];
        const pb = players[b];
        const dx = pa.pos.x - pb.pos.x;
        const dz = pa.pos.z - pb.pos.z;
        const dSq = dx * dx + dz * dz;
        if (dSq <= outerLimitSq) {
          const key = pairKey(a, b);
          outerOverlap.add(key);
          if (dSq <= innerLimitSq) innerOverlap.add(key);
        }
      }
    }

    // Step 2: drive per-pair state machine.
    //
    //   pairs with no record yet:
    //     outer overlap → record at 'entering', emit `proximity:entering`
    //     no overlap    → ignore
    //
    //   existing records:
    //     state == 'entering':
    //       - if pair admitted to area this frame (Step 3) → 'entered'
    //         (handled inside Step 3)
    //       - if no longer outer overlapping → clear, emit `exited`
    //       - if inner overlapping → start/keep debounce timer
    //       - else → cancel debounce timer
    //
    //     state == 'entered' or 'exiting':
    //       - state is driven by MeetingArea membership; see Step 4.

    for (const key of outerOverlap) {
      let rec = this.pairs.get(key);
      if (!rec) {
        rec = {
          state: 'entering',
          debounceStartedAtMs: -1,
          inSameArea: false,
        };
        this.pairs.set(key, rec);
        emitPairEvent(bus, selfId, key, 'proximity:entering');
      }
      // Debounce bookkeeping for `entering` pairs (will be inspected in
      // Step 3 to decide admission). `entered` / `exiting` pairs ignore
      // the timer — they're managed by the area.
      if (rec.state === 'entering') {
        if (innerOverlap.has(key)) {
          if (rec.debounceStartedAtMs < 0)
            rec.debounceStartedAtMs = nowMs;
        } else {
          rec.debounceStartedAtMs = -1;
        }
      } else {
        // `entered`/`exiting`: timer not used.
        rec.debounceStartedAtMs = -1;
      }
    }

    // Step 3: admission. Any `entering` pair whose inner-debounce timer
    // has elapsed becomes admitted. Admission may create, join, or
    // merge MeetingAreas.
    for (const [key, rec] of this.pairs) {
      if (rec.state !== 'entering') continue;
      if (rec.debounceStartedAtMs < 0) continue;
      if (nowMs - rec.debounceStartedAtMs < enterDebounceMs) continue;
      if (!innerOverlap.has(key)) {
        // Lost inner overlap right at the deadline; cancel.
        rec.debounceStartedAtMs = -1;
        continue;
      }

      const [a, b] = splitKey(key);
      const pa = players[a];
      const pb = players[b];
      if (!pa || !pb) continue;

      const areaA = this.areaContaining(a);
      const areaB = this.areaContaining(b);
      let admittedTo: InternalArea;
      if (!areaA && !areaB) {
        admittedTo = this.createArea(pa, pb, smallBuffer);
      } else if (areaA && !areaB) {
        admittedTo = areaA;
        this.addMember(admittedTo, b, players, smallBuffer);
      } else if (!areaA && areaB) {
        admittedTo = areaB;
        this.addMember(admittedTo, a, players, smallBuffer);
      } else if (areaA === areaB) {
        // Both already in the same area (shouldn't normally happen since
        // we only run admission for `entering` pairs, but harmless).
        admittedTo = areaA!;
      } else {
        // Merge two areas.
        admittedTo = this.mergeAreas(areaA!, areaB!, players, smallBuffer);
      }

      // Mark the admitted pair `entered` AND any pair that is now
      // contained within the same area but is still tracked as
      // `entering` — those should also flip to `entered` and fire their
      // own `proximity:entered`.
      this.flipPairsToEntered(admittedTo, bus, selfId);
    }

    // Step 4: per-frame area updates (centre damping, ejection check,
    // dissolution).
    for (const area of [...this.areas.values()]) {
      if (area.members.size === 0) {
        this.areas.delete(area.id);
        continue;
      }
      // Compute fresh centroid.
      let cx = 0;
      let cz = 0;
      for (const id of area.members) {
        const p = players[id]!.pos;
        cx += p.x;
        cz += p.z;
      }
      cx /= area.members.size;
      cz /= area.members.size;
      // Damp current centre toward fresh centroid. τ = 0.5s.
      area.centerX = damp(area.centerX, cx, 0.5, dtSec);
      area.centerZ = damp(area.centerZ, cz, 0.5, dtSec);

      // Ejection: any member whose distance from the (damped) centre
      // exceeds the area's radius is ejected. Ejected member's pairs
      // with remaining members go to `exiting`.
      const ejected: PlayerId[] = [];
      for (const m of area.members) {
        const p = players[m]!.pos;
        const ddx = p.x - area.centerX;
        const ddz = p.z - area.centerZ;
        if (ddx * ddx + ddz * ddz > area.radius * area.radius) {
          ejected.push(m);
        }
      }
      for (const m of ejected) {
        area.members.delete(m);
        for (const other of area.members) {
          const key = pairKey(m, other);
          const rec = this.pairs.get(key);
          if (!rec) continue;
          if (rec.state === 'entered') {
            rec.state = 'exiting';
            emitPairEvent(bus, selfId, key, 'proximity:exiting');
          }
        }
      }
      // Dissolve area if only 0 or 1 members remain.
      if (area.members.size <= 1) {
        // The remaining member (if any) is implicitly removed when the
        // area is deleted; pair states with that member are handled in
        // Step 5 below (they'll fall to `exiting` then `exited` as they
        // lose outer-ring overlap).
        this.areas.delete(area.id);
      }
    }

    // Step 5: emit `proximity:exited` for pairs that have entirely lost
    // their outer overlap AND are not held inside an area. This is the
    // outer-ring drop step — independent of MeetingAreas.
    for (const [key, rec] of [...this.pairs]) {
      if (!outerOverlap.has(key)) {
        // Lost outer overlap. Whatever state, emit `proximity:exited`
        // and forget the pair. (If we were `entered`/`exiting` because
        // of an area, the ejection in Step 4 already flipped us to
        // `exiting` — emitting `exited` here is the natural follow-up.)
        emitPairEvent(bus, selfId, key, 'proximity:exited');
        this.pairs.delete(key);
      }
    }

    // Step 6: compute the per-pair `inSameArea` flag and the per-player
    // visibility state, plus the conversation focus. Build output.
    this.outPairs.clear();
    this.outPlayer.clear();
    this.outAreas = [];

    // First, refresh `inSameArea` for every pair.
    const areaByMember = new Map<PlayerId, InternalArea>();
    for (const area of this.areas.values()) {
      for (const m of area.members) areaByMember.set(m, area);
    }
    for (const [key, rec] of this.pairs) {
      const [a, b] = splitKey(key);
      const aa = areaByMember.get(a);
      const bb = areaByMember.get(b);
      rec.inSameArea = !!aa && aa === bb;
    }

    // Pair states & player visibility states.
    for (const [key, rec] of this.pairs) {
      this.outPairs.set(key, rec.state);
      const [a, b] = splitKey(key);
      const selfInvolved = a === selfId || b === selfId;
      // Self-involved pairs render their state across the whole
      // lifecycle. Peer↔peer pairs only render if their members share
      // a MeetingArea (i.e. state is `entered` or `exiting` AND
      // `inSameArea` is true).
      const shouldShow =
        selfInvolved ||
        (rec.inSameArea &&
          (rec.state === 'entered' || rec.state === 'exiting'));
      if (!shouldShow) continue;
      // Promote each endpoint's visibility to the strongest state.
      promoteVisibility(this.outPlayer, a, rec.state);
      promoteVisibility(this.outPlayer, b, rec.state);
    }

    // Area output (just project the internal areas).
    for (const area of this.areas.values()) {
      this.outAreas.push({
        id: area.id,
        members: new Set(area.members),
        center: { x: area.centerX, z: area.centerZ },
        radius: area.radius,
      });
    }

    // Conversation focus = the local player's area centroid (if any).
    let focus: { x: number; z: number } | null = null;
    const selfArea = areaByMember.get(selfId);
    if (selfArea) {
      focus = { x: selfArea.centerX, z: selfArea.centerZ };
    }

    return {
      pairStates: this.outPairs,
      playerStates: this.outPlayer,
      areas: this.outAreas,
      conversationFocus: focus,
    };
  }

  private areaContaining(p: PlayerId): InternalArea | undefined {
    for (const a of this.areas.values()) {
      if (a.members.has(p)) return a;
    }
    return undefined;
  }

  private createArea(
    pa: PlayerState,
    pb: PlayerState,
    smallBuffer: number,
  ): InternalArea {
    const id = `area-${++this.areaCounter}`;
    const cx = (pa.pos.x + pb.pos.x) / 2;
    const cz = (pa.pos.z + pb.pos.z) / 2;
    const midpointMaxDist = Math.max(
      dist2D(pa.pos.x, pa.pos.z, cx, cz),
      dist2D(pb.pos.x, pb.pos.z, cx, cz),
    );
    // Initial radius approximates the lens region of the two outer
    // proximity rings — large enough to comfortably contain both
    // members with a little personal-space buffer.
    const radius = midpointMaxDist + smallBuffer;
    const area: InternalArea = {
      id,
      members: new Set([pa.id, pb.id]),
      centerX: cx,
      centerZ: cz,
      radius,
    };
    this.areas.set(id, area);
    return area;
  }

  private addMember(
    area: InternalArea,
    newId: PlayerId,
    players: Record<PlayerId, PlayerState>,
    smallBuffer: number,
  ): void {
    if (area.members.has(newId)) return;
    area.members.add(newId);
    // Recompute centroid and ratchet radius upward to fit new member.
    let cx = 0;
    let cz = 0;
    for (const m of area.members) {
      const p = players[m]!.pos;
      cx += p.x;
      cz += p.z;
    }
    cx /= area.members.size;
    cz /= area.members.size;
    area.centerX = cx;
    area.centerZ = cz;
    let maxR = 0;
    for (const m of area.members) {
      const p = players[m]!.pos;
      maxR = Math.max(maxR, dist2D(p.x, p.z, cx, cz));
    }
    area.radius = Math.max(area.radius, maxR + smallBuffer);
  }

  private mergeAreas(
    a: InternalArea,
    b: InternalArea,
    players: Record<PlayerId, PlayerState>,
    smallBuffer: number,
  ): InternalArea {
    // Keep `a`, fold `b` in. (Member-count ties go to `a`; arbitrary.)
    const keep = a.members.size >= b.members.size ? a : b;
    const drop = keep === a ? b : a;
    for (const m of drop.members) keep.members.add(m);
    this.areas.delete(drop.id);
    let cx = 0;
    let cz = 0;
    for (const m of keep.members) {
      const p = players[m]!.pos;
      cx += p.x;
      cz += p.z;
    }
    cx /= keep.members.size;
    cz /= keep.members.size;
    keep.centerX = cx;
    keep.centerZ = cz;
    let maxR = 0;
    for (const m of keep.members) {
      const p = players[m]!.pos;
      maxR = Math.max(maxR, dist2D(p.x, p.z, cx, cz));
    }
    // Monotonic upward; never shrink on merge either.
    keep.radius = Math.max(
      Math.max(a.radius, b.radius),
      maxR + smallBuffer,
    );
    return keep;
  }

  /** After an admission, flip every pair whose endpoints are both
   * inside `area` and which is currently tracked as `entering` into
   * `entered`, emitting `proximity:entered`. */
  private flipPairsToEntered(
    area: InternalArea,
    bus: Bus,
    selfId: PlayerId,
  ): void {
    const members = [...area.members];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = pairKey(members[i], members[j]);
        let rec = this.pairs.get(key);
        if (!rec) {
          // Could happen if two areas merged and the bridging pair was
          // never an outer-overlap — create a record at `entered`.
          rec = {
            state: 'entered',
            debounceStartedAtMs: -1,
            inSameArea: true,
          };
          this.pairs.set(key, rec);
          emitPairEvent(bus, selfId, key, 'proximity:entered');
          continue;
        }
        if (rec.state !== 'entered') {
          rec.state = 'entered';
          rec.debounceStartedAtMs = -1;
          emitPairEvent(bus, selfId, key, 'proximity:entered');
        }
      }
    }
  }
}

function pairKey(a: PlayerId, b: PlayerId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function splitKey(key: string): [PlayerId, PlayerId] {
  const idx = key.indexOf('|');
  return [key.slice(0, idx), key.slice(idx + 1)];
}

function dist2D(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Critically-damped first-order lerp toward `target`. `lambda` is
 * the time constant in seconds: at every τ seconds the current value
 * gets ~63% of the way to the target. Standard three.js
 * MathUtils.damp formula. */
function damp(
  current: number,
  target: number,
  lambda: number,
  dtSec: number,
): number {
  // Equivalent to THREE.MathUtils.damp(current, target, 1/lambda, dt)
  return current + (target - current) * (1 - Math.exp(-dtSec / lambda));
}

const ORDER: Record<PairState, number> = {
  entering: 1,
  exiting: 2,
  entered: 3,
};

function promoteVisibility(
  out: Map<PlayerId, PlayerVisibilityState>,
  player: PlayerId,
  candidate: PairState,
): void {
  const cur = out.get(player);
  if (!cur || ORDER[candidate] > ORDER[cur]) out.set(player, candidate);
}

/** Emit a `proximity:*` event for a pair, but only when the local
 * player is one of the endpoints. Mirrors the old bridge filter so
 * `Communication`'s voice-room logic stays correct. */
function emitPairEvent(
  bus: Bus,
  selfId: PlayerId,
  pairKeyStr: string,
  kind:
    | 'proximity:entering'
    | 'proximity:entered'
    | 'proximity:exiting'
    | 'proximity:exited',
): void {
  const [a, b] = splitKey(pairKeyStr);
  let otherId: PlayerId | null = null;
  if (a === selfId && b !== selfId) otherId = b;
  else if (b === selfId && a !== selfId) otherId = a;
  if (!otherId) return;
  bus.emit({ kind, otherId } as never);
}
