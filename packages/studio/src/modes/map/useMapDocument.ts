import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FilesystemMapStorage,
  LocalStorageMapStorage,
  emptyMapDocument,
  type MapDocumentV1,
  type MapStorage,
  type RoomInstance,
  type SpawnPoint,
} from '@officexr/world/scenes';

const LAST_MAP_KEY = 'officexr:studio:lastMap';
const DEFAULT_MAP_NAME = 'default';

let nextInstanceSeq = 1;
function mintInstanceId(prefix: string): string {
  return `${prefix}-${(nextInstanceSeq++).toString(36)}-${Date.now()
    .toString(36)
    .slice(-4)}`;
}

/**
 * Editor selection shape. The Map editor can have ONE of these
 * selected at a time:
 *   - `{ kind: 'room', id }` — a `RoomInstance` (drag/rotate/delete).
 *   - `{ kind: 'spawn', id }` — a `SpawnPoint` (rename/delete).
 *   - `null` — nothing selected.
 *
 * Same shape promoted to a single field keeps the click-to-select
 * code path uniform across the two entity kinds; this mirrors the
 * Room editor's `selection: Set<string>` but here we only ever have
 * at most one selected entity, so a discriminated union is simpler
 * than a tagged set.
 */
export type MapSelection =
  | { kind: 'room'; id: string }
  | { kind: 'spawn'; id: string }
  | null;

/**
 * Owns the Map editor's working document. Same shape as
 * `useRoomDocument`: load on mount + on name change, debounced
 * auto-save (500 ms), in-memory mutators. Falls back to localStorage
 * when the Vite middleware isn't available (e.g. unit tests).
 *
 * Brand-new maps get a blank `emptyMapDocument(name)` until the user
 * adds something; the auto-save then writes the empty doc out so the
 * map shows up in subsequent `/api/maps` listings.
 */
export interface UseMapDocumentResult {
  doc: MapDocumentV1;
  mapName: string;
  selection: MapSelection;
  setSelection: (s: MapSelection) => void;
  /** Mutators that hit the in-memory doc and rely on auto-save to
   *  persist. All of them stamp `updatedAt` so the dev-server's last-
   *  modified field stays current. */
  addRoom: (roomName: string, position?: [number, number, number]) => string;
  removeRoom: (id: string) => void;
  setRoomPosition: (id: string, position: [number, number, number]) => void;
  setRoomRotation: (id: string, rotationY: 0 | 1 | 2 | 3) => void;
  addSpawn: (position: [number, number, number], label?: string) => string;
  removeSpawn: (id: string) => void;
  setSpawnLabel: (id: string, label: string) => void;
  setSpawnPosition: (id: string, position: [number, number, number]) => void;
  setEnvironment: (
    update: (env: MapDocumentV1['environment']) => MapDocumentV1['environment'],
  ) => void;
  loadMap: (name: string) => Promise<void>;
  newMap: (name: string) => void;
  listMaps: () => Promise<string[]>;
}

export function useMapDocument(): UseMapDocumentResult {
  const storage = useMemo<MapStorage>(() => {
    try {
      return new FilesystemMapStorage();
    } catch {
      return new LocalStorageMapStorage();
    }
  }, []);

  const [mapName, setMapName] = useState<string>(() => {
    try {
      return globalThis.localStorage?.getItem(LAST_MAP_KEY) ?? DEFAULT_MAP_NAME;
    } catch {
      return DEFAULT_MAP_NAME;
    }
  });
  const [doc, setDoc] = useState<MapDocumentV1>(() => emptyMapDocument(mapName));
  const [selection, setSelection] = useState<MapSelection>(null);

  // Same load+save pattern as useRoomDocument — track the last-saved
  // JSON so we don't write the same content twice (avoids the dev
  // server's mtime churn). The `loadedFor` ref gates the auto-save
  // so the initial empty doc isn't flushed to disk before
  // `storage.load(...)` returns the canonical content — that race
  // would clobber the seed file with an empty doc.
  const lastSavedJsonRef = useRef<string>('');
  const loadedForRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadedForRef.current = null;
    storage
      .load(mapName)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          const blank = emptyMapDocument(mapName);
          setDoc(blank);
          lastSavedJsonRef.current = JSON.stringify(blank);
          loadedForRef.current = mapName;
          return;
        }
        setDoc(loaded);
        lastSavedJsonRef.current = JSON.stringify(loaded);
        loadedForRef.current = mapName;
      })
      .catch((err) => {
        console.warn(`[map] load("${mapName}") failed:`, err);
        const blank = emptyMapDocument(mapName);
        setDoc(blank);
        lastSavedJsonRef.current = JSON.stringify(blank);
        loadedForRef.current = mapName;
      });
    try {
      globalThis.localStorage?.setItem(LAST_MAP_KEY, mapName);
    } catch {
      // localStorage may be blocked.
    }
    return () => {
      cancelled = true;
    };
  }, [storage, mapName]);

  useEffect(() => {
    if (loadedForRef.current !== mapName) return;
    const json = JSON.stringify(doc);
    if (json === lastSavedJsonRef.current) return;
    const t = setTimeout(() => {
      lastSavedJsonRef.current = json;
      storage.save(mapName, doc).catch((err) => {
        console.warn(`[map] save("${mapName}") failed:`, err);
      });
    }, 500);
    return () => clearTimeout(t);
  }, [doc, mapName, storage]);

  const stampUpdated = useCallback(
    (mut: (prev: MapDocumentV1) => MapDocumentV1) =>
      setDoc((prev) => ({ ...mut(prev), updatedAt: Date.now() })),
    [],
  );

  const addRoom = useCallback(
    (roomName: string, position: [number, number, number] = [0, 0, 0]) => {
      const id = mintInstanceId('room');
      const inst: RoomInstance = { id, roomName, position, rotationY: 0 };
      stampUpdated((prev) => ({ ...prev, rooms: [...prev.rooms, inst] }));
      setSelection({ kind: 'room', id });
      return id;
    },
    [stampUpdated],
  );

  const removeRoom = useCallback(
    (id: string) => {
      stampUpdated((prev) => ({
        ...prev,
        rooms: prev.rooms.filter((r) => r.id !== id),
      }));
      setSelection((prev) =>
        prev && prev.kind === 'room' && prev.id === id ? null : prev,
      );
    },
    [stampUpdated],
  );

  const setRoomPosition = useCallback(
    (id: string, position: [number, number, number]) => {
      stampUpdated((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) => (r.id === id ? { ...r, position } : r)),
      }));
    },
    [stampUpdated],
  );

  const setRoomRotation = useCallback(
    (id: string, rotationY: 0 | 1 | 2 | 3) => {
      stampUpdated((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) =>
          r.id === id ? { ...r, rotationY } : r,
        ),
      }));
    },
    [stampUpdated],
  );

  const addSpawn = useCallback(
    (position: [number, number, number], label?: string) => {
      const id = mintInstanceId('spawn');
      const sp: SpawnPoint = { id, label, position };
      stampUpdated((prev) => ({ ...prev, spawnPoints: [...prev.spawnPoints, sp] }));
      setSelection({ kind: 'spawn', id });
      return id;
    },
    [stampUpdated],
  );

  const removeSpawn = useCallback(
    (id: string) => {
      stampUpdated((prev) => ({
        ...prev,
        spawnPoints: prev.spawnPoints.filter((s) => s.id !== id),
      }));
      setSelection((prev) =>
        prev && prev.kind === 'spawn' && prev.id === id ? null : prev,
      );
    },
    [stampUpdated],
  );

  const setSpawnLabel = useCallback(
    (id: string, label: string) => {
      stampUpdated((prev) => ({
        ...prev,
        spawnPoints: prev.spawnPoints.map((s) =>
          s.id === id ? { ...s, label } : s,
        ),
      }));
    },
    [stampUpdated],
  );

  const setSpawnPosition = useCallback(
    (id: string, position: [number, number, number]) => {
      stampUpdated((prev) => ({
        ...prev,
        spawnPoints: prev.spawnPoints.map((s) =>
          s.id === id ? { ...s, position } : s,
        ),
      }));
    },
    [stampUpdated],
  );

  const setEnvironment = useCallback(
    (update: (env: MapDocumentV1['environment']) => MapDocumentV1['environment']) => {
      stampUpdated((prev) => ({ ...prev, environment: update(prev.environment) }));
    },
    [stampUpdated],
  );

  const loadMap = useCallback(async (name: string) => {
    setMapName(name);
  }, []);

  const newMap = useCallback((name: string) => {
    setMapName(name);
    setDoc(emptyMapDocument(name));
    setSelection(null);
  }, []);

  const listMaps = useCallback(async () => {
    try {
      const summaries = await storage.list();
      return summaries.map((s) => s.name);
    } catch (err) {
      console.warn('[map] list failed:', err);
      return [];
    }
  }, [storage]);

  return {
    doc,
    mapName,
    selection,
    setSelection,
    addRoom,
    removeRoom,
    setRoomPosition,
    setRoomRotation,
    addSpawn,
    removeSpawn,
    setSpawnLabel,
    setSpawnPosition,
    setEnvironment,
    loadMap,
    newMap,
    listMaps,
  };
}
