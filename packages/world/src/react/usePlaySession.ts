import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import type { Actions, Vec3 } from '@officexr/sdk';
import { bakedLayoutAssetUrl } from '../app/asset-url.ts';
import { loadMap, type LoadedMap, type MapLoaderDeps } from '../app/map-loader.ts';
import { useApplication } from './application-context.tsx';

/** Clearance above the spawn point the local player appears at; the floor is loaded by then. */
const SPAWN_DROP_HEIGHT = 0.1;

export type PlayStorages = MapLoaderDeps['storages'];

export interface UsePlaySessionOptions {
  actions: Pick<Actions, 'setWorldObjects' | 'setSelfPosition'>;
  mapName: string;
  storages: PlayStorages;
  /** Changing this re-loads and re-applies `mapName` (reset & respawn). */
  reloadKey?: number;
  onMapApplied?: (spawnPoints: readonly Vec3[]) => void;
}

export interface PlaySession {
  /** Of the last map applied, which a failed later load leaves in place. */
  spawnPoints: readonly Vec3[];
  bakedLayoutName: string | undefined;
  bakedLayoutPath: string | undefined;
  bakedPlacement: LoadedMap['bakedPlacement'];
  error: string | null;
  dismissError: () => void;
  /** True once the first load into the current `actions` has settled, either way. */
  ready: boolean;
  /** A map is applied for the current `actions`; a failed reload keeps it. */
  loaded: boolean;
  /** The first load into the current `actions` failed, so nothing is applied. */
  failed: boolean;
}

/**
 * Loads `mapName` into the store through `actions`: pushes its world
 * objects and places the local player just above the first spawn point.
 */
export function usePlaySession({
  actions,
  mapName,
  storages,
  reloadKey,
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
      (err: unknown) => {
        if (cancelled) {
          return;
        }
        console.warn(`[play-session] load("${mapName}") failed:`, err);
        setApplied((prev) => ({ actions, map: prev?.actions === actions ? prev.map : null }));
        setError(`Could not load map "${mapName}": ${err instanceof Error ? err.message : String(err)}`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [actions, mapName, storages, catalog, rooms, reloadKey]);

  const map = applied?.actions === actions ? applied.map : null;
  const spawnPoints = useMemo(() => (map ? toVec3s(map) : []), [map]);
  const bakedLayoutName = map?.bakedLayoutName;
  const ready = applied?.actions === actions;
  return {
    spawnPoints,
    bakedLayoutName,
    bakedLayoutPath: bakedLayoutName ? bakedLayoutAssetUrl(bakedLayoutName) : undefined,
    bakedPlacement: map?.bakedPlacement,
    error,
    dismissError: () => setError(null),
    ready,
    loaded: map !== null,
    failed: ready && map === null,
  };
}

function toVec3s(map: LoadedMap): Vec3[] {
  return map.spawnPoints.map(({ position: [x, y, z] }) => ({ x, y, z }));
}
