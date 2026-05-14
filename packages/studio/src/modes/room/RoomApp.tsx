import React, { useCallback, useEffect, useState } from 'react';
import { Leva } from 'leva';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { CommandHistory } from './CommandHistory.tsx';
import { ObjectPalette } from './ObjectPalette.tsx';
import { RoomPicker } from './RoomPicker.tsx';
import { SceneEditorCanvas } from './SceneEditorCanvas.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useRoomDocument } from './useRoomDocument.ts';
import { useRoomInspector } from './useRoomInspector.ts';
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
      // Don't hijack letters when a modifier is held — those are
      // reserved for future shortcuts like Ctrl+Z / Ctrl+G.
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [roomDoc, stagedKindId]);

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
          onClickEmpty={roomDoc.clearSelection}
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
    </div>
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
right-drag to orbit · scroll to zoom · Q/E to lower/raise build height · Ctrl/Cmd-click to multi-select`}
    </div>
  );
}
