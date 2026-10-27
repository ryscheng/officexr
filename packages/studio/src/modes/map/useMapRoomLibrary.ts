import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FilesystemLayoutStorage,
  FilesystemRoomStorage,
  LocalStorageLayoutStorage,
  LocalStorageRoomStorage,
  isBakedRoom,
  type LayoutDocument,
  type LayoutStorage,
  type RoomDocument,
  type RoomStorage,
} from '@officexr/world/scenes';
import { useTestStorages } from '../../test-harness/TestStorageContext.tsx';

/**
 * Loads the set of `RoomDocument`s referenced by the Map editor's
 * current map. Maintains:
 *   - `rooms` — a Map<roomName, RoomDocument> the canvas + compileMap
 *     consume.
 *   - `allRoomNames` — every room available in storage (drives the
 *     RoomPalette so the author can drop rooms they haven't placed yet).
 *   - `loading` — true while at least one referenced room is in flight.
 *
 * The hook intentionally fetches LAZILY per-name rather than eagerly
 * loading the whole `/api/rooms` listing's contents up-front — for a
 * map that uses 3 of 50 saved rooms, eager loading wastes the trip.
 *
 * Re-fetches if the requested set changes (e.g. user adds a new room
 * instance pointing at a previously-unseen room name).
 */
export interface UseMapRoomLibraryResult {
  rooms: ReadonlyMap<string, RoomDocument>;
  /** Layouts of the loaded baked rooms, which `compileMap` needs for their geometry. */
  layouts: ReadonlyMap<string, LayoutDocument>;
  allRoomNames: readonly string[];
  loading: boolean;
  /** Refresh the room-name listing (used by RoomPalette's reload). */
  refreshList: () => Promise<void>;
}

export function useMapRoomLibrary(
  referenced: ReadonlySet<string>,
): UseMapRoomLibraryResult {
  const testStorages = useTestStorages();
  const fallbackRoomStorage = useMemo<RoomStorage>(() => {
    try {
      return new FilesystemRoomStorage();
    } catch {
      return new LocalStorageRoomStorage();
    }
  }, []);
  const storage = testStorages?.roomStorage ?? fallbackRoomStorage;
  const fallbackLayoutStorage = useMemo<LayoutStorage>(() => {
    try {
      return new FilesystemLayoutStorage();
    } catch {
      return new LocalStorageLayoutStorage();
    }
  }, []);
  const layoutStorage = testStorages?.layoutStorage ?? fallbackLayoutStorage;

  const [allRoomNames, setAllRoomNames] = useState<readonly string[]>([]);

  // Fetch the room listing once on mount and on refresh.
  const refreshList = useMemo(
    () => async () => {
      try {
        const list = await storage.list();
        setAllRoomNames(list.map((s) => s.name).sort());
      } catch (err) {
        console.warn('[map] room list failed:', err);
        setAllRoomNames([]);
      }
    },
    [storage],
  );
  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const { docs: rooms, loading } = useLoadedDocs(referenced, storage, 'room');

  const layoutNames = useMemo(() => {
    const names = new Set<string>();
    for (const room of rooms.values()) {
      if (isBakedRoom(room)) {
        names.add(room.layoutName);
      }
    }
    return names;
  }, [rooms]);
  const { docs: layouts } = useLoadedDocs(layoutNames, layoutStorage, 'layout');

  return { rooms, layouts, allRoomNames, loading, refreshList };
}

/**
 * Loads each of `names` once. Each pass builds a fresh Map so downstream
 * `useMemo`s see the change; names that fail or come back null are not
 * retried, which would otherwise refetch them forever.
 */
function useLoadedDocs<T>(
  names: ReadonlySet<string>,
  storage: { load(name: string): Promise<T | null> },
  kind: string,
): { docs: ReadonlyMap<string, T>; loading: boolean } {
  const [docs, setDocs] = useState<ReadonlyMap<string, T>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const tried = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const missing = Array.from(names).filter((name) => !tried.current.has(name));
    if (missing.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all(
      missing.map((name) =>
        storage
          .load(name)
          .then((doc) => ({ name, doc }))
          .catch((err) => {
            console.warn(`[map] ${kind} load("${name}") failed:`, err);
            return { name, doc: null };
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      for (const { name } of results) {
        tried.current.add(name);
      }
      setDocs((prev) => {
        const next = new Map(prev);
        for (const { name, doc } of results) {
          if (doc) next.set(name, doc);
        }
        return next;
      });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [names, storage, kind]);

  return { docs, loading };
}
