/**
 * `useLayoutDocument` — owns the Layout editor's working document.
 *
 * Mirrors the structure of `useRoomDocument` for LayoutDocument.  Key
 * differences from the Room hook:
 *   - No `groups` (v1 layouts are flat command lists).
 *   - No `RoomHistory` — uses a simpler undo stack (array of LayoutDocument
 *     snapshots) since layouts are generally small.
 *   - After every autosave, calls `BakeRegistry.scheduleBake` so the GLB
 *     is always within 1.5s of the latest doc.
 *
 * SOLID note: intentionally a near-copy of useRoomDocument for the command
 * operations.  The duplication is deliberate (SRP — one hook per doc type).
 * If the two converge on a common interface, extract a shared helper at that
 * point.  Do NOT pre-emptively abstract.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FilesystemLayoutStorage,
  LocalStorageLayoutStorage,
  type LayoutDocument,
  type LayoutStorage,
  emptyLayoutDocument,
  serializeLayout,
  type PlaceObjectCommand,
  newPlaceObject,
} from '@officexr/world/scenes';
import type { WorldObjects } from '@officexr/sdk';
import { compileScene } from '@officexr/world/scenes';
import { useApplication } from '@officexr/world/react';
import { scheduleBake } from '@officexr/world/app';
import { createBrowserBakeDeps } from '@officexr/world/app';

const LAST_LAYOUT_KEY = 'officexr:studio:lastLayout';
const DEFAULT_LAYOUT_NAME = 'default';

// ---------------------------------------------------------------------------
// Simple undo stack (array of LayoutDocument snapshots)
// ---------------------------------------------------------------------------

interface UndoHistory {
  past: LayoutDocument[];
  present: LayoutDocument;
  future: LayoutDocument[];
}

function historyPush(h: UndoHistory, next: LayoutDocument): UndoHistory {
  return { past: [...h.past, h.present], present: next, future: [] };
}

function historyUndo(h: UndoHistory): UndoHistory {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

function historyRedo(h: UndoHistory): UndoHistory {
  if (h.future.length === 0) return h;
  const next = h.future[0];
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLayoutDocument(): {
  doc: LayoutDocument;
  compiled: WorldObjects;
  layoutName: string;
  selection: ReadonlySet<string>;
  setSelection: (ids: Iterable<string> | null) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  placeObject: (kindId: string, position?: [number, number, number]) => string;
  setPositionForCommand: (commandId: string, position: [number, number, number]) => void;
  deleteCommand: (commandId: string) => void;
  deleteSelection: () => void;
  setOptimizer: (id: string | undefined) => void;
  loadLayout: (name: string) => Promise<void>;
  newLayout: (name: string) => void;
  listLayouts: () => Promise<string[]>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
} {
  const storage = useMemo<LayoutStorage>(() => {
    try {
      return new FilesystemLayoutStorage();
    } catch {
      return new LocalStorageLayoutStorage();
    }
  }, []);

  const [layoutName, setLayoutName] = useState<string>(() => {
    try {
      return globalThis.localStorage?.getItem(LAST_LAYOUT_KEY) ?? DEFAULT_LAYOUT_NAME;
    } catch {
      return DEFAULT_LAYOUT_NAME;
    }
  });

  const [history, setHistory] = useState<UndoHistory>(() => ({
    past: [],
    present: emptyLayoutDocument(layoutName),
    future: [],
  }));

  const doc = history.present;

  const [selection, setSelectionState] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Re-compile on every doc change.
  const { geometry } = useApplication();
  const compiled = useMemo<WorldObjects>(() => {
    const voxelSize = geometry.voxelSize ?? 1;
    // compileScene accepts { commands } so LayoutDocument qualifies.
    // Layouts use placeObject commands only (no extrude), so kindStride
    // is not needed here — omit it (optional param).
    return compileScene(doc, voxelSize) as WorldObjects;
  }, [doc, geometry]);

  // Auto-load on mount + when layout name changes.
  const lastSavedJsonRef = useRef<string>('');
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadedForRef.current = null;
    storage
      .load(layoutName)
      .then((loaded) => {
        if (cancelled) return;
        const base = loaded ?? emptyLayoutDocument(layoutName);
        setHistory({ past: [], present: base, future: [] });
        lastSavedJsonRef.current = JSON.stringify({ commands: base.commands, optimizer: base.optimizer });
        loadedForRef.current = layoutName;
      })
      .catch((err) => {
        console.warn(`[layout] load("${layoutName}") failed:`, err);
        const base = emptyLayoutDocument(layoutName);
        setHistory({ past: [], present: base, future: [] });
        lastSavedJsonRef.current = JSON.stringify({ commands: base.commands, optimizer: base.optimizer });
        loadedForRef.current = layoutName;
      });
    try {
      globalThis.localStorage?.setItem(LAST_LAYOUT_KEY, layoutName);
    } catch {
      // ignore
    }
    return () => {
      cancelled = true;
    };
  }, [storage, layoutName]);

  // Catalog (geometry was already obtained above for compileScene's
  // voxelSize). Shared with the bake deps so the bake's voxel→world
  // transforms match the runtime renderer exactly.
  const { catalog } = useApplication();

  // Auto-save + trigger bake on doc change (debounced 500ms). Same
  // load-completion gate pattern as useRoomDocument.
  useEffect(() => {
    if (loadedForRef.current !== layoutName) return;
    const json = JSON.stringify({ commands: doc.commands, optimizer: doc.optimizer });
    if (json === lastSavedJsonRef.current) return;
    const t = setTimeout(() => {
      lastSavedJsonRef.current = json;
      const serialized = serializeLayout({
        name: layoutName,
        title: doc.title ?? layoutName,
        commands: doc.commands,
        optimizer: doc.optimizer,
      });
      storage.save(layoutName, serialized).catch((err) => {
        console.warn(`[layout] save("${layoutName}") failed:`, err);
      });
      // Trigger a debounced bake after the save.
      const deps = createBrowserBakeDeps(catalog, geometry);
      scheduleBake(layoutName, doc, deps);
    }, 500);
    return () => clearTimeout(t);
  }, [doc, layoutName, storage, catalog, geometry]);

  // --- Selection ---

  const setSelection = useCallback((ids: Iterable<string> | null) => {
    setSelectionState(new Set(ids ?? []));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionState(new Set());
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectionState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // --- Mutators ---

  const placeObject = useCallback(
    (kindId: string, position?: [number, number, number]) => {
      const cmd = newPlaceObject({ kindId, position });
      const next: LayoutDocument = {
        ...doc,
        updatedAt: Date.now(),
        commands: [...doc.commands, cmd],
      };
      setHistory((h) => historyPush(h, next));
      setSelectionState(new Set([cmd.id]));
      return cmd.id;
    },
    [doc],
  );

  const setPositionForCommand = useCallback(
    (commandId: string, position: [number, number, number]) => {
      const next: LayoutDocument = {
        ...doc,
        updatedAt: Date.now(),
        commands: doc.commands.map((c) =>
          c.id === commandId && c.op === 'placeObject'
            ? { ...c, position }
            : c,
        ),
      };
      setHistory((h) => historyPush(h, next));
    },
    [doc],
  );

  const deleteCommandsInternal = useCallback(
    (toDelete: ReadonlySet<string>) => {
      if (toDelete.size === 0) return;
      const next: LayoutDocument = {
        ...doc,
        updatedAt: Date.now(),
        commands: doc.commands.filter((c) => !toDelete.has(c.id)),
      };
      setHistory((h) => historyPush(h, next));
      setSelectionState((prev) => {
        const next2 = new Set(prev);
        for (const id of toDelete) next2.delete(id);
        return next2;
      });
    },
    [doc],
  );

  const deleteCommand = useCallback(
    (commandId: string) => deleteCommandsInternal(new Set([commandId])),
    [deleteCommandsInternal],
  );

  const deleteSelection = useCallback(() => {
    deleteCommandsInternal(selection);
  }, [deleteCommandsInternal, selection]);

  // Optimizer choice is doc metadata, not a reversible command edit —
  // skip the undo history so flipping strategies doesn't pollute it.
  const setOptimizer = useCallback(
    (id: string | undefined) => {
      const next: LayoutDocument = {
        ...doc,
        updatedAt: Date.now(),
        optimizer: id,
      };
      setHistory((h) => ({ ...h, present: next }));
    },
    [doc],
  );

  // --- Load / New / List ---

  const loadLayout = useCallback(
    async (name: string) => {
      setLayoutName(name);
    },
    [],
  );

  const newLayout = useCallback((name: string) => {
    setLayoutName(name);
  }, []);

  const listLayouts = useCallback(async (): Promise<string[]> => {
    const summaries = await storage.list();
    return summaries.map((s) => s.name);
  }, [storage]);

  // --- Undo / Redo ---

  const undo = useCallback(() => {
    setHistory((h) => historyUndo(h));
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => historyRedo(h));
  }, []);

  return {
    doc,
    compiled,
    layoutName,
    selection,
    setSelection,
    toggleSelection,
    clearSelection,
    placeObject,
    setPositionForCommand,
    deleteCommand,
    deleteSelection,
    setOptimizer,
    loadLayout,
    newLayout,
    listLayouts,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
