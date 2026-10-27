import type { BakedLayoutPlacement } from '../app/map-loader.ts';

type Loading = {
  type: 'loading';
  map: boolean;
  models: boolean;
  placementIds: readonly string[];
  collidersReady: readonly string[];
};

export type WorldReadiness = Loading | { type: 'ready' } | { type: 'failed'; message: string };

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
  placementIds: [],
  collidersReady: [],
};

/** Settles once, on the first load: after `ready` or `failed`, every event is ignored. */
export function worldReadiness(state: WorldReadiness, event: WorldReadinessEvent): WorldReadiness {
  if (state.type !== 'loading') {
    return state;
  }
  switch (event.type) {
    case 'mapFailed':
      return { type: 'failed', message: event.message };
    // ponytail: a missing or stale bake for one layout-linked room fails the whole world; falling back to that placement's instances would contain it.
    case 'collidersFailed':
      return { type: 'failed', message: event.message };
    case 'mapApplied':
      return settle({ ...state, map: true, placementIds: event.bakedLayouts.map((p) => p.roomInstanceId) });
    case 'modelsReady':
      return settle({ ...state, models: true });
    case 'collidersReady':
      return settle({ ...state, collidersReady: [...state.collidersReady, event.roomInstanceId] });
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function settle(state: Loading): WorldReadiness {
  return state.map && state.models && state.placementIds.every((id) => state.collidersReady.includes(id))
    ? { type: 'ready' }
    : state;
}
