export type WorldReadiness =
  | { type: 'loading'; map: boolean; models: boolean; colliders: boolean }
  | { type: 'ready' }
  | { type: 'failed'; message: string };

export type WorldReadinessEvent =
  | { type: 'mapApplied'; bakedColliders: boolean }
  | { type: 'mapFailed'; message: string }
  | { type: 'modelsReady' }
  | { type: 'collidersReady' }
  | { type: 'collidersFailed'; message: string };

export const INITIAL_WORLD_READINESS: WorldReadiness = {
  type: 'loading',
  map: false,
  models: false,
  colliders: false,
};

/** Settles once, on the first load: after `ready` or `failed`, every event is ignored. */
export function worldReadiness(state: WorldReadiness, event: WorldReadinessEvent): WorldReadiness {
  if (state.type !== 'loading') {
    return state;
  }
  if (event.type === 'mapFailed' || event.type === 'collidersFailed') {
    return { type: 'failed', message: event.message };
  }
  const next =
    event.type === 'mapApplied'
      ? { ...state, map: true, colliders: state.colliders || !event.bakedColliders }
      : event.type === 'modelsReady'
        ? { ...state, models: true }
        : { ...state, colliders: true };
  return next.map && next.models && next.colliders ? { type: 'ready' } : next;
}
