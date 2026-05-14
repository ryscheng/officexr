import React, { useCallback, useEffect, useState } from 'react';
import { Leva } from 'leva';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { CommandHistory } from './CommandHistory.tsx';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.tsx';
import { ObjectPalette } from './ObjectPalette.tsx';
import { RoomPicker } from './RoomPicker.tsx';
import { SceneEditorCanvas } from './SceneEditorCanvas.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useRoomDocument } from './useRoomDocument.ts';
import { useRoomInspector } from './useRoomInspector.ts';
import { selectionIsExactlyOneGroup } from './room-selection.ts';
import type { Tool } from './tools.ts';

/**
 * Standalone Room editor application (renamed from `ScenesApp` in
 * Task 5 of the studio multi-editor restructure; the document /
 * inspector hooks moved to `useRoomDocument` / `useRoomInspector` in
 * Task 6 when the multi-select + groups model landed). Owns its own
 * R3F canvas, document state, and free-fly camera. Persists the
 * working document via `RoomStorage` (Vite middleware at `/api/rooms`
 * in dev, localStorage otherwise). Has no SDK store, no SyncEngine,
 * no WebSocket — Debug mode is what consumes authored rooms.
 */
export function RoomApp() {
  const roomDoc = useRoomDocument();
  const [tool, setTool] = useState<Tool>('select');
  const [stagedKindId, setStagedKindId] = useState<string | null>(null);
  // Current build height (integer voxel y). The Add tool's floor
  // picker sits at this y; Q lowers it, E raises it. The visible
  // EndlessGrid stays at world y=0 as a reference plane — the build
  // height is independent of it so the user can place cubes below
  // y=0 (negative voxels) by pressing Q, or stack high in the sky by
  // pressing E.
  const [buildHeight, setBuildHeight] = useState<number>(0);

  // Picking a kind in the palette implies "I want to place this".
  // Switch to Add automatically; un-pick reverts to Select.
  const handleStage = useCallback((kindId: string | null) => {
    setStagedKindId(kindId);
    setTool(kindId ? 'add' : 'select');
  }, []);

  // Place via the Add tool. Tool stays Add so the user can keep
  // dropping cubes — Esc (or clicking Select in the toolbar) ends
  // the streak. Multi-shot placement matches the user's mental model
  // of "I'm placing a row of cubes."
  const handlePlace = useCallback(
    (position: [number, number, number]) => {
      if (!stagedKindId) return;
      roomDoc.placeCube(stagedKindId, position);
    },
    [stagedKindId, roomDoc],
  );

  // Keyboard shortcuts.
  //   Esc returns to Select + clears selection (per spec: "Esc
  //     automatically returns to select tool").
  //   Q / E shift the Add tool's build height down / up by one voxel.
  //     The grid plane is a visual reference only — Q/E let the user
  //     place cubes below or above it without needing an existing
  //     cube to snap off.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') {
        setTool('select');
        roomDoc.clearSelection();
        return;
      }
      // Ctrl/Cmd shortcuts FIRST — they overlap with the bare letter
      // shortcuts below.
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'g' && e.shiftKey) {
          e.preventDefault();
          const exact = selectionIsExactlyOneGroup(
            roomDoc.selection,
            roomDoc.lookup.groupMembers,
          );
          if (exact) roomDoc.ungroupCommands(exact);
          return;
        }
        if (k === 'g') {
          e.preventDefault();
          if (roomDoc.selection.size >= 2) {
            roomDoc.groupCommands(roomDoc.selection);
          }
          return;
        }
        return;
      }
      // Delete / Backspace removes the current selection.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (roomDoc.selection.size > 0) {
          e.preventDefault();
          roomDoc.deleteSelection();
        }
        return;
      }
      if (e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 'q') {
        setBuildHeight((y) => y - 1);
      } else if (k === 'e') {
        setBuildHeight((y) => y + 1);
      } else if (k === 'v') {
        setTool('select');
      } else if (k === 'b') {
        // Add tool needs a staged kind to do anything useful.
        if (stagedKindId) setTool('add');
      } else if (k === 'x') {
        setTool('delete');
      } else if (k === 't') {
        if (stagedKindId) setTool('tile');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [roomDoc, stagedKindId]);

  // Context menu open/closed state. `null` = closed.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Right-click intent from the canvas. Decides what to do based on
  // (commandId hit, current selection):
  //   - cube hit AND in selection → keep selection, build menu
  //   - cube hit AND NOT in selection → replace selection with that
  //     cube (or its group), build menu
  //   - no cube hit AND selection non-empty → build menu using
  //     current selection
  //   - no cube hit AND selection empty → ignore (right-drag camera
  //     uses the same gesture; we never want to surprise the user
  //     with an empty menu over blank floor)
  const handleContextMenuRequest = useCallback(
    (commandId: string | null, screenX: number, screenY: number) => {
      let selectionForMenu: ReadonlySet<string>;
      if (commandId !== null) {
        if (roomDoc.selection.has(commandId)) {
          selectionForMenu = roomDoc.selection;
        } else {
          // Promote the right-clicked cube (or its whole group) to
          // selection. pickFromClick handles the group expansion.
          roomDoc.pickFromClick(commandId);
          // Build the new effective selection for the menu — the
          // pickFromClick state-update is async w.r.t. this callback
          // body, so compute what it WOULD be from the lookup.
          const g = roomDoc.lookup.commandToGroup.get(commandId);
          if (g) {
            const members = roomDoc.lookup.groupMembers.get(g) ?? [commandId];
            selectionForMenu = new Set(members);
          } else {
            selectionForMenu = new Set([commandId]);
          }
        }
      } else {
        if (roomDoc.selection.size === 0) return;
        selectionForMenu = roomDoc.selection;
      }

      const items: ContextMenuItem[] = [];
      // Group: 2+ commands selected AND none is in a group already.
      const noneGrouped = Array.from(selectionForMenu).every(
        (id) => !roomDoc.lookup.commandToGroup.has(id),
      );
      if (selectionForMenu.size >= 2 && noneGrouped) {
        items.push({
          id: 'group',
          label: 'Group',
          shortcut: 'Ctrl+G',
          onActivate: () => {
            roomDoc.groupCommands(selectionForMenu);
          },
        });
      }
      // Ungroup: selection is exactly the membership of some group.
      const exactGroupId = selectionIsExactlyOneGroup(
        selectionForMenu,
        roomDoc.lookup.groupMembers,
      );
      if (exactGroupId) {
        items.push({
          id: 'ungroup',
          label: 'Ungroup',
          shortcut: 'Ctrl+Shift+G',
          onActivate: () => {
            roomDoc.ungroupCommands(exactGroupId);
          },
        });
      }
      items.push({
        id: 'delete',
        label: 'Delete',
        shortcut: 'Del',
        danger: true,
        onActivate: () => {
          if (commandId !== null && !roomDoc.selection.has(commandId)) {
            // We promoted to selection above; deleteSelection uses
            // the freshly-set selection on the next tick.
            roomDoc.deleteCommand(commandId);
          } else {
            roomDoc.deleteSelection();
          }
        },
      });

      setContextMenu({ x: screenX, y: screenY, items });
    },
    [roomDoc],
  );

  // Click on a cube — plain replaces, Ctrl/Cmd toggles, group members
  // are selected atomically by the hook.
  const handleSelectInstance = useCallback(
    (commandId: string, modKey: boolean) => {
      if (modKey) roomDoc.toggleFromClick(commandId);
      else roomDoc.pickFromClick(commandId);
    },
    [roomDoc],
  );

  const handleHistoryClick = useCallback(
    (commandId: string, modKey: boolean) => {
      if (modKey) roomDoc.toggleFromClick(commandId);
      else roomDoc.pickFromClick(commandId);
    },
    [roomDoc],
  );

  // Inspector controls (Leva). useRoomInspector mounts the panels
  // for the active selection; we don't render anything visible here.
  useRoomInspector(roomDoc);

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <LeftPanel>
        <RoomPicker
          current={roomDoc.roomName}
          listRooms={roomDoc.listRooms}
          loadRoom={roomDoc.loadRoom}
          newRoom={roomDoc.newRoom}
        />
        <ObjectPalette staged={stagedKindId} onStage={handleStage} />
      </LeftPanel>
      <main
        style={{
          flex: 1,
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <SceneEditorCanvas
          compiled={roomDoc.compiled}
          selection={roomDoc.selection}
          tool={tool}
          stagedKindId={stagedKindId}
          buildHeight={buildHeight}
          commandToGroup={roomDoc.lookup.commandToGroup}
          groupMembers={roomDoc.lookup.groupMembers}
          onPlaceAt={handlePlace}
          onSelectInstance={handleSelectInstance}
          onDeleteCommand={roomDoc.deleteCommand}
          onPlaceMany={roomDoc.placeMany}
          onCreateGroup={roomDoc.groupCommands}
          onSetTool={setTool}
          onClickEmpty={roomDoc.clearSelection}
          onContextMenuRequest={handleContextMenuRequest}
        />
        <RoomHud
          roomName={roomDoc.roomName}
          tool={tool}
          selectionSize={roomDoc.selection.size}
          buildHeight={buildHeight}
        />
        <Toolbar
          active={tool}
          stagedKindId={stagedKindId}
          onChange={setTool}
        />
        <ExportButton />
      </main>
      <SidePanel>
        <Leva fill flat titleBar={{ drag: false }} />
        <CommandHistory
          commands={roomDoc.doc.commands}
          selection={roomDoc.selection}
          commandToGroup={roomDoc.lookup.commandToGroup}
          onSelect={handleHistoryClick}
          onDelete={roomDoc.deleteCommand}
        />
      </SidePanel>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

function ExportButton() {
  // Stub button — exposes the future "Export GLB" workflow described
  // in `export-room.ts`. Disabled so the user can see the surface
  // without anything happening on click; a follow-up will wire it to
  // a real GLTFExporter once we settle on the per-kind material
  // baking strategy.
  return (
    <button
      type="button"
      disabled
      title="Export this room as a single optimized .glb (coming soon)"
      style={{
        position: 'absolute',
        right: 12,
        top: 12,
        padding: '6px 10px',
        background: '#1e293b',
        border: '1px solid #334155',
        color: '#94a3b8',
        font: '12px system-ui, sans-serif',
        borderRadius: 4,
        cursor: 'not-allowed',
      }}
    >
      Export GLB
    </button>
  );
}

function RoomHud(props: {
  roomName: string;
  tool: Tool;
  selectionSize: number;
  buildHeight: number;
}) {
  const selLabel =
    props.selectionSize === 0
      ? '—'
      : props.selectionSize === 1
        ? '1 cmd'
        : `${props.selectionSize} cmds`;
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        padding: '6px 10px',
        background: 'rgba(0,0,0,0.55)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 4,
        pointerEvents: 'none',
        whiteSpace: 'pre-line',
      }}
    >
      {`Room: ${props.roomName} · Tool: ${props.tool} · Selection: ${selLabel} · Build y: ${props.buildHeight}
right-drag orbit · middle-drag (or Shift+right-drag) pan · scroll zoom · Q/E build height · Ctrl/Cmd-click multi-select`}
    </div>
  );
}
