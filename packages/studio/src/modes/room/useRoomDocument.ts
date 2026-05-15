import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FilesystemRoomStorage,
  LocalStorageRoomStorage,
  compileScene,
  emptyRoomDocument,
  newExtrude,
  newPlaceCube,
  serializeRoom,
  type CubeFace,
  type RoomDocument,
  type RoomGroup,
  type RoomStorage,
} from '@officexr/world/scenes';
import type { WorldObjects } from '@officexr/sdk';
import {
  selectionFromClick,
  selectionFromToggle,
  type GroupLookup,
} from './room-selection.ts';

const LAST_ROOM_KEY = 'officexr:studio:lastRoom';
const DEFAULT_ROOM_NAME = 'default-v2';

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
 *     of `RoomGroup.commandIds` so callers can't mutate the doc).
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
 * Promoted from `useSceneDocument` in Task 6 of the studio
 * multi-editor restructure:
 *   - `selection` is now `ReadonlySet<string>` (multi-select via
 *     Ctrl/Cmd+click). Clicking a group member selects the whole
 *     group atomically — see `pickFromClick` / `toggleFromClick`.
 *   - The document carries `groups: Record<string, RoomGroup>` so a
 *     tile-tool result (Task 9) or a manual Group action persists
 *     across save/load.
 */
export function useRoomDocument(): {
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
  placeCube: (kindId: string, position?: [number, number, number]) => string;
  placeMany: (
    kindId: string,
    positions: ReadonlyArray<[number, number, number]>,
    groupId?: string | null,
  ) => string[];
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
  deleteSelection: () => void;
  groupCommands: (commandIds: Iterable<string>, label?: string) => string | null;
  ungroupCommands: (groupId: string) => void;
  addToGroup: (groupId: string, commandIds: Iterable<string>) => void;
  loadRoom: (name: string) => Promise<void>;
  newRoom: (name: string) => void;
  listRooms: () => Promise<string[]>;
} {
  const storage = useMemo<RoomStorage>(() => {
    try {
      return new FilesystemRoomStorage();
    } catch {
      return new LocalStorageRoomStorage();
    }
  }, []);

  const [roomName, setRoomName] = useState<string>(() => {
    try {
      return globalThis.localStorage?.getItem(LAST_ROOM_KEY) ?? DEFAULT_ROOM_NAME;
    } catch {
      return DEFAULT_ROOM_NAME;
    }
  });
  const [doc, setDoc] = useState<RoomDocument>(() =>
    emptyRoomDocument(roomName),
  );
  const [selection, setSelectionState] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Re-compile on every doc change. Cheap: pure function, scenes are
  // small (hundreds of cubes at most for v1) and `compileScene` runs
  // in <1 ms for that range.
  const compiled = useMemo(() => compileScene(doc, 2), [doc]);

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
          lastSavedJsonRef.current = JSON.stringify({
            commands: blank.commands,
            groups: blank.groups,
          });
          loadedForRef.current = roomName;
          return;
        }
        setDoc(loaded);
        lastSavedJsonRef.current = JSON.stringify({
          commands: loaded.commands,
          groups: loaded.groups,
        });
        loadedForRef.current = roomName;
      })
      .catch((err) => {
        console.warn(`[room] load("${roomName}") failed:`, err);
        const blank = emptyRoomDocument(roomName);
        setDoc(blank);
        lastSavedJsonRef.current = JSON.stringify({
          commands: blank.commands,
          groups: blank.groups,
        });
        loadedForRef.current = roomName;
      });
    try {
      globalThis.localStorage?.setItem(LAST_ROOM_KEY, roomName);
    } catch {
      // ignore — localStorage may be blocked.
    }
    return () => {
      cancelled = true;
    };
  }, [storage, roomName]);

  // Auto-save on doc change (debounced). Gated on load completion
  // so the initial empty placeholder never reaches storage.
  useEffect(() => {
    if (loadedForRef.current !== roomName) return;
    const json = JSON.stringify({
      commands: doc.commands,
      groups: doc.groups,
    });
    if (json === lastSavedJsonRef.current) return;
    const t = setTimeout(() => {
      lastSavedJsonRef.current = json;
      storage
        .save(
          roomName,
          serializeRoom({
            name: roomName,
            title: doc.title ?? roomName,
            commands: doc.commands,
            groups: doc.groups,
          }) as RoomDocument,
        )
        .catch((err) => {
          console.warn(`[room] save("${roomName}") failed:`, err);
        });
    }, 500);
    return () => clearTimeout(t);
  }, [doc, roomName, storage]);

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

  const placeCube = useCallback(
    (kindId: string, position?: [number, number, number]) => {
      const cmd = newPlaceCube({ kindId, position });
      setDoc((prev) => ({
        ...prev,
        updatedAt: Date.now(),
        commands: [...prev.commands, cmd],
      }));
      setSelectionState(new Set([cmd.id]));
      return cmd.id;
    },
    [],
  );

  const placeMany = useCallback(
    (
      kindId: string,
      positions: ReadonlyArray<[number, number, number]>,
      groupId: string | null = null,
    ) => {
      const cmds = positions.map((pos) =>
        newPlaceCube({ kindId, position: pos }),
      );
      setDoc((prev) => {
        const groups = { ...prev.groups };
        if (groupId && groups[groupId]) {
          groups[groupId] = {
            ...groups[groupId],
            commandIds: [
              ...groups[groupId].commandIds,
              ...cmds.map((c) => c.id),
            ],
          };
        }
        return {
          ...prev,
          updatedAt: Date.now(),
          commands: [...prev.commands, ...cmds],
          groups,
        };
      });
      return cmds.map((c) => c.id);
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
      setSelectionState(new Set([cmd.id]));
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
          c.id === commandId && c.op === 'placeCube' ? { ...c, kindId } : c,
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
          c.id === commandId && c.op === 'placeCube' ? { ...c, position } : c,
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
          c.id === commandId && c.op === 'extrude' ? { ...c, face } : c,
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

  // Internal helper: drop a SET of command ids in one doc update,
  // cascading through groups (a group whose membership is fully gone
  // is also removed) and extrude targets (an extrude pointing at a
  // deleted command becomes a no-op anyway, so we drop the extrude
  // command from the history).
  const deleteCommandsInternal = useCallback(
    (toDelete: ReadonlySet<string>) => {
      if (toDelete.size === 0) return;
      setDoc((prev) => {
        // Expand `toDelete` through groups: deleting any group member
        // pulls every sibling in too. Single pass is sufficient because
        // groups don't nest in v1.
        const expanded = new Set(toDelete);
        for (const g of Object.values(prev.groups)) {
          const overlaps = g.commandIds.some((cid) => expanded.has(cid));
          if (overlaps) for (const cid of g.commandIds) expanded.add(cid);
        }
        const commands = prev.commands.filter(
          (c) =>
            !expanded.has(c.id) &&
            !(c.op === 'extrude' && expanded.has(c.targetCommandId)),
        );
        const groups: Record<string, RoomGroup> = {};
        for (const g of Object.values(prev.groups)) {
          const remaining = g.commandIds.filter((cid) => !expanded.has(cid));
          // A singleton group is meaningless — drop it entirely so we
          // never end up with a group of one.
          if (remaining.length >= 2) {
            groups[g.id] = { ...g, commandIds: remaining };
          }
        }
        return {
          ...prev,
          updatedAt: Date.now(),
          commands,
          groups,
        };
      });
      setSelectionState((prev) => {
        const next = new Set(prev);
        for (const id of toDelete) next.delete(id);
        return next;
      });
    },
    [],
  );

  const deleteCommand = useCallback(
    (commandId: string) => {
      deleteCommandsInternal(new Set([commandId]));
    },
    [deleteCommandsInternal],
  );

  const deleteSelection = useCallback(() => {
    // Reads the current selection synchronously and dispatches. The
    // selection state ref is read OUTSIDE the updater so the updater
    // body stays pure (StrictMode double-invokes wouldn't burn extra
    // group ids or fire extra setDoc calls).
    deleteCommandsInternal(selection);
  }, [deleteCommandsInternal, selection]);

  // --- Groups ----------------------------------------------------

  const groupCommands = useCallback(
    (commandIds: Iterable<string>, label?: string): string | null => {
      const ids = Array.from(new Set(commandIds));
      if (ids.length < 2) return null;
      // Validate against the live `doc.groups` BEFORE entering the
      // updater so the function's return value reflects the real
      // outcome. The updater must stay pure: it's allowed to be
      // called twice under React StrictMode and re-running it must
      // produce the same shape.
      const inAny = ids.some((cid) =>
        Object.values(doc.groups).some((g) => g.commandIds.includes(cid)),
      );
      if (inAny) return null;
      // Mint the id outside the updater for the same reason — calling
      // `mintGroupId()` inside the updater would burn a new id on
      // every dev double-invoke.
      const groupId = mintGroupId();
      setDoc((prev) => {
        // Race guard: another mutation could have grouped one of the
        // ids between the validation above and the updater running.
        // If so, treat this as a no-op rather than violating the v1
        // "at most one group per command" invariant.
        const stillFree = ids.every((cid) =>
          Object.values(prev.groups).every((g) => !g.commandIds.includes(cid)),
        );
        if (!stillFree) return prev;
        return {
          ...prev,
          updatedAt: Date.now(),
          groups: {
            ...prev.groups,
            [groupId]: { id: groupId, commandIds: ids, label },
          },
        };
      });
      return groupId;
    },
    [doc.groups],
  );

  const ungroupCommands = useCallback((groupId: string) => {
    setDoc((prev) => {
      if (!prev.groups[groupId]) return prev;
      const { [groupId]: _drop, ...rest } = prev.groups;
      void _drop;
      return {
        ...prev,
        updatedAt: Date.now(),
        groups: rest,
      };
    });
  }, []);

  const addToGroup = useCallback(
    (groupId: string, commandIds: Iterable<string>) => {
      setDoc((prev) => {
        const g = prev.groups[groupId];
        if (!g) return prev;
        const incoming = Array.from(commandIds).filter(
          (cid) => !g.commandIds.includes(cid),
        );
        if (incoming.length === 0) return prev;
        return {
          ...prev,
          updatedAt: Date.now(),
          groups: {
            ...prev.groups,
            [groupId]: {
              ...g,
              commandIds: [...g.commandIds, ...incoming],
            },
          },
        };
      });
    },
    [],
  );

  const loadRoom = useCallback(async (name: string) => {
    setRoomName(name);
  }, []);

  const newRoom = useCallback((name: string) => {
    setDoc(emptyRoomDocument(name));
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
    placeCube,
    placeMany,
    extrudeFromFace,
    setKindForCommand,
    setPositionForCommand,
    setExtrudeFace,
    setExtrudeCount,
    deleteCommand,
    deleteSelection,
    groupCommands,
    ungroupCommands,
    addToGroup,
    loadRoom,
    newRoom,
    listRooms,
  };
}
