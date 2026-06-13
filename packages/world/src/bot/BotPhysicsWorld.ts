import RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerId, Vec3, WorldObjects, WorldSettings } from '@officexr/sdk';
import {
  BODY_GROUPS,
  WALL_GROUPS,
  INNER_SENSOR_GROUPS,
  OUTER_SENSOR_GROUPS,
  type ColliderTag,
} from '../physics/groups.ts';
import {
  CHARACTER_CONTROLLER_SKIN,
  GRAVITY,
  worldObjectsToCuboids,
} from '../physics/rules.ts';
import { horizontalProgress } from '../physics/blocking.ts';
import { tryStepUp, type StepUpProbe } from '../physics/step-up.ts';

/** Local-y the bot collider sits at (matches the browser-side BODY_Y in
 * Players.tsx so all bodies are at the same elevation). */
export const BODY_Y = 0.9;


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
  /** Optional collider-shape override lookup (typically
   * `(id) => api.catalog.getKind(id)?.colliderShape`). When provided,
   * kinds that declare a `colliderShape` (e.g. `compound-steps`) emit
   * multiple cuboids instead of the single AABB box, mirroring what
   * `MapColliders` emits on the browser side. */
  colliderShape?: import('../physics/rules.ts').ColliderShapeLookup;
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
  /** The last position applied via `applyTranslation` (or `teleport`). This
   * is the position scheduled via `setNextKinematicTranslation` that WILL be
   * committed to the Rapier broadphase on the next `stepWorld()` call. Using
   * this in `syncPeers` instead of `body.translation()` (which returns the
   * position from the PREVIOUS `stepWorld()` — 1 tick stale) ensures the
   * peer-mirror clamp is computed against the position that the KCC will
   * actually see during `physics.step()`, preventing the 1-tick staleness
   * gap-error that causes start-inside-collider pass-through. */
  private _lastAppliedPos: Vec3 | null = null;
  private instanceAABB?: import('../physics/rules.ts').InstanceAABBLookup;
  private colliderShape?: import('../physics/rules.ts').ColliderShapeLookup;

  constructor(opts: BotPhysicsWorldOpts) {
    this.selfId = opts.selfId;
    this.instanceAABB = opts.instanceAABB;
    this.colliderShape = opts.colliderShape;
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
    // Seed _lastAppliedPos with the initial start position so the first
    // syncPeers call has a non-null predicted body position.
    this._lastAppliedPos = { x: opts.startPos.x, y: opts.startPos.y, z: opts.startPos.z };

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

    this.controller = this.world.createCharacterController(CHARACTER_CONTROLLER_SKIN);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.setSlideEnabled(true);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    // Match the player-side controller in SceneFrame.tsx: snap to
    // ground when stepping between cubes at nominally the same
    // height so the bot doesn't float for a frame across each seam.
    this.controller.enableSnapToGround(0.3);
    // NO Rapier autostep — deliberately. Verified by deterministic
    // simulation (physics/step-up.test.ts): autostep cannot lift a
    // ball collider over real stair risers at ANY config, while at
    // maxHeight ≥ 0.6 it DOES hop onto other characters' ball tops
    // (kinematic peers can't be excluded via includeDynamicBodies).
    // Ledge climbing is handled explicitly by the shared step-up
    // assist (physics/step-up.ts), which has a peer-contact guard.
  }

  /** Current bot pose in world space. */
  translation(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** Current integrated fall speed (m/s, negative = falling).
   * Exposed for {@link BotCharacterMovement} so it can populate
   * {@link CharacterMoveResult.velY} from the authoritative integrated
   * value rather than an approximation derived from corrected.y / dtSec.
   * Read-only accessor — no logic change to the integration in step(). */
  getVerticalVel(): number {
    return this.verticalVel;
  }

  /**
   * Downward floor probe: casts a ray from `fromPos` downward by `range` m.
   * Returns true if a surface is found within that range.
   *
   * Used by BotDriver.tick() to populate the `hasFloorUnderneath` input
   * to shouldRespawnFalling (dual-gate fall-respawn rule). Rapier only —
   * no Three, no React. The ray origin is placed at character-feet level
   * (fromPos.y) so the probe checks below the bot's current ground contact.
   *
   * EXCLUDE_SENSORS: sensor colliders (proximity rings) must not count as
   * "floor" — only solid geometry should prevent a respawn trigger.
   */
  probeFloor(fromPos: Vec3, range: number): boolean {
    const ray = new RAPIER.Ray(
      { x: fromPos.x, y: fromPos.y, z: fromPos.z },
      { x: 0, y: -1, z: 0 },
    );
    const hit = this.world.castRay(
      ray,
      range,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    return hit !== null;
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
    for (const c of worldObjectsToCuboids(worldObjects, this.instanceAABB, this.colliderShape)) {
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
    _nowMs: number,
    charRadius: number,
  ): void {
    const seen = new Set<PlayerId>();

    for (const [id, p] of Object.entries(players)) {
      if (id === this.selfId) continue;
      seen.add(id as PlayerId);
      // Use the raw stored position for the physics mirror (no extrapolation),
      // but clamped so the mirror sphere's 3D contact surface never overlaps
      // our own sphere (the "start-inside-collider" pass-through guard).
      //
      // WHY CLAMP: bots approach each other at ~3 m/s each (combined 0.1 m/frame
      // at 60 Hz). In the frame they first make contact, the peer has already
      // moved 0.05 m toward us since the last store read. Without clamping, the
      // mirror sphere overlaps our sphere by 0.05-0.1 m on the first contact
      // frame. Rapier's KCC shape-cast only detects FUTURE contacts (TOI > 0);
      // when the character starts INSIDE an obstacle the cast reports no hit and
      // allows unrestricted movement — the classic "start-inside-collider" pass-
      // through. The clamp ensures the mirror sphere never overlaps ours.
      //
      // SPHERE-SURFACE AWARE: We compute the minimum horizontal (XZ) distance
      // at which sphere centres are exactly at the contact sum (2 * charRadius),
      // taking into account the ACTUAL vertical separation between sphere centres.
      // This is important because even a small Y difference (e.g. 0.15 m during
      // platform settling) reduces the required XZ distance — if we always clamp
      // to the full 2 * charRadius horizontally, the 3D contact distance exceeds
      // the contact sum and the KCC sees no collision.
      //
      // Y PRESERVED: the mirror body root's Y is always the peer's authoritative
      // Y (from directPeers). We only adjust the XZ position. This prevents the
      // spurious vertical-contact-normal artifact that 3D clamping introduces:
      // a mirror pushed diagonally in 3D appears at the wrong height, causing
      // the KCC to push our bot upward off the platform.
      let mirrorBodyPos: Vec3 = p.pos;
      {
        // Use `_lastAppliedPos` (the position most recently scheduled via
        // `setNextKinematicTranslation`) rather than `body.translation()` (which
        // returns the position committed by the PREVIOUS `stepWorld()` — 1 tick
        // stale). `_lastAppliedPos` is the position that WILL be committed by
        // the UPCOMING `stepWorld()` call (i.e. what the KCC broadphase will see
        // during `physics.step()`), so the clamp is computed against the correct
        // body position. Without this, the staleness causes the gap to appear
        // 0.05 m larger than it actually is in the broadphase, making the mirror
        // 0.05 m too close → the gap after stepWorld collapses to exactly
        // contactSum (TOI = 0) → KCC treats it as "touching" → allows movement
        // → pass-through.
        const myPos = this._lastAppliedPos ?? this.translation();
        // Vertical distance between the two sphere centres (BODY_Y offset same
        // for both bots, so it cancels in the difference; only the body-root Y
        // difference matters for the per-contact-axis geometry).
        const dyCentres = p.pos.y - myPos.y; // peer root Y − my root Y
        const contactSum = 2 * charRadius;
        // Pythagoras: the required horizontal distance h such that
        //   sqrt(h² + dyCentres²) = contactSum  →  h² = contactSum² - dyCentres²
        // If |dyCentres| >= contactSum the spheres can never touch horizontally.
        const hSq = contactSum * contactSum - dyCentres * dyCentres;
        if (hSq > 0) {
          // The clamp uses `_lastAppliedPos` (the position that WILL be
          // committed to the broadphase by the upcoming `stepWorld()`) so
          // the gap calculation is exact — no staleness, no extra margin
          // needed. The mirror is placed at EXACTLY contactSum distance
          // from the bot's broadphase position, giving TOI = 0 in the KCC
          // shape-cast, which prevents ALL movement toward the mirror
          // (progress = 0 → animState:'idle' → broadcastVel:{0,0,0}).
          const requiredHoriz = Math.sqrt(hSq);
          const dx = p.pos.x - myPos.x;
          const dz = p.pos.z - myPos.z;
          const horizDistSq = dx * dx + dz * dz;
          if (horizDistSq < requiredHoriz * requiredHoriz && horizDistSq > 1e-9) {
            const horizDist = Math.sqrt(horizDistSq);
            const scale = requiredHoriz / horizDist;
            mirrorBodyPos = {
              x: myPos.x + dx * scale,
              y: p.pos.y, // preserve peer's authoritative body-root Y
              z: myPos.z + dz * scale,
            };
          }
        }
        // If hSq <= 0 (bots vertically too far apart to touch), leave mirrorBodyPos = p.pos.
      }
      const ePos = mirrorBodyPos;
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
        mirror.body.setNextKinematicTranslation({ x: ePos.x, y: ePos.y, z: ePos.z });
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
    // Explicit BODY_GROUPS filter: ensures the KCC interacts with both the
    // floor (WALL_GROUPS membership=WALL) and peer mirrors (BODY_GROUPS
    // membership=BODY) while skipping uncategorised colliders. Without an
    // explicit filter the JS binding passes the sentinel 0x100000001 whose
    // low-32-bit truncation to WASM i32 = 1 (memberships=0, filter=BODY=1)
    // → (memberships=0) & anything = 0 → always false → NO interactions
    // detected. That sentinel was intended to signal None/all-groups in
    // Rust, but the JS→WASM i32 truncation loses the high bit, so the
    // WASM receives 1 instead of the None sentinel. Passing BODY_GROUPS
    // explicitly avoids the truncation and correctly detects both floor and
    // peer mirrors.
    //
    // The mirror-position clamp in syncPeers prevents mirrors from being
    // placed inside the bot's sphere (which would cause KCC start-inside-
    // collider undefined behavior), so this explicit filter is safe.
    //
    // SRP violation: step() now implicitly depends on BODY_GROUPS being
    // the correct filter for the bot's interaction topology. If the group
    // layout changes (new group bits, new collision rules), this must also
    // update. Acceptable because step() is the sole physics-integration
    // point in this class and the groups.ts file is the single authority.
    this.controller.computeColliderMovement(
      this.bodyCollider,
      {
        x: intent.x,
        y: this.verticalVel * intent.dtSec,
        z: intent.z,
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      BODY_GROUPS,
    );
    const corrected = this.controller.computedMovement();

    // Reset accumulated vertical velocity when the character controller
    // reports it is grounded OR when the corrected movement has a non-negative
    // y component (upward or flat). The non-negative branch covers autostep:
    // when enableAutostep lifts the body over a step face, computedGrounded()
    // may briefly return false (the ball is "climbing" rather than resting on
    // a flat surface), but corrected.y is positive (the controller moved the
    // body UP). Without this branch, gravity accumulates over each autostep
    // lift and can reach -MAX_FALL_VELOCITY, triggering a spurious respawn
    // near the top of a staircase even though the bot is physically climbing.
    if (this.controller.computedGrounded() || corrected.y >= 0) {
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

    // Directional progress: shared with SceneFrame (human player) via
    // horizontalProgress() in physics/blocking.ts. Single source of truth for
    // the blocking decision for both bot and human paths.
    let progress = horizontalProgress(
      { x: corrected.x, z: corrected.z },
      { x: intent.x, z: intent.z },
    );
    let finalCorrected = { x: corrected.x, y: corrected.y, z: corrected.z };

    // Step-up assist (shared with the player — physics/step-up.ts):
    // when horizontal movement is blocked while grounded and falling/
    // level, probe for a climbable ledge ahead (a stair riser) and hop
    // onto it. Rapier's autostep cannot lift a ball over the honest
    // scanned 0.5 m risers, so this is THE climbing mechanism.
    //
    // `next.size === 0` (no peer contact this frame) is load-bearing:
    // without it a bot blocked by another CHARACTER treats the peer's
    // ball as a ledge and climbs onto their head — breaking head-on
    // blocking (scenario-collision) and spawn-area encounters. Steps
    // are walls; characters are not stairs.
    if (
      progress < 0.1 &&
      next.size === 0 &&
      this.controller.computedGrounded() &&
      this.verticalVel <= 0 &&
      (intent.x !== 0 || intent.z !== 0)
    ) {
      const hop = tryStepUp(this.stepUpProbe, intent.x, intent.z);
      if (hop) {
        finalCorrected = { x: hop.x, y: hop.y, z: hop.z };
        this.verticalVel = 0;
        progress = horizontalProgress(
          { x: hop.x, z: hop.z },
          { x: intent.x, z: intent.z },
        );
      }
      // The probe sweeps clobbered the controller's computed state
      // (grounded, collisions). Re-run the frame's real sweep so
      // anything reading controller state after this point — the
      // `grounded` field below, next frame's grounded check — sees
      // the actual frame, not the last probe.
      this.controller.computeColliderMovement(
        this.bodyCollider,
        { x: intent.x, y: this.verticalVel * intent.dtSec, z: intent.z },
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        BODY_GROUPS,
      );
    }

    return {
      corrected: finalCorrected,
      progress,
      bumps,
      grounded: this.controller.computedGrounded(),
    };
  }

  /** Adapter exposing this world's controller/body pair to the shared
   * step-up assist. `setTranslation` propagates the probe pose to the
   * colliders immediately so subsequent sweeps see it. */
  private readonly stepUpProbe: StepUpProbe = {
    compute: (desired) => {
      this.controller.computeColliderMovement(
        this.bodyCollider,
        desired,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        BODY_GROUPS,
      );
      const c = this.controller.computedMovement();
      return {
        x: c.x,
        y: c.y,
        z: c.z,
        grounded: this.controller.computedGrounded(),
      };
    },
    getTranslation: () => {
      const t = this.body.translation();
      return { x: t.x, y: t.y, z: t.z };
    },
    setTranslation: (p) => {
      this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      this.world.propagateModifiedBodyPositionsToColliders();
    },
    lastContactIsCharacter: () => {
      const n = this.controller.numComputedCollisions();
      for (let i = 0; i < n; i++) {
        const coll = this.controller.computedCollision(i);
        if (!coll?.collider) continue;
        const handle = coll.collider.handle;
        if (this.peerByColliderHandle.has(handle)) return true;
        if (this.tagByHandle.get(handle)?.kind === 'body') return true;
      }
      return false;
    },
  };

  /** Commit an absolute world-space pose to the bot's body. ALL
   * three components are written — y is no longer pinned, since
   * gravity drives vertical motion. */
  applyTranslation(pos: Vec3): void {
    this._lastAppliedPos = { x: pos.x, y: pos.y, z: pos.z };
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
  }

  /** Force the body to a fresh location and zero its fall speed.
   * Used by `BotDriver.setPosition` when the picker respawns the
   * cohort and by the fall-respawn path so the bot doesn't keep
   * accumulating downward velocity through the teleport. */
  teleport(pos: Vec3): void {
    this._lastAppliedPos = { x: pos.x, y: pos.y, z: pos.z };
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
