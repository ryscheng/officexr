import RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerId, Vec3, WorldObjects, WorldSettings } from '@officexr/sdk';
import {
  BODY_GROUPS,
  WALL_GROUPS,
  INNER_SENSOR_GROUPS,
  OUTER_SENSOR_GROUPS,
  type ColliderTag,
} from '../physics/groups.ts';
import { GRAVITY, worldObjectsToCuboids } from '../physics/rules.ts';

/** Local-y the bot collider sits at (matches the browser-side BODY_Y in
 * Players.tsx so all bodies are at the same elevation). */
export const BODY_Y = 0.9;

/** Match the renderer's extrapolation cap so the resolver and the
 * visible avatar agree on where a peer "is" right now. */
const EXTRAPOLATION_CAP_S = 0.1;

function extrapolatePeerPos(
  player: { pos: Vec3; vel: Vec3; tRecv?: number },
  nowMs: number,
): Vec3 {
  if (player.tRecv === undefined) return { ...player.pos };
  const elapsed = Math.min(EXTRAPOLATION_CAP_S, (nowMs - player.tRecv) / 1000);
  return {
    x: player.pos.x + player.vel.x * elapsed,
    y: player.pos.y + player.vel.y * elapsed,
    z: player.pos.z + player.vel.z * elapsed,
  };
}

/** Per-peer kinematic mirror body the bot maintains in its own Rapier
 * world. Their positions are kept in sync with the SDK store's last
 * extrapolated peer positions every tick. */
interface PeerMirror {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

/** Result of one `step()` — the corrected movement vector from the
 * character controller, fraction of intent that survived contact, and
 * the list of bilateral bump events the driver should emit. */
export interface StepResult {
  /** Controller-resolved delta in world space. `y` carries the
   * gravity-integrated movement (which the controller has resolved
   * against the cube field — non-zero when the bot is falling,
   * ~zero when it's grounded). */
  corrected: { x: number; y: number; z: number };
  /** Fraction of the requested horizontal move that survived
   * collisions, [0, 1]. Vertical motion is gravity-driven and not
   * counted here — a bot in free fall still reports progress=1 for
   * an unblocked horizontal step. */
  progress: number;
  /** Peers the controller pushed against this step that we weren't
   * already bumping last step (edge-triggered). */
  bumps: Array<{ otherId: PlayerId; normal: { x: number; z: number } }>;
  /** True iff the controller resolved the bot onto solid ground
   * this step. Drivers can use this to gate animation-state choice
   * (no walk anim while airborne). */
  grounded: boolean;
}

/** Result of one `drainSensorEvents()` — pairs of collider tags whose
 * intersection state crossed an edge this step. Bus translation is the
 * driver's job (it knows the routing target). */
export interface SensorEvent {
  a: ColliderTag;
  b: ColliderTag;
  started: boolean;
}

interface BotPhysicsWorldOpts {
  selfId: PlayerId;
  startPos: Vec3;
  worldSettings: Pick<
    WorldSettings,
    'charRadius' | 'proximityRadius' | 'proximityOuterRadius'
  >;
  /** Optional canonical AABB lookup (typically
   * `api.geometry.worldAABB`). When provided, the bot's static
   * colliders match the visible-mesh AABB of each placed object.
   * When omitted, falls back to the legacy one-voxel cube collider —
   * preserved for back-compat with bot harnesses that don't have an
   * application api wired (older unit tests). */
  instanceAABB?: import('../physics/rules.ts').InstanceAABBLookup;
}

/**
 * Rapier-owning collaborator for `BotDriver`. Encapsulates the bot's
 * own private world: static walls along the map edge, the bot's
 * kinematic body + body / inner-sensor / outer-sensor colliders, the
 * KinematicCharacterController, and a registry of kinematic mirror
 * bodies for every peer the bot knows about.
 *
 * Exposes a side-effect-free-ish surface — `syncWalls`, `syncPeers`,
 * `step`, `drainSensorEvents` — so the driver can stay focused on the
 * SDK plumbing (store, sync, handshake) and mode dispatch.
 */
export class BotPhysicsWorld {
  readonly selfId: PlayerId;
  private world: RAPIER.World;
  private body: RAPIER.RigidBody;
  private bodyCollider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;

  /** One fixed RigidBody per cube in the active map. Rebuilt by
   * `syncCubes` whenever the WorldObjects fingerprint changes — the
   * picker pushes a new snapshot on every map switch, and the
   * bot's store sees that broadcast just like a peer would. */
  private mapColliderBodies: RAPIER.RigidBody[] = [];
  private cubesFingerprint: string | null = null;
  /** Per-frame integrated fall speed. Accumulates `GRAVITY * dt`
   * and resets to 0 when the controller reports the bot grounded.
   * Kinematic bodies don't auto-react to the world gravity vector
   * — we integrate it ourselves and pass into the controller's
   * desired-translation, mirroring `SceneFrame`'s player loop. */
  private verticalVel = 0;
  private peerMirrors = new Map<PlayerId, PeerMirror>();
  /** Collider handle → tag, for the bridge routing in
   * `drainSensorEvents`. */
  private tagByHandle = new Map<number, ColliderTag>();
  /** Pairs of (selfCollider.handle, otherCollider.handle) that were
   * intersecting at the end of the previous step. Diff against the
   * current step's pairs to emit started/ended sensor events. */
  private prevIntersections = new Set<string>();
  /** Player IDs the controller was bumping into on the previous frame,
   * for edge-triggering bump events. */
  private bumpingPeers = new Set<PlayerId>();
  /** Mapping from peer-mirror collider handle → playerId, so the
   * character controller's collision list can be translated into a
   * peer ID for the bump event. */
  private peerByColliderHandle = new Map<number, PlayerId>();
  private instanceAABB?: import('../physics/rules.ts').InstanceAABBLookup;

  constructor(opts: BotPhysicsWorldOpts) {
    this.selfId = opts.selfId;
    this.instanceAABB = opts.instanceAABB;
    // Gravity vector matches the browser-side `<Physics>` so the bot
    // and the local player fall at identical rates. Kinematic bodies
    // don't auto-apply it — see `verticalVel` integration in step().
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      opts.startPos.x,
      opts.startPos.y,
      opts.startPos.z,
    );
    this.body = this.world.createRigidBody(bodyDesc);

    // `ActiveCollisionTypes.ALL` — without this, Rapier's default
    // (DEFAULT = 15) skips kinematic↔kinematic contact / intersection
    // detection. Every character body in this scene is kinematic, so
    // bot-vs-bot and bot-vs-(local player mirror) intersections would
    // never fire and the bridge would emit no proximity events.
    const ACTIVE_TYPES = RAPIER.ActiveCollisionTypes.ALL;
    const bodyDescBall = RAPIER.ColliderDesc.ball(opts.worldSettings.charRadius)
      .setTranslation(0, BODY_Y, 0)
      .setCollisionGroups(BODY_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(ACTIVE_TYPES);
    this.bodyCollider = this.world.createCollider(bodyDescBall, this.body);
    this.tagByHandle.set(this.bodyCollider.handle, {
      kind: 'body',
      ownerId: opts.selfId,
    });

    const innerDesc = RAPIER.ColliderDesc.ball(opts.worldSettings.proximityRadius)
      .setTranslation(0, BODY_Y, 0)
      .setSensor(true)
      .setCollisionGroups(INNER_SENSOR_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(ACTIVE_TYPES);
    const innerCol = this.world.createCollider(innerDesc, this.body);
    this.tagByHandle.set(innerCol.handle, {
      kind: 'inner-sensor',
      ownerId: opts.selfId,
    });

    const outerDesc = RAPIER.ColliderDesc.ball(opts.worldSettings.proximityOuterRadius)
      .setTranslation(0, BODY_Y, 0)
      .setSensor(true)
      .setCollisionGroups(OUTER_SENSOR_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(ACTIVE_TYPES);
    const outerCol = this.world.createCollider(outerDesc, this.body);
    this.tagByHandle.set(outerCol.handle, {
      kind: 'outer-sensor',
      ownerId: opts.selfId,
    });

    this.controller = this.world.createCharacterController(0.01);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.setSlideEnabled(true);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    // Match the player-side controller in SceneFrame.tsx: snap to
    // ground when stepping between cubes at nominally the same
    // height so the bot doesn't float for a frame across each seam.
    this.controller.enableSnapToGround(0.3);
  }

  /** Current bot pose in world space. */
  translation(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /**
   * Rebuild the map's cuboid colliders from `worldObjects` (the
   * Map Editor's authored cube field). Replaces the old perimeter-
   * wall-only behaviour: every cube is now a real surface the bot
   * can stand on, walk against, and fall off — matching the
   * browser-side `<MapColliders>`.
   *
   * Cheap no-op when the cube layout hasn't changed: we fingerprint
   * by instance count + cubeSize. The map-switch path always
   * re-publishes a fresh `worldObjects` so a different layout with
   * the same count would still be caught by the next picker push
   * mutating the reference (and we don't try to detect that
   * granularly — rebuilding ~hundreds of fixed colliders is cheap).
   */
  syncCubes(worldObjects: WorldObjects): void {
    const fingerprint = `${worldObjects.instances.length}:${worldObjects.cubeSize}`;
    if (this.cubesFingerprint === fingerprint) return;
    for (const b of this.mapColliderBodies) this.world.removeRigidBody(b);
    this.mapColliderBodies = [];
    for (const c of worldObjectsToCuboids(worldObjects, this.instanceAABB)) {
      const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(
        c.center.x,
        c.center.y,
        c.center.z,
      );
      const body = this.world.createRigidBody(desc);
      const cdesc = RAPIER.ColliderDesc.cuboid(
        c.halfExtents.x,
        c.halfExtents.y,
        c.halfExtents.z,
      ).setCollisionGroups(WALL_GROUPS);
      this.world.createCollider(cdesc, body);
      this.mapColliderBodies.push(body);
    }
    this.cubesFingerprint = fingerprint;
  }

  /** Create / update / remove per-peer kinematic mirror bodies so the
   * character controller can resolve bot-vs-bot and bot-vs-local
   * collisions inside the bot's own Rapier world. */
  syncPeers(
    players: Record<PlayerId, { pos: Vec3; vel: Vec3; tRecv?: number }>,
    nowMs: number,
    charRadius: number,
  ): void {
    const seen = new Set<PlayerId>();

    for (const [id, p] of Object.entries(players)) {
      if (id === this.selfId) continue;
      seen.add(id as PlayerId);
      const ePos = extrapolatePeerPos(p, nowMs);
      let mirror = this.peerMirrors.get(id as PlayerId);
      if (!mirror) {
        const bdesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
          ePos.x,
          ePos.y,
          ePos.z,
        );
        const mb = this.world.createRigidBody(bdesc);
        const cdesc = RAPIER.ColliderDesc.ball(charRadius)
          .setTranslation(0, BODY_Y, 0)
          .setCollisionGroups(BODY_GROUPS)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
          .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
        const mc = this.world.createCollider(cdesc, mb);
        this.tagByHandle.set(mc.handle, { kind: 'body', ownerId: id });
        this.peerByColliderHandle.set(mc.handle, id as PlayerId);
        mirror = { body: mb, collider: mc };
        this.peerMirrors.set(id as PlayerId, mirror);
      } else {
        mirror.body.setNextKinematicTranslation({
          x: ePos.x,
          y: ePos.y,
          z: ePos.z,
        });
      }
    }

    // Remove mirrors for peers that left.
    for (const [id, mirror] of this.peerMirrors) {
      if (seen.has(id)) continue;
      this.tagByHandle.delete(mirror.collider.handle);
      this.peerByColliderHandle.delete(mirror.collider.handle);
      this.world.removeRigidBody(mirror.body);
      this.peerMirrors.delete(id);
      // Forget any bump-state for a peer that left so a new
      // same-named peer would re-trigger the bump on first contact.
      this.bumpingPeers.delete(id);
    }
  }

  /**
   * Run the Rapier character controller against the given intent
   * vector. Returns the corrected delta, progress fraction, and the
   * edge-triggered bump list. Caller is responsible for then calling
   * {@link applyTranslation} with the new pos if it accepts the move.
   *
   * EXCLUDE_SENSORS keeps the bot from physically bumping into other
   * characters' invisible proximity spheres (the sensor=true flag
   * only suppresses the dynamics solver, not the query pipeline that
   * the character controller uses).
   */
  step(intent: { x: number; z: number; dtSec: number }): StepResult {
    // Integrate gravity into vertical velocity, then feed the full
    // 3D delta into the controller. Matches SceneFrame's pattern
    // for the local player so bots fall at the same rate.
    this.verticalVel += GRAVITY * intent.dtSec;
    this.controller.computeColliderMovement(
      this.bodyCollider,
      {
        x: intent.x,
        y: this.verticalVel * intent.dtSec,
        z: intent.z,
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const corrected = this.controller.computedMovement();

    if (this.controller.computedGrounded()) {
      this.verticalVel = 0;
    }

    const next = new Set<PlayerId>();
    const bumps: Array<{ otherId: PlayerId; normal: { x: number; z: number } }> = [];
    const n = this.controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const coll = this.controller.computedCollision(i);
      if (!coll || !coll.collider) continue;
      const otherId = this.peerByColliderHandle.get(coll.collider.handle);
      if (!otherId) continue; // wall or unknown
      next.add(otherId);
      if (this.bumpingPeers.has(otherId)) continue;
      const nrm = coll.normal1;
      bumps.push({ otherId, normal: { x: nrm.x, z: nrm.z } });
    }
    this.bumpingPeers = next;

    const intentLenSq = intent.x * intent.x + intent.z * intent.z;
    const correctedLenSq = corrected.x * corrected.x + corrected.z * corrected.z;
    const progress =
      intentLenSq > 1e-12
        ? Math.max(0, Math.min(1, Math.sqrt(correctedLenSq / intentLenSq)))
        : 1;

    return {
      corrected: { x: corrected.x, y: corrected.y, z: corrected.z },
      progress,
      bumps,
      grounded: this.controller.computedGrounded(),
    };
  }

  /** Commit an absolute world-space pose to the bot's body. ALL
   * three components are written — y is no longer pinned, since
   * gravity drives vertical motion. */
  applyTranslation(pos: Vec3): void {
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
  }

  /** Force the body to a fresh location and zero its fall speed.
   * Used by `BotDriver.setPosition` when the picker respawns the
   * cohort and by the fall-respawn path so the bot doesn't keep
   * accumulating downward velocity through the teleport. */
  teleport(pos: Vec3): void {
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    this.verticalVel = 0;
  }

  /** Advance the simulation one Rapier step. Must be called every
   * driver tick, even when the bot didn't move, so sensor entries /
   * exits keep firing as peers walk through the proximity rings. */
  stepWorld(): void {
    this.world.step();
  }

  /** Walk the world's intersection / contact state and return any
   * started / ended pair events. The driver passes these to
   * `routeContactEvent` for bus translation.
   *
   * Body-vs-body contact events are start-only (Rapier exposes the
   * current contact pairs; we diff against last frame). Sensor pairs
   * fire both directions via the prev-intersections diff.
   */
  drainSensorEvents(): SensorEvent[] {
    const events: SensorEvent[] = [];

    // Body-vs-body contact events (entered only).
    this.world.contactPairsWith(this.bodyCollider, (other) => {
      const a = this.tagByHandle.get(this.bodyCollider.handle);
      const b = this.tagByHandle.get(other.handle);
      if (a && b) events.push({ a, b, started: true });
    });

    // Sensor pairs (inner + outer). Diff against the previous-step
    // set to emit started/ended.
    const next = new Set<string>();
    const checkSensor = (sensorCollider: RAPIER.Collider) => {
      this.world.intersectionPairsWith(sensorCollider, (other) => {
        const key = `${sensorCollider.handle}:${other.handle}`;
        next.add(key);
        if (!this.prevIntersections.has(key)) {
          const a = this.tagByHandle.get(sensorCollider.handle);
          const b = this.tagByHandle.get(other.handle);
          if (a && b) events.push({ a, b, started: true });
        }
      });
    };
    // Iterate the bot's own sensors only.
    for (let i = 0; i < this.body.numColliders(); i++) {
      const c = this.body.collider(i);
      if (c.isSensor()) checkSensor(c);
    }
    // Emit ended events for pairs that disappeared.
    for (const key of this.prevIntersections) {
      if (next.has(key)) continue;
      const [hA, hB] = key.split(':').map(Number);
      const a = this.tagByHandle.get(hA);
      const b = this.tagByHandle.get(hB);
      if (a && b) events.push({ a, b, started: false });
    }
    this.prevIntersections = next;

    return events;
  }

  dispose(): void {
    this.world.free();
    this.peerMirrors.clear();
    this.peerByColliderHandle.clear();
    this.tagByHandle.clear();
    this.prevIntersections.clear();
    this.bumpingPeers.clear();
    this.mapColliderBodies = [];
  }
}
