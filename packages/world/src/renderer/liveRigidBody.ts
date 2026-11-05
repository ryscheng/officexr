import type { RigidBody } from '@dimforge/rapier3d-compat';

/**
 * `body` if it is still in its world, else null.
 *
 * `@react-three/rapier` calls a `<RigidBody>` ref only when it creates the body, never with null when
 * it removes it, so a ref can outlive its body (a peer leaves, or rejoins and the new body isn't
 * created yet). Any call on a removed body traps Rapier's wasm and leaves the whole world unusable,
 * so every per-frame use of a stored body goes through this.
 */
export function liveRigidBody<T extends RigidBody>(body: T | null | undefined): T | null {
  return body && body.isValid() ? body : null;
}
