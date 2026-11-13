import RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerId, Vec3 } from '@officexr/sdk';
import { BODY_GROUPS, WALL_GROUPS } from './groups.ts';
import { BODY_Y, type ColliderDescriptor } from './rules.ts';

/** Colliders sharing one fixed body, placed in world space by `position` and a yaw about +Y. */
export interface StaticColliderSet {
  colliders: readonly ColliderDescriptor[];
  position?: Vec3;
  yawRad?: number;
}

/**
 * Keeps a headless Rapier world's static map colliders and per-peer
 * kinematic mirror bodies in step with plain-data descriptors. Shared by
 * `BotPhysicsWorld` and the local player's `TsSimCore`.
 */
export class ColliderSync {
  private staticBodies: RAPIER.RigidBody[] = [];
  private mirrors = new Map<PlayerId, RAPIER.Collider>();
  private peerByHandle = new Map<number, PlayerId>();

  constructor(private readonly world: RAPIER.World) {}

  /** Replaces every static collider with `sets`. */
  setStatic(sets: readonly StaticColliderSet[]): void {
    for (const b of this.staticBodies) {
      this.world.removeRigidBody(b);
    }
    this.staticBodies = sets.map((set) => this.addStatic(set));
  }

  private addStatic({ colliders, position, yawRad = 0 }: StaticColliderSet): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.fixed();
    if (position) {
      desc.setTranslation(position.x, position.y, position.z);
    }
    if (yawRad !== 0) {
      desc.setRotation({ x: 0, y: Math.sin(yawRad / 2), z: 0, w: Math.cos(yawRad / 2) });
    }
    const body = this.world.createRigidBody(desc);
    for (const c of colliders) {
      const cdesc =
        c.type === 'cuboid'
          ? RAPIER.ColliderDesc.cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z).setTranslation(
              c.center.x,
              c.center.y,
              c.center.z,
            )
          : RAPIER.ColliderDesc.trimesh(new Float32Array(c.vertices), new Uint32Array(c.indices));
      this.world.createCollider(cdesc.setCollisionGroups(WALL_GROUPS), body);
    }
    return body;
  }

  /**
   * Creates, moves (as of the next world step) and removes one ball mirror
   * per entry of `peers`, keyed by player id. Returns the ids whose mirrors
   * were removed.
   */
  syncPeers(peers: ReadonlyMap<PlayerId, Vec3>, charRadius: number): PlayerId[] {
    for (const [id, pos] of peers) {
      const mirror = this.mirrors.get(id);
      if (mirror) {
        mirror.parent()!.setNextKinematicTranslation(pos);
        if (mirror.radius() !== charRadius) {
          mirror.setRadius(charRadius);
        }
        continue;
      }
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.ball(charRadius)
          .setTranslation(0, BODY_Y, 0)
          .setCollisionGroups(BODY_GROUPS)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
          .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL),
        body,
      );
      this.mirrors.set(id, collider);
      this.peerByHandle.set(collider.handle, id);
    }
    const removed: PlayerId[] = [];
    for (const [id, collider] of this.mirrors) {
      if (peers.has(id)) {
        continue;
      }
      this.peerByHandle.delete(collider.handle);
      this.world.removeRigidBody(collider.parent()!);
      this.mirrors.delete(id);
      removed.push(id);
    }
    return removed;
  }

  /** The player a mirror collider stands for, if `handle` is one. */
  peerIdOf(handle: number): PlayerId | undefined {
    return this.peerByHandle.get(handle);
  }
}
