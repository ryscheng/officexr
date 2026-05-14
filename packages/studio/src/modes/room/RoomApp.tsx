import React, { useCallback, useEffect, useState } from 'react';
import { Leva } from 'leva';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { CommandHistory } from './CommandHistory.tsx';
import { ObjectPalette } from './ObjectPalette.tsx';
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

  // Esc returns to Select tool no matter where the focus is — mirrors
  // the user spec: "Esc automatically returns to select tool".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      setTool('select');
      roomDoc.clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [roomDoc]);

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
          onPlaceAt={handlePlace}
          onSelectInstance={handleSelectInstance}
          onClickEmpty={roomDoc.clearSelection}
        />
        <RoomHud
          roomName={roomDoc.roomName}
          tool={tool}
          selectionSize={roomDoc.selection.size}
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
      {`Room: ${props.roomName} · Tool: ${props.tool} · Selection: ${selLabel}
WASD/QE to fly · right-drag to look · scroll to dolly · Ctrl/Cmd-click to multi-select`}
    </div>
  );
}
