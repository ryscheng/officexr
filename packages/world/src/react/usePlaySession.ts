import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import type { Actions, Vec3 } from '@officexr/sdk';
import { loadMap, type LoadedMap, type MapLoaderDeps } from '../app/map-loader.ts';
import { proximityWorldSettings } from '../renderer/viewConfig.ts';
import type { ViewConfig } from '../renderer/viewConfig.ts';
import { useApplication } from './application-context.tsx';

/** Metres above the spawn point the local player is dropped from; gravity lands them. */
const SPAWN_DROP_HEIGHT = 4;

export type PlayStorages = MapLoaderDeps['storages'];

export interface UsePlaySessionOptions {
  actions: Pick<Actions, 'setWorldObjects' | 'setSelfPosition' | 'setWorldSettings'>;
  mapName: string;
  storages: PlayStorages;
  /** Changing this re-loads and re-applies `mapName` (reset & respawn). */
  reloadKey?: number;
  proximity: ViewConfig['proximity'];
  onMapApplied?: (spawnPoints: readonly Vec3[]) => void;
}

export interface PlaySession {
  /** Of the last map applied, which a failed later load leaves in place. */
  spawnPoints: readonly Vec3[];
  bakedLayoutName: string | undefined;
  bakedLayoutPath: string | undefined;
  error: string | null;
  dismissError: () => void;
  /** True once the first load into the current `actions` has settled, so
   * `<Scene>` (which broadcasts world state on mount) can mount. */
  ready: boolean;
}

/**
 * Loads `mapName` into the store through `actions`: pushes its world
 * objects, drops the local player above the first spawn point, and
 * applies the proximity world settings from `proximity`.
 */
export function usePlaySession({
  actions,
  mapName,
  storages,
  reloadKey,
  proximity,
  onMapApplied,
}: UsePlaySessionOptions): PlaySession {
  const { catalog, rooms } = useApplication();
  const [applied, setApplied] = useState<{ actions: UsePlaySessionOptions['actions']; map: LoadedMap | null } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const notifyApplied = useEffectEvent((spawnPoints: readonly Vec3[]) => onMapApplied?.(spawnPoints));

  useEffect(() => {
    let cancelled = false;
    loadMap({ storages, catalog, roomService: rooms }, mapName).then(
      (map) => {
        if (cancelled) {
          return;
        }
        actions.setWorldObjects(map.worldObjects);
        const spawnPoints = toVec3s(map);
        const spawn = spawnPoints[0];
        if (spawn) {
          actions.setSelfPosition({ ...spawn, y: spawn.y + SPAWN_DROP_HEIGHT }, { x: 0, y: 0, z: 0 }, 0, false);
        }
        setApplied({ actions, map });
        setError(null);
        notifyApplied(spawnPoints);
      },
      (err: Error) => {
        if (cancelled) {
          return;
        }
        console.warn(`[play-session] load("${mapName}") failed:`, err);
        setApplied((prev) => ({ actions, map: prev?.actions === actions ? prev.map : null }));
        setError(`Could not load map "${mapName}": ${err.message}`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [actions, mapName, storages, catalog, rooms, reloadKey]);

  useEffect(() => {
    actions.setWorldSettings(proximityWorldSettings(proximity));
  }, [actions, proximity]);

  const map = applied?.actions === actions ? applied.map : null;
  const spawnPoints = useMemo(() => (map ? toVec3s(map) : []), [map]);
  const bakedLayoutName = map?.bakedLayoutName;
  return {
    spawnPoints,
    bakedLayoutName,
    bakedLayoutPath: bakedLayoutName && `/api/baked-layouts/${encodeURIComponent(bakedLayoutName)}`,
    error,
    dismissError: () => setError(null),
    ready: applied?.actions === actions,
  };
}

function toVec3s(map: LoadedMap): Vec3[] {
  return map.spawnPoints.map(({ position: [x, y, z] }) => ({ x, y, z }));
}
