import { useEffect, useMemo, useState } from 'react';
import {
  FilesystemRoomStorage,
  LocalStorageRoomStorage,
  type RoomDocument,
  type RoomStorage,
} from '@officexr/world/scenes';

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
  allRoomNames: readonly string[];
  loading: boolean;
  /** Refresh the room-name listing (used by RoomPalette's reload). */
  refreshList: () => Promise<void>;
}

export function useMapRoomLibrary(
  referenced: ReadonlySet<string>,
): UseMapRoomLibraryResult {
  const storage = useMemo<RoomStorage>(() => {
    try {
      return new FilesystemRoomStorage();
    } catch {
      return new LocalStorageRoomStorage();
    }
  }, []);

  const [rooms, setRooms] = useState<ReadonlyMap<string, RoomDocument>>(
    () => new Map(),
  );
  const [allRoomNames, setAllRoomNames] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);

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

  // Fetch each referenced room that we don't already have. Pulling
  // them into a fresh Map each pass keeps the consumer's reference
  // equality crisp — a single mutated Map would make `useMemo`s
  // downstream miss changes.
  useEffect(() => {
    let cancelled = false;
    const missing = Array.from(referenced).filter((name) => !rooms.has(name));
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
            console.warn(`[map] room load("${name}") failed:`, err);
            return { name, doc: null };
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      setRooms((prev) => {
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
  }, [referenced, rooms, storage]);

  return { rooms, allRoomNames, loading, refreshList };
}
