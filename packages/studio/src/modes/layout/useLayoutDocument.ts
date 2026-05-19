/**
 * `useLayoutDocument` — owns the Layout editor's working document.
 *
 * "Almost identical to the Room editor except things are optimized when
 * saved." This hook is a thin wrapper around `useRoomDocument`:
 *
 *   - A `RoomStorage` adapter wraps `LayoutStorage` and converts
 *     `LayoutDocument` JSON ↔ `RoomDocument` runtime shape at the IO
 *     boundary. The in-memory representation IS a `RoomDocument`, so
 *     every Room editor primitive (RoomHistory, applyAction, group-aware
 *     selection, the tile-tool placeMany/groupCommands sequence, undo/
 *     redo, history time-travel, …) works without modification.
 *   - `afterSave` schedules a debounced GLB bake after each save.
 *   - The Layout-specific `optimizer` field is held as separate React
 *     state alongside the room hook and serialized into the on-disk
 *     LayoutDocument JSON via the storage adapter.
 *
 * SRP: this file's only job is to translate between layout-on-disk
 * format and the room hook's in-memory format, and to wire the bake.
 * It owns no editing logic.
 *
 * DIP: the bug that motivated this rewrite was a divergent
 * implementation of the mutator + history pattern in the old
 * `useLayoutDocument` — `placeMany` + `groupCommands` called
 * synchronously from the tile tool's click handler each read a stale
 * closure of `doc` and clobbered each other. By reusing the room
 * hook's `RoomHistory` ref pattern, sequential mutators see each
 * other's changes synchronously.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FilesystemLayoutStorage,
  LocalStorageLayoutStorage,
  type LayoutDocument,
  type LayoutStorage,
  type RoomDocument,
  type RoomStorage,
  type RoomSummary,
} from '@officexr/world/scenes';
import { useApplication } from '@officexr/world/react';
import { scheduleBake, createBrowserBakeDeps } from '@officexr/world/app';
import { useRoomDocument } from '../room/useRoomDocument.ts';

const LAST_LAYOUT_KEY = 'officexr:studio:lastLayout';
const DEFAULT_LAYOUT_NAME = 'default';

// ---------------------------------------------------------------------------
// Document-shape translation
// ---------------------------------------------------------------------------

/**
 * Translate a loaded `LayoutDocument` into the `RoomDocument` shape the
 * room hook operates on. Layouts have no nested `layoutName` link;
 * `groups` defaults to `{}` when absent (older on-disk layouts).
 *
 * `schemaVersion: 5` is synthetic — RoomDocument requires it, but the
 * value is meaningless inside the layout editor (we never persist this
 * shape; the storage adapter's `save` converts back to schemaVersion 1).
 */
function layoutToRoom(layoutDoc: LayoutDocument): RoomDocument {
  return {
    schemaVersion: 5,
    name: layoutDoc.name,
    title: layoutDoc.title,
    updatedAt: layoutDoc.updatedAt,
    commands: layoutDoc.commands,
    groups: layoutDoc.groups ?? {},
    layoutName: undefined,
  };
}

/**
 * Translate a `RoomDocument` back into a `LayoutDocument` for
 * persistence. `optimizer` is layout-specific metadata held outside
 * the room hook; pass it through here.
 */
function roomToLayout(
  roomDoc: RoomDocument,
  name: string,
  optimizer: string | undefined,
): LayoutDocument {
  return {
    schemaVersion: 1,
    name,
    title: roomDoc.title,
    updatedAt: Date.now(),
    commands: roomDoc.commands,
    groups: roomDoc.groups,
    optimizer,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Return shape: every field from `useRoomDocument` is exposed verbatim
 * via spread. Layout-specific additions are added on top:
 *   - `layoutName` / `loadLayout` / `newLayout` / `listLayouts` are
 *     aliases for the room hook's `roomName` / `loadRoom` / … so
 *     existing Layout call-sites don't churn.
 *   - `optimizer` / `setOptimizer` expose the bake-strategy choice.
 */
export function useLayoutDocument() {
  const { catalog, geometry } = useApplication();

  // --- Optimizer (layout-only metadata, held outside the history) ---

  const [optimizer, setOptimizerState] = useState<string | undefined>(
    undefined,
  );
  // Mirror into a ref so the storage adapter's `save` (which is
  // memoized) can read the latest optimizer without re-creating the
  // adapter on every optimizer change.
  const optimizerRef = useRef(optimizer);
  useEffect(() => {
    optimizerRef.current = optimizer;
  }, [optimizer]);

  // --- Storage adapter: LayoutStorage → RoomStorage ---

  const layoutStorage = useMemo<LayoutStorage>(() => {
    try {
      return new FilesystemLayoutStorage();
    } catch {
      return new LocalStorageLayoutStorage();
    }
  }, []);

  const adapter = useMemo<RoomStorage>(
    () => ({
      list: async (): Promise<RoomSummary[]> => {
        const summaries = await layoutStorage.list();
        // LayoutSummary and RoomSummary are structurally compatible
        // (both `{ name, title?, updatedAt? }`); cast through unknown
        // to keep TS happy without inventing a separate adapter.
        return summaries as unknown as RoomSummary[];
      },
      load: async (name) => {
        const layoutDoc = await layoutStorage.load(name);
        if (!layoutDoc) return null;
        // Lift the persisted optimizer into hook state so the picker
        // reflects the on-disk choice immediately after load.
        setOptimizerState(layoutDoc.optimizer);
        return layoutToRoom(layoutDoc);
      },
      save: async (name, roomDoc) => {
        const layoutDoc = roomToLayout(roomDoc, name, optimizerRef.current);
        await layoutStorage.save(name, layoutDoc);
      },
      delete: (name) => layoutStorage.delete(name),
    }),
    [layoutStorage],
  );

  // --- After-save side effect: schedule a bake of the just-saved doc ---

  const afterSave = useCallback(
    (name: string, roomDoc: RoomDocument) => {
      const layoutDoc = roomToLayout(roomDoc, name, optimizerRef.current);
      const deps = createBrowserBakeDeps(catalog, geometry);
      scheduleBake(name, layoutDoc, deps);
    },
    [catalog, geometry],
  );

  // --- Delegate to the room hook ---

  const room = useRoomDocument({
    storage: adapter,
    defaultName: DEFAULT_LAYOUT_NAME,
    lastNameKey: LAST_LAYOUT_KEY,
    enableLayoutLinkPrefetch: false,
    afterSave,
  });

  // Optimizer mutator — local state only, doesn't go through the
  // command history. Flipping the optimizer doesn't change the scene;
  // it only affects the next bake. Putting it in history would clutter
  // the undo stack with non-scene edits.
  const setOptimizer = useCallback(
    (id: string | undefined) => {
      setOptimizerState(id);
      // Trigger a save: bump updatedAt on the room hook's doc so the
      // autosave effect fires. The optimizer ride-along is folded in
      // by the storage adapter.
      room.setLayoutName(room.doc.layoutName);
    },
    [room],
  );

  return {
    ...room,
    // Layout-friendly aliases — existing call-sites use these names.
    layoutName: room.roomName,
    loadLayout: room.loadRoom,
    newLayout: room.newRoom,
    listLayouts: room.listRooms,
    optimizer,
    setOptimizer,
    canUndo: room.historyNodes.length > 0 && room.historyCurrentNodeId !== null,
    canRedo:
      room.historyCurrentNodeId !== null &&
      room.historyNodes.findIndex((n) => n.id === room.historyCurrentNodeId) <
        room.historyNodes.length - 1,
  };
}
