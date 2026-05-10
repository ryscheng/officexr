export * from './types.ts';
export { groupConnectedCubes } from './flood-fill.ts';
export { buildCollisionWorld, getCollisionWorld } from './world.ts';
export { cellAt, cellCenter, forEachCellInRadius } from './query.ts';
export { resolveMovement } from './resolve.ts';
export {
  CHARACTER_BODY,
  CHARACTER_PROXIMITY_INNER,
  CHARACTER_PROXIMITY_OUTER,
  CUBE_WALKABLE,
  CUBE_WALL,
  DEFAULT_COLLISION_MATRIX,
  interactionFor,
  mergeMatrix,
  type CollisionMatrix,
  type Interaction,
  type MaterialId,
} from './materials.ts';
export {
  bodyShapeId,
  derivePlayerShapes,
  innerProximityShapeId,
  outerProximityShapeId,
  type Shape,
} from './shapes.ts';
export { runCollisionPass, type CollisionEvent, type ShapeRef } from './pass.ts';
