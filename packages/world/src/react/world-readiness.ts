import type { BakedLayoutPlacement } from '../app/map-loader.ts';

export type WorldReadiness =
  | {
      type: 'loading';
      map: boolean;
      models: boolean;
      /** Room instance ids of the baked layouts whose colliders must mount; known once the map applies. */
      bakedLayouts: readonly string[];
      collidersReady: readonly string[];
    }
  | { type: 'ready' }
  | { type: 'failed'; message: string };

export type WorldReadinessEvent =
  | { type: 'mapApplied'; bakedLayouts: readonly Pick<BakedLayoutPlacement, 'roomInstanceId'>[] }
  | { type: 'mapFailed'; message: string }
  | { type: 'modelsReady' }
  | { type: 'collidersReady'; roomInstanceId: string }
  | { type: 'collidersFailed'; message: string };

export const INITIAL_WORLD_READINESS: WorldReadiness = {
  type: 'loading',
  map: false,
  models: false,
  bakedLayouts: [],
  collidersReady: [],
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
      ? { ...state, map: true, bakedLayouts: event.bakedLayouts.map((p) => p.roomInstanceId) }
      : event.type === 'modelsReady'
        ? { ...state, models: true }
        : { ...state, collidersReady: [...state.collidersReady, event.roomInstanceId] };
  return next.map && next.models && next.bakedLayouts.every((id) => next.collidersReady.includes(id))
    ? { type: 'ready' }
    : next;
}
