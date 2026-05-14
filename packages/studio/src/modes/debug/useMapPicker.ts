import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Actions } from '@officexr/sdk';
import type { BotPool } from '@officexr/world/bot';
import {
  FilesystemMapStorage,
  FilesystemRoomStorage,
  LocalStorageMapStorage,
  LocalStorageRoomStorage,
  compileMap,
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
   * CLI owns its own pool). */
  bots: BotPool | null;
}

export interface MapPickerState {
  /** All map names served by `/api/maps`, sorted alphabetically. */
  maps: readonly string[];
  /** The map currently selected by the dropdown. */
  selected: string;
  /** Pick a different map; loads it, pushes WorldObjects, teleports
   *  the local player, and respawns bots. */
  choose: (name: string) => void;
  /** Re-apply the current map (re-load + re-teleport + bot respawn). */
  reset: () => void;
  /** Re-fetch the list from /api/maps. */
  reloadList: () => void;
}

/**
 * Headless state hook for the Debug-mode Map picker. No Leva. The
 * paired UI component (`MapPickerPanel`) consumes this state to
 * render a select + two buttons.
 *
 * Behaviour on mount:
 *   1. Fetch the `/api/maps` listing.
 *   2. Load the persisted last-selected map (or `default`).
 *   3. Push its compiled WorldObjects to the SDK store, teleport the
 *      local player to the first spawn, and respawn bots.
 *
 * Persists the last-selected map to localStorage so a page reload
 * returns to the same map.
 *
 * WS-mode TODO: in WS mode the bots run in the Node CLI and the
 * in-browser pool is null. A `bot:respawn` event over the realtime
 * server's control channel would close the gap — out of scope.
 */
export function useMapPicker({ actions, bots }: UseMapPickerOpts): MapPickerState {
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

  // Keep the latest actions/bots in refs so the load/teleport
  // callbacks don't get recreated every time a parent rerenders
  // for an unrelated reason.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);
  const botsRef = useRef(bots);
  useEffect(() => {
    botsRef.current = bots;
  }, [bots]);

  const initialName = useMemo(() => {
    try {
      return globalThis.localStorage?.getItem(LAST_MAP_KEY) ?? 'default';
    } catch {
      return 'default';
    }
  }, []);

  const [maps, setMaps] = useState<string[]>([initialName]);
  const [selected, setSelected] = useState<string>(initialName);

  const loadMap = useCallback(
    async (
      name: string,
    ): Promise<{ map: MapDocumentV1; spawns: SpawnPoint[] } | null> => {
      try {
        const map = await storage.maps.load(name);
        if (!map) return null;
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
          a.setWorldObjects(compileMap(map, rooms, CUBE_SIZE));
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
    if (!a || spawns.length === 0) return;
    const t = spawns[0].position;
    a.setSelfPosition({ x: t[0], y: t[1], z: t[2] }, { x: 0, y: 0, z: 0 }, 0);
  }, []);

  const respawnBots = useCallback((spawns: readonly SpawnPoint[]) => {
    const pool = botsRef.current;
    if (!pool) return;
    if (spawns.length === 0) {
      pool.respawnAll([]);
      return;
    }
    pool.respawnAll(
      spawns.map((s) => ({ x: s.position[0], y: s.position[1], z: s.position[2] })),
    );
  }, []);

  const reloadList = useCallback(async () => {
    try {
      const list = await storage.maps.list();
      const names = list.map((m) => m.name).sort();
      // Always keep the selected name visible even if storage doesn't
      // know about it yet (just-created map).
      if (!names.includes(selected)) names.push(selected);
      setMaps(names);
    } catch (err) {
      console.warn('[map-picker] list failed:', err);
      setMaps([selected]);
    }
  }, [storage, selected]);

  // Bootstrap: fetch list, load persisted map, teleport + respawn.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await reloadList();
      if (cancelled) return;
      const result = await loadMap(initialName);
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
  }, []);

  const choose = useCallback(
    (name: string) => {
      setSelected(name);
      try {
        globalThis.localStorage?.setItem(LAST_MAP_KEY, name);
      } catch {
        // ignore.
      }
      void (async () => {
        const result = await loadMap(name);
        if (result) {
          teleportLocal(result.spawns);
          respawnBots(result.spawns);
        }
      })();
    },
    [loadMap, teleportLocal, respawnBots],
  );

  const reset = useCallback(() => {
    void (async () => {
      const result = await loadMap(selected);
      if (result) {
        teleportLocal(result.spawns);
        respawnBots(result.spawns);
      }
    })();
  }, [selected, loadMap, teleportLocal, respawnBots]);

  return { maps, selected, choose, reset, reloadList };
}
