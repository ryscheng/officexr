import RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerId, Vec3, WorldObjects } from '@officexr/sdk';
import { createInstanceGeometry } from '../app/geometry-service.ts';
import { excludeLayoutInstances } from '../scenes/compile-map.ts';
import { stepAirVelocity } from '../physics/air-control.ts';
import { horizontalProgress } from '../physics/blocking.ts';
import { ColliderSync } from '../physics/collider-sync.ts';
import { BODY_GROUPS } from '../physics/groups.ts';
import { kccStepUpProbe } from '../physics/kcc-step-up-probe.ts';
import {
  BODY_Y,
  CHARACTER_CONTROLLER_SKIN,
  FLOOR_PROBE_RANGE,
  GRAVITY,
  pickRespawnPosition,
  respawnThreshold,
  shouldRespawnFalling,
  worldObjectsToColliders,
} from '../physics/rules.ts';
import { tryStepUp, type StepUpProbe } from '../physics/step-up.ts';
import type { SimBakedColliders, SimCore, SimInput, SimKinds, SimPeer, SimStepResult } from './SimCore.ts';

/**
 * `SimCore` on rapier3d-compat. The player is a kinematic ball the
 * character controller sweeps; gravity, jumps, air control and the
 * landing ease are integrated here because the controller only resolves
 * the desired translation it is given. Needs `RAPIER.init()` to have
 * resolved before construction.
 */
export class TsSimCore implements SimCore {
  private readonly world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  private readonly colliders = new ColliderSync(this.world);
  private readonly body: RAPIER.RigidBody;
  private readonly bodyCollider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly stepUpProbe: StepUpProbe;
  private worldObjects: WorldObjects = { cubeSize: 1, instances: [] };

  private gravityEnabled = true;
  /** m/s, negative falling; reset when grounded. */
  private verticalVel = 0;
  /** Set by a jump and cleared once the landing ease finishes; not inferred from jumps left. */
  private airborne = false;
  /** Refilled to `maxJumps` on the ground; starts empty until the first grounded step. */
  private jumpsRemaining = 0;
  /** The last step's `maxJumps`, which `land` refills to. */
  private maxJumps = 0;
  private airVel = { x: 0, z: 0 };
  private landingBlendMs = 0;
  private blendStartVel = { x: 0, z: 0 };
  private bumpingPeers = new Set<PlayerId>();

  constructor(charRadius: number) {
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.bodyCollider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(charRadius)
        .setTranslation(0, BODY_Y, 0)
        .setCollisionGroups(BODY_GROUPS)
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL),
      this.body,
    );
    this.controller = this.world.createCharacterController(CHARACTER_CONTROLLER_SKIN);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.setSlideEnabled(true);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    // Keeps the ball on the ground across seams between nominally level cubes.
    this.controller.enableSnapToGround(0.3);
    // No Rapier autostep: it can't lift the ball over real risers yet climbs
    // other characters; `tryStepUp` climbs ledges instead.
    this.stepUpProbe = kccStepUpProbe(this.world, this.controller, this.body, this.bodyCollider, (handle) =>
      this.colliders.peerIdOf(handle) !== undefined,
    );
  }

  setStaticColliders(worldObjects: WorldObjects, kinds: SimKinds, bakedColliders: readonly SimBakedColliders[]): void {
    this.worldObjects = worldObjects;
    const byId = new Map(kinds.kinds.map((k) => [k.id, k]));
    const geometry = createInstanceGeometry({ catalog: { getKind: (id) => byId.get(id) }, voxelSize: kinds.voxelSize });
    const baked = excludeLayoutInstances(bakedColliders);
    const unbaked = baked ? { ...worldObjects, instances: worldObjects.instances.filter((i) => !baked(i)) } : worldObjects;
    this.colliders.setStatic([
      { colliders: worldObjectsToColliders(unbaked, geometry.worldAABB, (id) => byId.get(id)?.colliderShape) },
      ...bakedColliders,
    ]);
    this.commit();
  }

  syncPeers(peers: readonly SimPeer[], charRadius: number): void {
    const removed = this.colliders.syncPeers(new Map(peers.map((p) => [p.id, p.pos])), charRadius);
    for (const id of removed) {
      this.bumpingPeers.delete(id);
    }
  }

  position(): Vec3 {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  teleport(pos: Vec3): void {
    this.body.setNextKinematicTranslation(pos);
    this.commit();
    this.land();
  }

  /** Grounded with a fresh set of jumps and no fall, carry or landing ease left. */
  private land(): void {
    this.verticalVel = 0;
    this.airborne = false;
    this.jumpsRemaining = this.maxJumps;
    this.airVel = { x: 0, z: 0 };
    this.landingBlendMs = 0;
  }

  setGravityEnabled(on: boolean): void {
    this.gravityEnabled = on;
    if (!on) {
      // Jumps left stay: zeroing them would read as airborne every frame.
      this.verticalVel = 0;
      this.airborne = false;
      this.airVel = { x: 0, z: 0 };
      this.landingBlendMs = 0;
    }
  }

  step(input: SimInput): SimStepResult {
    const { dtSec, dir, speed, settings } = input;
    const { jumpVelocity, airControl, maxJumps, landingEaseMs, movementBlockThreshold } = settings;
    this.maxJumps = maxJumps;
    if (this.bodyCollider.radius() !== settings.charRadius) {
      this.bodyCollider.setRadius(settings.charRadius);
    }
    const isAirborne = this.airborne;
    const intendsMove = dir.x !== 0 || dir.z !== 0;

    this.verticalVel = this.gravityEnabled ? this.verticalVel + GRAVITY * dtSec : 0;

    // Reads the previous step's sweep, so it runs before the jump: a
    // freshly landed step that also jumps gets its jump back.
    if (this.controller.computedGrounded()) {
      this.verticalVel = 0;
      if (this.airborne) {
        if (this.landingBlendMs === 0) {
          this.blendStartVel = { ...this.airVel };
        }
        this.landingBlendMs += dtSec * 1000;
        if (landingEaseMs <= 0 || this.landingBlendMs >= landingEaseMs) {
          this.land();
        } else {
          const keep = 1 - this.landingBlendMs / landingEaseMs;
          this.airVel = { x: this.blendStartVel.x * keep, z: this.blendStartVel.z * keep };
        }
      } else {
        this.jumpsRemaining = maxJumps;
        this.landingBlendMs = 0;
      }
    }

    if (input.jump && this.jumpsRemaining > 0 && this.gravityEnabled) {
      this.verticalVel = jumpVelocity;
      if (!this.airborne) {
        this.airVel = { x: dir.x * speed, z: dir.z * speed };
      }
      this.airborne = true;
      this.jumpsRemaining--;
      this.landingBlendMs = 0;
    }

    if (isAirborne && this.airborne && this.landingBlendMs === 0) {
      this.airVel = stepAirVelocity(this.airVel, { x: dir.x * speed, z: dir.z * speed }, airControl, dtSec);
    }
    const moveX = isAirborne ? this.airVel.x * dtSec : dir.x * speed * dtSec;
    const moveZ = isAirborne ? this.airVel.z * dtSec : dir.z * speed * dtSec;

    const corrected = this.sweep(moveX, moveZ, dtSec);

    // Lifted over a ledge rather than falling. Unlike bots, only a falling
    // speed resets: a jump's ascent also moves up and must survive.
    if (this.verticalVel < 0 && corrected.y >= 0) {
      this.verticalVel = 0;
    }

    const bumps = this.edgeTriggeredBumps();

    const progress = horizontalProgress(corrected, { x: moveX, z: moveZ });
    let horizBlocked = intendsMove && progress < 1 - movementBlockThreshold;
    let delta = corrected;

    // Characters are not stairs: blocked by a peer, bump instead of climbing it.
    if (horizBlocked && this.bumpingPeers.size === 0 && this.controller.computedGrounded() && this.verticalVel <= 0) {
      const hop = tryStepUp(this.stepUpProbe, moveX, moveZ);
      if (hop) {
        delta = hop;
        horizBlocked = false;
        this.verticalVel = 0;
      }
      // The probe sweeps overwrote the controller state the next step's grounded check reads.
      this.sweep(moveX, moveZ, dtSec);
    }

    const t = this.body.translation();
    let newPos = {
      x: horizBlocked ? t.x : t.x + delta.x,
      y: t.y + delta.y,
      z: horizBlocked ? t.z : t.z + delta.z,
    };

    const hasFloorUnderneath =
      this.world.castRay(
        new RAPIER.Ray(newPos, { x: 0, y: -1, z: 0 }),
        FLOOR_PROBE_RANGE,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      ) !== null;
    // The spawn floor gives baked maps, whose floors aren't instances, a finite backstop.
    const respawnAt =
      shouldRespawnFalling(this.verticalVel, hasFloorUnderneath) ||
      newPos.y < respawnThreshold(this.worldObjects, input.spawnPoints)
        ? pickRespawnPosition(input.spawnPoints)
        : null;
    if (respawnAt) {
      newPos = respawnAt;
      this.land();
    }

    this.body.setNextKinematicTranslation(newPos);
    this.commit();

    const walking = intendsMove && !horizBlocked;
    return {
      newPos,
      broadcastVel: isAirborne
        ? { x: this.airVel.x, y: 0, z: this.airVel.z }
        : walking
          ? { x: dir.x * speed * progress, y: 0, z: dir.z * speed * progress }
          : { x: 0, y: 0, z: 0 },
      broadcastYaw: input.yaw,
      moved: isAirborne || walking,
      animState: walking ? (input.running ? 'run' : 'walk') : 'idle',
      velY: this.verticalVel,
      hasFloorUnderneath,
      isGrounded: this.controller.computedGrounded(),
      bumps,
      isAirborne,
      respawned: respawnAt !== null,
    };
  }

  private sweep(moveX: number, moveZ: number, dtSec: number): Vec3 {
    // EXCLUDE_SENSORS: the query pipeline would otherwise treat the
    // invisible proximity rings as solid.
    this.controller.computeColliderMovement(
      this.bodyCollider,
      { x: moveX, y: this.verticalVel * dtSec, z: moveZ },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const c = this.controller.computedMovement();
    return { x: c.x, y: c.y, z: c.z };
  }

  /** Peers the last sweep touched that the previous one didn't; the controller slides, so no contact events fire. */
  private edgeTriggeredBumps(): SimStepResult['bumps'] {
    const touching = new Set<PlayerId>();
    const bumps: SimStepResult['bumps'] = [];
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const coll = this.controller.computedCollision(i);
      const otherId = coll?.collider ? this.colliders.peerIdOf(coll.collider.handle) : undefined;
      if (!coll || !otherId) {
        continue;
      }
      touching.add(otherId);
      if (!this.bumpingPeers.has(otherId)) {
        bumps.push({ otherId, normal: { x: coll.normal1.x, z: coll.normal1.z } });
      }
    }
    this.bumpingPeers = touching;
    return bumps;
  }

  /** Lands pending kinematic moves so the next sweep and ray cast see them. */
  private commit(): void {
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}
