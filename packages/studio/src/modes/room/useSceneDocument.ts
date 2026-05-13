import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FilesystemSceneStorage,
  LocalStorageSceneStorage,
  compileScene,
  deserializeScene,
  emptyDocument,
  migrateToV2,
  newExtrude,
  newPlaceCube,
  serializeScene,
  type CubeFace,
  type SceneStorage,
  type SceneDocument,
} from '@officexr/world/scenes';
import type { WorldObjects } from '@officexr/sdk';

const LAST_SCENE_KEY = 'officexr:studio:lastSceneV2';
const DEFAULT_SCENE_NAME = 'default-v2';

/**
 * Owns the Scenes editor's working document. Pure local state — no
 * SDK store, no NetEvent broadcast. Persistence runs through
 * `SceneStorage`: filesystem in dev (Vite middleware), localStorage
 * fallback otherwise.
 *
 * Public surface:
 *   - `doc` — current `SceneDocument` (read-only for components).
 *   - `compiled` — derived `WorldObjects` snapshot the canvas renders.
 *   - `placeCube`, `extrudeFromFace`, `setKindForCommand`,
 *     `deleteCommand` — mutators (each recompiles + auto-saves).
 *   - `selection` — selected source command id (the inspector
 *     subscribes; clicking an instance sets it).
 *   - `loadScene(name)` / `newScene(name)` / `listScenes()` —
 *     storage ops for the scene-picker UI.
 */
export function useSceneDocument(): {
  doc: SceneDocument;
  compiled: WorldObjects;
  sceneName: string;
  selection: string | null;
  setSelection: (commandId: string | null) => void;
  placeCube: (kindId: string, position?: [number, number, number]) => string;
  extrudeFromFace: (
    targetCommandId: string,
    face: CubeFace,
    count: number,
  ) => string;
  setKindForCommand: (commandId: string, kindId: string) => void;
  setPositionForCommand: (
    commandId: string,
    position: [number, number, number],
  ) => void;
  setExtrudeFace: (commandId: string, face: CubeFace) => void;
  setExtrudeCount: (commandId: string, count: number) => void;
  deleteCommand: (commandId: string) => void;
  loadScene: (name: string) => Promise<void>;
  newScene: (name: string) => void;
  listScenes: () => Promise<string[]>;
} {
  const storage = useMemo<SceneStorage>(() => {
    try {
      return new FilesystemSceneStorage();
    } catch {
      return new LocalStorageSceneStorage();
    }
  }, []);

  const [sceneName, setSceneName] = useState<string>(() => {
    try {
      return globalThis.localStorage?.getItem(LAST_SCENE_KEY) ?? DEFAULT_SCENE_NAME;
    } catch {
      return DEFAULT_SCENE_NAME;
    }
  });
  const [doc, setDoc] = useState<SceneDocument>(() => emptyDocument(sceneName));
  const [selection, setSelection] = useState<string | null>(null);

  // Re-compile on every doc change. Cheap: pure function, scenes are
  // small (hundreds of cubes at most for v1) and `compileScene` runs
  // in <1 ms for that range.
  const compiled = useMemo(() => compileScene(doc, 2), [doc]);

  // Auto-load on mount + when scene name changes.
  const lastSavedJsonRef = useRef<string>('');
  useEffect(() => {
    let cancelled = false;
    storage
      .load(sceneName)
      .then((raw) => {
        if (cancelled) return;
        if (!raw) {
          // Brand-new scene: start with an empty doc named appropriately.
          setDoc(emptyDocument(sceneName));
          lastSavedJsonRef.current = '';
          return;
        }
        const migrated = migrateToV2(deserializeScene(raw));
        setDoc(migrated);
        lastSavedJsonRef.current = JSON.stringify(migrated.commands);
      })
      .catch((err) => {
        console.warn(`[scenes] load("${sceneName}") failed:`, err);
        setDoc(emptyDocument(sceneName));
      });
    try {
      globalThis.localStorage?.setItem(LAST_SCENE_KEY, sceneName);
    } catch {
      // ignore — localStorage may be blocked.
    }
    return () => {
      cancelled = true;
    };
  }, [storage, sceneName]);

  // Auto-save on doc change (debounced).
  useEffect(() => {
    const json = JSON.stringify(doc.commands);
    if (json === lastSavedJsonRef.current) return;
    const t = setTimeout(() => {
      lastSavedJsonRef.current = json;
      storage
        .save(
          sceneName,
          serializeScene({
            name: sceneName,
            title: doc.title ?? sceneName,
            commands: doc.commands,
          }),
        )
        .catch((err) => {
          console.warn(`[scenes] save("${sceneName}") failed:`, err);
        });
    }, 500);
    return () => clearTimeout(t);
  }, [doc, sceneName, storage]);

  // --- Mutators ----------------------------------------------------

  const placeCube = useCallback(
    (kindId: string, position?: [number, number, number]) => {
      const cmd = newPlaceCube({ kindId, position });
      setDoc((prev) => ({
        ...prev,
        updatedAt: Date.now(),
        commands: [...prev.commands, cmd],
      }));
      setSelection(cmd.id);
      return cmd.id;
    },
    [],
  );

  const extrudeFromFace = useCallback(
    (targetCommandId: string, face: CubeFace, count: number) => {
      const cmd = newExtrude({ targetCommandId, face, count });
      setDoc((prev) => ({
        ...prev,
        updatedAt: Date.now(),
        commands: [...prev.commands, cmd],
      }));
      setSelection(cmd.id);
      return cmd.id;
    },
    [],
  );

  const setKindForCommand = useCallback(
    (commandId: string, kindId: string) => {
      setDoc((prev) => ({
        ...prev,
        updatedAt: Date.now(),
        commands: prev.commands.map((c) =>
          c.id === commandId && c.op === 'placeCube'
            ? { ...c, kindId }
            : c,
        ),
      }));
    },
    [],
  );

  const setPositionForCommand = useCallback(
    (commandId: string, position: [number, number, number]) => {
      setDoc((prev) => ({
        ...prev,
        updatedAt: Date.now(),
        commands: prev.commands.map((c) =>
          c.id === commandId && c.op === 'placeCube'
            ? { ...c, position }
            : c,
        ),
      }));
    },
    [],
  );

  const setExtrudeFace = useCallback(
    (commandId: string, face: CubeFace) => {
      setDoc((prev) => ({
        ...prev,
        updatedAt: Date.now(),
        commands: prev.commands.map((c) =>
          c.id === commandId && c.op === 'extrude'
            ? { ...c, face }
            : c,
        ),
      }));
    },
    [],
  );

  const setExtrudeCount = useCallback(
    (commandId: string, count: number) => {
      setDoc((prev) => ({
        ...prev,
        updatedAt: Date.now(),
        commands: prev.commands.map((c) =>
          c.id === commandId && c.op === 'extrude'
            ? { ...c, count: Math.max(1, Math.floor(count)) }
            : c,
        ),
      }));
    },
    [],
  );

  const deleteCommand = useCallback((commandId: string) => {
    setDoc((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      // Also drop any extrudes targeting the deleted command — they'd
      // become no-ops anyway but leaving them in the history is noise.
      commands: prev.commands.filter(
        (c) =>
          c.id !== commandId &&
          !(c.op === 'extrude' && c.targetCommandId === commandId),
      ),
    }));
    setSelection((curr) => (curr === commandId ? null : curr));
  }, []);

  const loadScene = useCallback(
    async (name: string) => {
      setSceneName(name);
    },
    [],
  );

  const newScene = useCallback((name: string) => {
    setDoc(emptyDocument(name));
    setSelection(null);
    setSceneName(name);
  }, []);

  const listScenes = useCallback(async () => {
    const summaries = await storage.list();
    return summaries.map((s) => s.name);
  }, [storage]);

  return {
    doc,
    compiled,
    sceneName,
    selection,
    setSelection,
    placeCube,
    extrudeFromFace,
    setKindForCommand,
    setPositionForCommand,
    setExtrudeFace,
    setExtrudeCount,
    deleteCommand,
    loadScene,
    newScene,
    listScenes,
  };
}
