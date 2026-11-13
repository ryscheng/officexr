import RAPIER from '@dimforge/rapier3d-compat';
import type { StepUpProbe } from './step-up.ts';

/**
 * `tryStepUp`'s probe over a Rapier character controller and its body.
 * `setTranslation` propagates the probe pose to the colliders at once so
 * later sweeps see it.
 */
export function kccStepUpProbe(
  world: RAPIER.World,
  controller: RAPIER.KinematicCharacterController,
  body: RAPIER.RigidBody,
  collider: RAPIER.Collider,
  isCharacter: (colliderHandle: number) => boolean,
  filterGroups?: number,
): StepUpProbe {
  return {
    compute: (desired) => {
      controller.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, filterGroups);
      const c = controller.computedMovement();
      return { x: c.x, y: c.y, z: c.z, grounded: controller.computedGrounded() };
    },
    getTranslation: () => {
      const t = body.translation();
      return { x: t.x, y: t.y, z: t.z };
    },
    setTranslation: (p) => {
      body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      world.propagateModifiedBodyPositionsToColliders();
    },
    lastContactIsCharacter: () => {
      for (let i = 0; i < controller.numComputedCollisions(); i++) {
        const handle = controller.computedCollision(i)?.collider?.handle;
        if (handle !== undefined && isCharacter(handle)) {
          return true;
        }
      }
      return false;
    },
  };
}
