// Public physics surface. Everything Rapier-related the renderer + the
// bot subsystem need lives here.

export { worldMapToWalls, type WallDescriptor } from './worldMapToWalls.ts';
export {
  GRAVITY,
  SPAWN_DROP_HEIGHT,
  RESPAWN_MARGIN,
  respawnThreshold,
  worldObjectsToCuboids,
  pickRespawnPosition,
  type CuboidDescriptor,
} from './rules.ts';
export { routeContactEvent } from './bridge.ts';
export {
  BODY_GROUPS,
  WALL_GROUPS,
  INNER_SENSOR_GROUPS,
  OUTER_SENSOR_GROUPS,
  colliderTag,
  type ColliderKind,
  type ColliderTag,
} from './groups.ts';
