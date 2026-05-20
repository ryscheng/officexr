import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FilesystemRoomStorage,
  LocalStorageRoomStorage,
  emptyRoomDocument,
  newPlaceObject,
  serializeRoom,
  type PlaceObjectCommand,
  type RoomDocument,
  type CommandGroup,
  type RoomStorage,
} from '@officexr/world/scenes';
import type { WorldObjects } from '@officexr/sdk';
import { useApplication } from '@officexr/world/react';
import {
  selectionFromClick,
  selectionFromToggle,
  type GroupLookup,
} from './room-selection.ts';
import { RoomHistory } from './RoomHistory.ts';
import type { EditAction } from './EditAction.ts';
import { useTestStorages } from '../../test-harness/TestStorageContext.tsx';

const LAST_ROOM_KEY = 'officexr:studio:lastRoom';
const DEFAULT_ROOM_NAME = 'default-v2';

/**
 * Optional configuration for `useRoomDocument`. The defaults match the
 * Room editor's historical behavior, so existing callers don't need
 * to pass anything.
 *
 * The Layout editor passes a different `storage` (a LayoutStorage
 * adapter that translates LayoutDocument JSON ↔ RoomDocument shape),
 * a different `lastNameKey`, and an `afterSave` callback that schedules
 * a GLB bake. Everything else — mutators, history, selection, group
 * cascade — is reused as-is. That's the point: Layout is "almost
 * identical to Room except things are optimized when saved."
 */
export interface UseRoomDocumentOptions {
  /** RoomStorage to load/save documents through. Defaults to the
   *  Filesystem adapter with a LocalStorage fallback. */
  storage?: RoomStorage;
  /** Document name used when nothing is in localStorage. */
  defaultName?: string;
  /** localStorage key remembering the last-opened document name. */
  lastNameKey?: string;
  /**
   * Called after each successful save. Receives the same RoomDocument
   * that was persisted. The Layout editor uses this hook to schedule
   * a bake — equivalent to the room editor having no post-save side
   * effect.
   */
  afterSave?: (name: string, doc: RoomDocument) => void;
  /**
   * Reserved. Earlier versions used this to gate a bake-prefetch from
   * inside the Room editor — that flow was removed (the Layout editor
   * is the single owner of bake triggering). Kept as an accepted
   * optional field so existing callers (Layout hook) don't break.
   */
  enableLayoutLinkPrefetch?: boolean;
}

let nextGroupSeq = 1;
function mintGroupId(): string {
  return `g-${(nextGroupSeq++).toString(36)}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * Derived indexes the Room editor's click + delete logic relies on:
 *
 *   - `instancesByCommand` maps a `sourceCommandId` to the compiled
 *     instances it produced. Used by the Delete tool to highlight
 *     every instance of a hovered group, and by the Select tool to
 *     map a raycast hit back to its command.
 *   - `commandToGroup` maps a `commandId` → its enclosing group's id
 *     (or `null`). Drives "click a group member → select whole group".
 *   - `groupMembers` maps a `groupId` → its membership list (a copy
 *     of `CommandGroup.commandIds` so callers can't mutate the doc).
 */
export interface RoomDocLookup {
  instancesByCommand: ReadonlyMap<
    string,
    readonly { id: string; position: readonly [number, number, number] }[]
  >;
  commandToGroup: ReadonlyMap<string, string>;
  groupMembers: ReadonlyMap<string, readonly string[]>;
  groupOf(commandId: string): string | null;
}

/**
 * Owns the Room editor's working document. Pure local state — no
 * SDK store, no NetEvent broadcast. Persistence runs through
 * `RoomStorage`: filesystem in dev (Vite middleware at `/api/rooms`),
 * localStorage fallback otherwise.
 *
 * History is managed by a `RoomHistory` instance held in a `useRef`.
 * Every mutator constructs an `EditAction`, pushes it to the history,
 * then calls `setDoc(history.currentDoc)`. This enables undo, redo,
 * and time-travel via `jumpTo`.
 *
 * Promoted from `useSceneDocument` in Task 6 of the studio
 * multi-editor restructure:
 *   - `selection` is now `ReadonlySet<string>` (multi-select via
 *     Ctrl/Cmd+click). Clicking a group member selects the whole
 *     group atomically — see `pickFromClick` / `toggleFromClick`.
 *   - The document carries `groups: Record<string, CommandGroup>` so a
 *     tile-tool result (Task 9) or a manual Group action persists
 *     across save/load.
 */
export function useRoomDocument(options?: UseRoomDocumentOptions): {
  doc: RoomDocument;
  compiled: WorldObjects;
  roomName: string;
  selection: ReadonlySet<string>;
  setSelection: (ids: Iterable<string> | null) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  pickFromClick: (commandId: string) => void;
  toggleFromClick: (commandId: string) => void;
  lookup: RoomDocLookup;
  placeObject: (kindId: string, position?: [number, number, number]) => string;
  placeMany: (
    kindId: string,
    positions: ReadonlyArray<[number, number, number]>,
    groupId?: string | null,
  ) => string[];
  setKindForCommand: (commandId: string, kindId: string) => void;
  setPositionForCommand: (
    commandId: string,
    position: [number, number, number],
  ) => void;
  setPositionMany: (
    moves: Array<{ commandId: string; position: [number, number, number] }>,
  ) => void;
  deleteCommand: (commandId: string) => void;
  deleteSelection: () => void;
  groupCommands: (commandIds: Iterable<string>, label?: string) => string | null;
  ungroupCommands: (groupId: string) => void;
  addToGroup: (groupId: string, commandIds: Iterable<string>) => void;
  /** Set the room's linked layout name. Empty string or undefined unlinks it. */
  setLayoutName: (name: string | undefined) => void;
  loadRoom: (name: string) => Promise<void>;
  newRoom: (name: string) => void;
  listRooms: () => Promise<string[]>;
  undo: () => void;
  redo: () => void;
  jumpTo: (nodeId: string) => void;
  historyNodes: ReadonlyArray<{ id: string; action: EditAction; label: string }>;
  historyCurrentNodeId: string | null;
} {
  const defaultName = options?.defaultName ?? DEFAULT_ROOM_NAME;
  const lastNameKey = options?.lastNameKey ?? LAST_ROOM_KEY;
  const afterSave = options?.afterSave;
  // `enableLayoutLinkPrefetch` is intentionally unread — reserved for
  // future use; see the option's docstring.
  void options?.enableLayoutLinkPrefetch;

  // Fall back to the default Filesystem/LocalStorage stack when the
  // caller doesn't supply a storage. Layout passes its own adapter
  // (which wraps LayoutStorage + translates document shapes).
  const fallbackStorage = useMemo<RoomStorage>(() => {
    try {
      return new FilesystemRoomStorage();
    } catch {
      return new LocalStorageRoomStorage();
    }
  }, []);
  // Resolution order: explicit option → hermetic test storage (?test=1)
  // → the default Filesystem stack. The Layout hook passes its own
  // adapter as `options.storage`, so it bypasses the test context.
  const testStorages = useTestStorages();
  const storage = options?.storage ?? testStorages?.roomStorage ?? fallbackStorage;

  const [roomName, setRoomName] = useState<string>(() => {
    try {
      return globalThis.localStorage?.getItem(lastNameKey) ?? defaultName;
    } catch {
      return defaultName;
    }
  });
  const [doc, setDoc] = useState<RoomDocument>(() =>
    emptyRoomDocument(roomName),
  );
  // Stable ref of the latest committed doc — `afterSave` (and any
  // other side-effect hook that fires on saves) reads through it so
  // we don't rebuild the autosave effect every time the doc changes.
  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const [selection, setSelectionState] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // RoomHistory is held in a ref — its identity is stable across renders,
  // which is required because RoomHistory carries mutable linked-list state.
  // Storing it as state would cause double-initialization issues and incorrect
  // behavior under React StrictMode.
  const historyRef = useRef<RoomHistory | null>(null);

  function getHistory(baseDoc: RoomDocument): RoomHistory {
    if (!historyRef.current) {
      historyRef.current = new RoomHistory(baseDoc);
    }
    return historyRef.current;
  }

  // Re-compile on every doc change. The room service supplies the
  // canonical extrude stride from the application layer's geometry
  // service — same source of truth the renderer, colliders, and
  // outline already use.
  const { rooms: roomService, catalog, geometry } = useApplication();
  const compiled = useMemo(
    () => roomService.compileScene(doc),
    [doc, roomService],
  );

  // Derived selection / delete lookups. Recomputed whenever the doc
  // or compiled snapshot changes (Maps fully replaced — components
  // can use reference equality to decide whether to re-render).
  const lookup = useMemo<RoomDocLookup>(() => {
    const instancesByCommand = new Map<
      string,
      Array<{ id: string; position: readonly [number, number, number] }>
    >();
    for (const inst of compiled.instances) {
      let arr = instancesByCommand.get(inst.sourceCommandId);
      if (!arr) {
        arr = [];
        instancesByCommand.set(inst.sourceCommandId, arr);
      }
      arr.push({ id: inst.id, position: inst.position });
    }
    const commandToGroup = new Map<string, string>();
    const groupMembers = new Map<string, readonly string[]>();
    for (const g of Object.values(doc.groups)) {
      groupMembers.set(g.id, g.commandIds);
      for (const cid of g.commandIds) commandToGroup.set(cid, g.id);
    }
    return {
      instancesByCommand,
      commandToGroup,
      groupMembers,
      groupOf: (id) => commandToGroup.get(id) ?? null,
    };
  }, [doc.groups, compiled]);

  // Auto-load on mount + when room name changes.
  const lastSavedJsonRef = useRef<string>('');
  // Load-completion gate. The auto-save effect below is gated on
  // `loadedForRef.current === roomName` so the initial empty doc
  // (created during render before `storage.load` resolves) is
  // NEVER saved over the real file on disk. Without this gate, the
  // 500ms save timer fires while load is in flight and writes the
  // empty placeholder, then the load resolves and tries to set the
  // doc back — but if the user navigates away mid-flight, or the
  // save is faster than the load, the on-disk file ends up empty.
  // (That race was clobbering hand-authored rooms during e2e runs
  // and casual editor sessions.)
  const loadedForRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadedForRef.current = null;
    storage
      .load(roomName)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          // Brand-new room: start with an empty doc named appropriately.
          const blank = emptyRoomDocument(roomName);
          setDoc(blank);
          historyRef.current = new RoomHistory(blank);
          lastSavedJsonRef.current = JSON.stringify({
            commands: blank.commands,
            groups: blank.groups,
            layoutName: blank.layoutName,
          });
          loadedForRef.current = roomName;
          return;
        }
        setDoc(loaded);
        historyRef.current = new RoomHistory(loaded);
        lastSavedJsonRef.current = JSON.stringify({
          commands: loaded.commands,
          groups: loaded.groups,
          layoutName: loaded.layoutName,
        });
        loadedForRef.current = roomName;
      })
      .catch((err) => {
        console.warn(`[room] load("${roomName}") failed:`, err);
        const blank = emptyRoomDocument(roomName);
        setDoc(blank);
        historyRef.current = new RoomHistory(blank);
        lastSavedJsonRef.current = JSON.stringify({
          commands: blank.commands,
          groups: blank.groups,
          layoutName: blank.layoutName,
        });
        loadedForRef.current = roomName;
      });
    try {
      globalThis.localStorage?.setItem(lastNameKey, roomName);
    } catch {
      // ignore — localStorage may be blocked.
    }
    return () => {
      cancelled = true;
    };
  }, [storage, roomName]);

  // Auto-save on doc change (debounced). Gated on load completion
  // so the initial empty placeholder never reaches storage. The
  // dirty-check key includes `layoutName` so changing the linked
  // layout via the Inspector picks up the autosave — and so the
  // saved JSON ALSO includes the field (the earlier version dropped
  // it on every save, which silently unlinked layouts).
  useEffect(() => {
    if (loadedForRef.current !== roomName) return;
    const json = JSON.stringify({
      commands: doc.commands,
      groups: doc.groups,
      layoutName: doc.layoutName,
    });
    if (json === lastSavedJsonRef.current) return;
    const t = setTimeout(() => {
      lastSavedJsonRef.current = json;
      const serialized = serializeRoom({
        name: roomName,
        title: doc.title ?? roomName,
        commands: doc.commands,
        groups: doc.groups,
        layoutName: doc.layoutName,
      }) as RoomDocument;
      storage
        .save(roomName, serialized)
        .then(() => {
          // afterSave fires only on successful persistence. Layout mode
          // uses this to schedule a bake of the just-saved doc; in Room
          // mode it's undefined and we skip.
          afterSave?.(roomName, serialized);
        })
        .catch((err) => {
          console.warn(`[room] save("${roomName}") failed:`, err);
        });
    }, 500);
    return () => clearTimeout(t);
  }, [doc, roomName, storage, afterSave]);

  // --- Selection -------------------------------------------------

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

  // Click handlers: plain-replace vs Ctrl/Cmd-toggle. Both expand a
  // single clicked command into its whole group when the command is
  // in a group. The pure `selectionFromClick` / `selectionFromToggle`
  // helpers in `room-selection.ts` own the rule; these wrappers just
  // adapt the live `RoomDocLookup` into the helper's `GroupLookup`
  // shape and dispatch state.
  const helperLookup = useMemo<GroupLookup>(
    () => ({
      groupOf: (id) => lookup.commandToGroup.get(id) ?? null,
      groupMembers: (gid) => lookup.groupMembers.get(gid) ?? [],
    }),
    [lookup],
  );

  const pickFromClick = useCallback(
    (commandId: string) => {
      setSelectionState(selectionFromClick(commandId, helperLookup));
    },
    [helperLookup],
  );

  const toggleFromClick = useCallback(
    (commandId: string) => {
      setSelectionState((prev) =>
        selectionFromToggle(prev, commandId, helperLookup),
      );
    },
    [helperLookup],
  );

  // --- Mutators (commands) ---------------------------------------
  // Pattern: construct EditAction → push to history → setDoc(history.currentDoc)

  const placeObject = useCallback(
    (kindId: string, position?: [number, number, number]) => {
      const cmd = newPlaceObject({ kindId, position });
      const action: EditAction = {
        type: 'place',
        commandId: cmd.id,
        kindId,
        position: position ?? [0, 0, 0],
      };
      const h = getHistory(doc);
      h.push(action);
      setDoc(h.currentDoc);
      setSelectionState(new Set([cmd.id]));
      return cmd.id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  const placeMany = useCallback(
    (
      kindId: string,
      positions: ReadonlyArray<[number, number, number]>,
      groupId: string | null = null,
    ) => {
      // Pre-mint command IDs before constructing the action so the EditAction
      // carries stable ids that match what applyAction will create.
      const cmds = positions.map((pos) =>
        newPlaceObject({ kindId, position: pos }),
      );
      const action: EditAction = {
        type: 'placeMany',
        commandIds: cmds.map((c) => c.id),
        kindId,
        positions: positions as [number, number, number][],
        groupId: groupId ?? null,
      };
      const h = getHistory(doc);
      h.push(action);
      setDoc(h.currentDoc);
      return cmds.map((c) => c.id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  const setKindForCommand = useCallback(
    (commandId: string, kindId: string) => {
      const action: EditAction = { type: 'setKind', commandId, kindId };
      const h = getHistory(doc);
      h.push(action);
      setDoc(h.currentDoc);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  const setPositionForCommand = useCallback(
    (commandId: string, position: [number, number, number]) => {
      const action: EditAction = { type: 'setPosition', commandId, position };
      const h = getHistory(doc);
      h.push(action);
      setDoc(h.currentDoc);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  const setPositionMany = useCallback(
    (moves: Array<{ commandId: string; position: [number, number, number] }>) => {
      if (moves.length === 0) return;
      const action: EditAction = { type: 'setPositionMany', moves };
      const h = getHistory(doc);
      h.push(action);
      setDoc(h.currentDoc);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  // Internal helper: record a delete action to history, then update doc.
  // The delete action carries enough info for undo (deletedCommands + groupsAffected).
  const deleteCommandsInternal = useCallback(
    (toDelete: ReadonlySet<string>) => {
      if (toDelete.size === 0) return;

      // Build delete action payload from the current doc (before the delete).
      const currentDoc = historyRef.current?.currentDoc ?? doc;

      // Expand through groups: deleting any group member pulls every sibling.
      const expanded = new Set(toDelete);
      for (const g of Object.values(currentDoc.groups)) {
        const overlaps = g.commandIds.some((cid) => expanded.has(cid));
        if (overlaps) for (const cid of g.commandIds) expanded.add(cid);
      }

      const deletedCommands = currentDoc.commands.filter(
        (c): c is PlaceObjectCommand => expanded.has(c.id) && c.op === 'placeObject',
      );
      const groupsAffected: Record<string, string[]> = {};
      for (const g of Object.values(currentDoc.groups)) {
        if (g.commandIds.some((cid) => expanded.has(cid))) {
          groupsAffected[g.id] = g.commandIds;
        }
      }

      const action: EditAction = {
        type: 'delete',
        commandIds: Array.from(expanded),
        deletedCommands,
        groupsAffected,
      };

      const h = getHistory(currentDoc);
      h.push(action);
      setDoc(h.currentDoc);

      setSelectionState((prev) => {
        const next = new Set(prev);
        for (const id of expanded) next.delete(id);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  const deleteCommand = useCallback(
    (commandId: string) => {
      deleteCommandsInternal(new Set([commandId]));
    },
    [deleteCommandsInternal],
  );

  const deleteSelection = useCallback(() => {
    // Reads the current selection synchronously and dispatches.
    deleteCommandsInternal(selection);
  }, [deleteCommandsInternal, selection]);

  // --- Groups ----------------------------------------------------

  const groupCommands = useCallback(
    (commandIds: Iterable<string>, label?: string): string | null => {
      const ids = Array.from(new Set(commandIds));
      if (ids.length < 2) return null;

      const currentDoc = historyRef.current?.currentDoc ?? doc;

      // Validate against the live doc.groups before constructing the action.
      const inAny = ids.some((cid) =>
        Object.values(currentDoc.groups).some((g) => g.commandIds.includes(cid)),
      );
      if (inAny) return null;

      const groupId = mintGroupId();
      const action: EditAction = { type: 'group', groupId, commandIds: ids, label };
      const h = getHistory(currentDoc);
      h.push(action);
      setDoc(h.currentDoc);
      return groupId;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  const ungroupCommands = useCallback(
    (groupId: string) => {
      const currentDoc = historyRef.current?.currentDoc ?? doc;
      const group = currentDoc.groups[groupId];
      if (!group) return;

      const action: EditAction = {
        type: 'ungroup',
        groupId,
        commandIds: group.commandIds,
        label: group.label,
      };
      const h = getHistory(currentDoc);
      h.push(action);
      setDoc(h.currentDoc);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  const addToGroup = useCallback(
    (groupId: string, commandIds: Iterable<string>) => {
      const currentDoc = historyRef.current?.currentDoc ?? doc;
      const g = currentDoc.groups[groupId];
      if (!g) return;

      const incoming = Array.from(commandIds).filter(
        (cid) => !g.commandIds.includes(cid),
      );
      if (incoming.length === 0) return;

      const action: EditAction = { type: 'addToGroup', groupId, commandIds: incoming };
      const h = getHistory(currentDoc);
      h.push(action);
      setDoc(h.currentDoc);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );

  // --- Layout name (metadata, not tracked in command history) ----

  /**
   * Directly updates `doc.layoutName` without creating a history node.
   * `layoutName` is room metadata (links to an authored layout), not a
   * reversible command-edit — analogous to changing `doc.title`.
   *
   * SRP note: the layout → room link lives in the doc so the Room view
   * can render the baked GLB.  Not in the command history because undo
   * should not swap the base geometry out from under all the placed
   * objects.
   */
  const setLayoutName = useCallback((name: string | undefined) => {
    const trimmed = name?.trim() || undefined;
    // CRITICAL: patch both the React `doc` state AND the underlying
    // history. `RoomHistory.push` rebuilds `currentDoc` from its own
    // internal `_currentDoc`, NOT from React state — so a bare
    // `setDoc(prev => ...)` here would update the React copy but
    // leave the history holding a stale version without `layoutName`.
    // The next `placeObject` (or any mutator) would then push an
    // action whose result spreads the stale `_currentDoc`, and React
    // state would snap back to no-layoutName. That's the bug behind
    // "placing furniture makes the layout disappear."
    historyRef.current?.patchBaseDoc({
      layoutName: trimmed,
      updatedAt: Date.now(),
    });
    setDoc((prev) => ({ ...prev, layoutName: trimmed, updatedAt: Date.now() }));
    // SRP: baking is the Layout editor's job (it schedules a bake on
    // every save via `afterSave`). The Room editor only CONSUMES the
    // baked GLB — `<BakedLayout>` lazily loads it from disk. No
    // bake-trigger here; an earlier version called `awaitFresh` to
    // "warm the cache," but that actually kicked off a fresh bake on
    // every room load and any transient failure left the inspector's
    // bake badge stuck on "failed" until the user opened the layout
    // editor.
  }, []);

  // --- History ---------------------------------------------------

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h || !h.canUndo) return;
    h.undo();
    setDoc(h.currentDoc);
    // Clear selection after undo to avoid dangling refs
    setSelectionState(new Set());
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h || !h.canRedo) return;
    h.redo();
    setDoc(h.currentDoc);
    setSelectionState(new Set());
  }, []);

  const jumpTo = useCallback((nodeId: string) => {
    const h = historyRef.current;
    if (!h) return;
    h.jumpTo(nodeId);
    setDoc(h.currentDoc);
    setSelectionState(new Set());
  }, []);

  // Derived from ref synchronously — no separate state needed.
  const historyNodes = historyRef.current?.getNodes() ?? [];
  const historyCurrentNodeId = historyRef.current?.currentNodeId ?? null;

  // --- Persistence -----------------------------------------------

  const loadRoom = useCallback(async (name: string) => {
    setRoomName(name);
  }, []);

  const newRoom = useCallback((name: string) => {
    const blank = emptyRoomDocument(name);
    setDoc(blank);
    historyRef.current = new RoomHistory(blank);
    setSelectionState(new Set());
    setRoomName(name);
  }, []);

  const listRooms = useCallback(async () => {
    const summaries = await storage.list();
    return summaries.map((s) => s.name);
  }, [storage]);

  return {
    doc,
    compiled,
    roomName,
    selection,
    setSelection,
    toggleSelection,
    clearSelection,
    pickFromClick,
    toggleFromClick,
    lookup,
    placeObject,
    placeMany,
    setKindForCommand,
    setPositionForCommand,
    setPositionMany,
    deleteCommand,
    deleteSelection,
    groupCommands,
    ungroupCommands,
    addToGroup,
    setLayoutName,
    loadRoom,
    newRoom,
    listRooms,
    undo,
    redo,
    jumpTo,
    historyNodes,
    historyCurrentNodeId,
  };
}
