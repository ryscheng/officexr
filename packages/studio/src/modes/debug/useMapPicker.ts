import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useControls, button } from 'leva';
import type { Actions } from '@officexr/sdk';
import type { BotPool } from '@officexr/world/bot';
import {
  FilesystemMapStorage,
  FilesystemRoomStorage,
  LocalStorageMapStorage,
  LocalStorageRoomStorage,
  compileMap,
  emptyMapDocument,
  type MapDocumentV1,
  type RoomDocument,
  type SpawnPoint,
} from '@officexr/world/scenes';

const LAST_MAP_KEY = 'officexr:studio:lastMap';
const CUBE_SIZE = 2;

interface UseMapPickerOpts {
  /** Local player's actions surface — the picker uses this to push the
   * compiled map's `WorldObjects` snapshot into the SDK store and to
   * teleport the local player to a spawn. */
  actions: Actions | null;
  /** The in-browser bot pool (in-memory mode only). Null while the
   * stack is still bootstrapping or in WS mode (where the Node bots
   * CLI owns its own pool — see TODO note below for that case). */
  bots: BotPool | null;
}

/**
 * Adds a "Map" panel to the right-hand Leva panel in Debug Mode.
 * Exposes:
 *   - A `name` dropdown of every map in `/api/maps` (re-fetched via
 *     the Reload button).
 *   - A "Load" button that compiles the selected map + pushes it into
 *     the SDK store via `actions.setWorldObjects(...)`. Also teleports
 *     the local player to the first spawn point.
 *   - A "Reset & respawn" button that re-applies the same map AND
 *     warps every in-browser bot to one of the spawns (cycling modulo
 *     spawn count).
 *
 * Persists the last-selected map in `localStorage` so a reload brings
 * the user back to the same map without re-picking.
 *
 * WS-mode TODO: when the Node bots CLI owns the pool, we'd need to
 * publish a `bot:respawn` event over the realtime-server's
 * control channel. Out of scope for v1 — the in-memory pool is
 * Debug's primary playtest path.
 */
export function useMapPicker({ actions, bots }: UseMapPickerOpts): void {
  // Stable storage clients across renders.
  const storage = useMemo(() => {
    try {
      return {
        maps: new FilesystemMapStorage(),
        rooms: new FilesystemRoomStorage(),
      };
    } catch {
      return {
        maps: new LocalStorageMapStorage(),
        rooms: new LocalStorageRoomStorage(),
      };
    }
  }, []);

  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);
  const botsRef = useRef(bots);
  useEffect(() => {
    botsRef.current = bots;
  }, [bots]);

  // Fetch the map list once on mount + on demand. Stored in a ref so
  // the Leva panel can read it synchronously without re-rendering on
  // every list change. The dropdown is rebuilt by re-calling
  // `useControls` with a fresh `options` block via the `mapKey` dep.
  const mapsRef = useRef<string[]>([]);
  const initialName = useMemo(() => {
    try {
      return globalThis.localStorage?.getItem(LAST_MAP_KEY) ?? 'default';
    } catch {
      return 'default';
    }
  }, []);
  const selectedRef = useRef<string>(initialName);

  // Re-key Leva's schema when the maps list changes so the dropdown
  // options update. Without this, Leva caches the options object's
  // identity and a fresh fetch's new map names wouldn't appear.
  const mapsListVersionRef = useRef(0);

  const loadMap = useCallback(
    async (name: string): Promise<{ map: MapDocumentV1; spawns: SpawnPoint[] } | null> => {
      try {
        const map = await storage.maps.load(name);
        if (!map) return null;
        // Fetch every referenced room concurrently; missing ones are
        // skipped (compileMap will warn for each).
        const refSet = new Set<string>();
        for (const ri of map.rooms) refSet.add(ri.roomName);
        const roomEntries = await Promise.all(
          Array.from(refSet).map(async (roomName) => {
            try {
              const doc = await storage.rooms.load(roomName);
              return doc ? ([roomName, doc] as const) : null;
            } catch (err) {
              console.warn(`[map-picker] room load("${roomName}") failed:`, err);
              return null;
            }
          }),
        );
        const rooms = new Map<string, RoomDocument>();
        for (const e of roomEntries) {
          if (e) rooms.set(e[0], e[1]);
        }

        const a = actionsRef.current;
        if (a) {
          const compiled = compileMap(map, rooms, CUBE_SIZE);
          a.setWorldObjects(compiled);
        }
        return { map, spawns: map.spawnPoints };
      } catch (err) {
        console.warn(`[map-picker] load("${name}") failed:`, err);
        return null;
      }
    },
    [storage],
  );

  const teleportLocal = useCallback((spawns: readonly SpawnPoint[]) => {
    const a = actionsRef.current;
    if (!a) return;
    const target = spawns[0];
    if (!target) return;
    a.setSelfPosition(
      { x: target.position[0], y: target.position[1], z: target.position[2] },
      { x: 0, y: 0, z: 0 },
      0,
    );
  }, []);

  const respawnBots = useCallback((spawns: readonly SpawnPoint[]) => {
    const pool = botsRef.current;
    if (!pool) return;
    if (spawns.length === 0) {
      // No spawns defined — fall back to perimeter ring inside BotPool.
      pool.respawnAll([]);
      return;
    }
    pool.respawnAll(
      spawns.map((s) => ({ x: s.position[0], y: s.position[1], z: s.position[2] })),
    );
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = await storage.maps.list();
      mapsRef.current = list.map((m) => m.name).sort();
    } catch (err) {
      console.warn('[map-picker] list failed:', err);
      mapsRef.current = [];
    }
    mapsListVersionRef.current += 1;
  }, [storage]);

  useEffect(() => {
    // Bootstrap: fetch list, then load the persisted map if it exists.
    let cancelled = false;
    void (async () => {
      await reload();
      if (cancelled) return;
      const name = selectedRef.current;
      const result = await loadMap(name);
      if (cancelled) return;
      if (result) {
        teleportLocal(result.spawns);
        respawnBots(result.spawns);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  // Stable callbacks for the Leva buttons.
  const onChoose = useCallback(
    async (name: string) => {
      selectedRef.current = name;
      try {
        globalThis.localStorage?.setItem(LAST_MAP_KEY, name);
      } catch {
        // ignore.
      }
      const result = await loadMap(name);
      if (result) {
        teleportLocal(result.spawns);
        respawnBots(result.spawns);
      }
    },
    [loadMap, teleportLocal, respawnBots],
  );

  const onReset = useCallback(async () => {
    const result = await loadMap(selectedRef.current);
    if (result) {
      teleportLocal(result.spawns);
      respawnBots(result.spawns);
    }
  }, [loadMap, teleportLocal, respawnBots]);

  const onReload = useCallback(async () => {
    await reload();
  }, [reload]);

  // Re-key on the list-version so the dropdown reflects fresh fetches.
  const keyForLeva = `${mapsListVersionRef.current}:${initialName}`;
  useControls(
    'Map',
    () => {
      const names = mapsRef.current.length > 0 ? mapsRef.current : [initialName];
      const options = Object.fromEntries(names.map((n) => [n, n]));
      // Always include the persisted name so the dropdown can default
      // to it even before the list resolves.
      if (!options[initialName]) options[initialName] = initialName;
      return {
        name: {
          value: selectedRef.current,
          options,
          onChange: (v: string) => {
            void onChoose(v);
          },
        },
        Reload: button(() => {
          void onReload();
        }),
        'Reset & respawn': button(() => {
          void onReset();
        }),
      } as unknown as Record<string, never>;
    },
    [keyForLeva],
  );

  // Keep the unused emptyMapDocument import alive for the future
  // "create new map from Debug" workflow without forcing tsc to
  // complain about it now.
  void emptyMapDocument;
}
