/**
 * `<LayoutApp>` — the Layout editor mode.
 *
 * Structure mirrors `RoomApp`: LeftPanel + main canvas + SidePanel.
 * Differences:
 *   - ObjectPalette filtered to `layoutFilter='require'` (layout objects only).
 *   - No group/ungroup — layouts are flat command lists in v1.
 *   - Bake-status pill above the toolbar, driven by BakeRegistry.subscribe.
 *   - On every doc change, `useLayoutDocument` calls scheduleBake automatically.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { ObjectPalette } from '../room/ObjectPalette.tsx';
import { InspectorPanel } from '../room/InspectorPanel.tsx';
import { CommandHistory } from '../room/CommandHistory.tsx';
import { Toolbar } from '../room/Toolbar.tsx';
import type { Tool } from '../room/tools.ts';
import { LayoutPicker } from './LayoutPicker.tsx';
import { LayoutEditorCanvas } from './LayoutEditorCanvas.tsx';
import { useLayoutDocument } from './useLayoutDocument.ts';
import {
  subscribe as registrySubscribe,
  getBakeState,
  BAKE_OPTIMIZERS,
  DEFAULT_OPTIMIZER_ID,
} from '@officexr/world/app';
import type { BakeState } from '@officexr/world/app';

// ---------------------------------------------------------------------------
// Bake-status pill
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Optimizer selector — chooses the bake post-process strategy
// ---------------------------------------------------------------------------

interface OptimizerPickerProps {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}

/**
 * Drop-down listing every registered `BakeOptimizer`. Writes the
 * selected id to `LayoutDocument.optimizer`. The strategy is applied on
 * the next bake (no immediate re-bake — the doc save will trigger it).
 */
function OptimizerPicker({ value, onChange }: OptimizerPickerProps) {
  const current = value ?? DEFAULT_OPTIMIZER_ID;
  const options = Array.from(BAKE_OPTIMIZERS.values());
  const selected = BAKE_OPTIMIZERS.get(current) ?? options[0];

  return (
    <div style={{ padding: '8px 10px', borderTop: '1px solid #1f2937' }}>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#9ca3af',
          marginBottom: 4,
        }}
      >
        Bake optimization
      </div>
      <select
        value={current}
        onChange={(e) => {
          const id = e.target.value;
          onChange(id === DEFAULT_OPTIMIZER_ID ? undefined : id);
        }}
        style={{
          width: '100%',
          background: '#0f172a',
          color: '#e5e7eb',
          border: '1px solid #1f2937',
          padding: '4px 6px',
          fontSize: 12,
          borderRadius: 4,
        }}
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
      {selected.description ? (
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
          {selected.description}
        </div>
      ) : null}
    </div>
  );
}

function BakeStatusPill({ layoutName }: { layoutName: string }) {
  const [state, setState] = useState<BakeState>(
    () => getBakeState(layoutName),
  );

  useEffect(() => {
    // Sync in case state changed between render and effect mount.
    setState(getBakeState(layoutName));

    const unsub = registrySubscribe((name, s) => {
      if (name === layoutName) setState(s);
    });
    return unsub;
  }, [layoutName]);

  const pillStyle: React.CSSProperties = {
    fontSize: 10,
    padding: '2px 8px',
    borderRadius: 10,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    display: 'inline-block',
    marginBottom: 4,
  };

  const colors: Record<BakeState, { bg: string; color: string }> = {
    idle:    { bg: '#1a1a1a', color: '#6b7280' },
    pending: { bg: '#1a2433', color: '#60a5fa' },
    running: { bg: '#1a2433', color: '#93c5fd' },
    settled: { bg: '#0d2b1d', color: '#4ade80' },
    error:   { bg: '#2b0d0d', color: '#f87171' },
  };

  const { bg, color } = colors[state];

  return (
    <div style={{ padding: '4px 10px 0' }}>
      <span style={{ ...pillStyle, background: bg, color }}>
        bake: {state}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LayoutApp
// ---------------------------------------------------------------------------

export function LayoutApp() {
  const layoutDoc = useLayoutDocument();
  const [tool, setTool] = useState<Tool>('select');
  const [stagedKindId, setStagedKindId] = useState<string | null>(null);
  const [buildHeight, setBuildHeight] = useState<number>(0);

  const handleStage = useCallback((kindId: string | null) => {
    setStagedKindId(kindId);
    setTool(kindId ? 'add' : 'select');
  }, []);

  const handlePlace = useCallback(
    (position: [number, number, number]) => {
      if (!stagedKindId) return;
      layoutDoc.placeObject(stagedKindId, position);
    },
    [stagedKindId, layoutDoc],
  );

  const handleSelectInstance = useCallback(
    (commandId: string, modKey: boolean) => {
      if (modKey) layoutDoc.toggleSelection(commandId);
      else layoutDoc.setSelection([commandId]);
    },
    [layoutDoc],
  );

  const handleMoveSelection = useCallback(
    (moves: Array<{ commandId: string; position: [number, number, number] }>) => {
      for (const m of moves) {
        layoutDoc.setPositionForCommand(m.commandId, m.position);
      }
    },
    [layoutDoc],
  );

  // Keyboard shortcuts mirroring RoomApp (Esc, Q/E, Ctrl+Z/Y/Shift+Z).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

      if (e.key === 'Escape') {
        setTool('select');
        layoutDoc.clearSelection();
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && e.shiftKey) {
          e.preventDefault();
          layoutDoc.redo();
          return;
        }
        if (k === 'z') {
          e.preventDefault();
          layoutDoc.undo();
          return;
        }
        if (k === 'y' && !e.metaKey) {
          e.preventDefault();
          layoutDoc.redo();
          return;
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (layoutDoc.selection.size > 0) {
          e.preventDefault();
          layoutDoc.deleteSelection();
        }
        return;
      }

      if (e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 'q') setBuildHeight((y) => y - 1);
      else if (k === 'e') setBuildHeight((y) => y + 1);
      else if (k === 'v') setTool('select');
      else if (k === 'b' && stagedKindId) setTool('add');
      else if (k === 'x') setTool('delete');
      else if (k === 'm') setTool('move');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layoutDoc, stagedKindId]);

  // Build a minimal roomDoc-compatible object for InspectorPanel.
  // ISP note (SOLID): InspectorPanel takes the full useRoomDocument return value,
  // but only uses a small subset.  We pass a compatible shim.  The cast is
  // required because TypeScript infers the return type of useRoomDocument as a
  // structural type with many fields.  When InspectorPanel is refactored to
  // accept a narrow interface, this shim can be removed.
  // ISP violation: InspectorPanel depends on the full RoomDoc interface. The
  // fix is to refactor InspectorPanel to accept a narrower interface — deferred
  // because it would require changes to the room editor's prop drilling.
  const roomDocCompat = {
    doc: { ...layoutDoc.doc, schemaVersion: 5 as const, groups: {} },
    compiled: layoutDoc.compiled,
    selection: layoutDoc.selection,
    lookup: {
      instancesByCommand: new Map(),
      commandToGroup: new Map(),
      groupMembers: new Map(),
      groupOf: () => null,
    },
    setKindForCommand: (_id: string, _kindId: string) => undefined,
    setPositionForCommand: layoutDoc.setPositionForCommand,
    deleteCommand: layoutDoc.deleteCommand,
    deleteSelection: layoutDoc.deleteSelection,
    groupCommands: () => null,
    ungroupCommands: () => undefined,
    addToGroup: () => undefined,
    // setLayoutName is a no-op in the Layout editor — layout objects don't
    // link to a nested layout (they ARE the layout).  The InspectorPanel
    // calls this when the user edits the "Layout" field; suppressing the
    // call here is intentional so the layout name never gets corrupted.
    setLayoutName: (_name: string | undefined) => undefined,
    historyNodes: [],
    historyCurrentNodeId: null,
    jumpTo: () => undefined,
    // Remaining fields from useRoomDocument return type — stub unused ones.
    roomName: layoutDoc.layoutName,
    setSelection: layoutDoc.setSelection,
    toggleSelection: layoutDoc.toggleSelection,
    clearSelection: layoutDoc.clearSelection,
    pickFromClick: (id: string) => layoutDoc.setSelection([id]),
    toggleFromClick: layoutDoc.toggleSelection,
    placeObject: layoutDoc.placeObject,
    placeMany: () => [] as string[],
    setPositionMany: () => undefined,
    loadRoom: async () => undefined,
    newRoom: () => undefined,
    listRooms: async () => [] as string[],
    undo: layoutDoc.undo,
    redo: layoutDoc.redo,
  };

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <LeftPanel>
        <LayoutPicker
          current={layoutDoc.layoutName}
          listLayouts={layoutDoc.listLayouts}
          loadLayout={layoutDoc.loadLayout}
          newLayout={layoutDoc.newLayout}
        />
        <ObjectPalette
          staged={stagedKindId}
          onStage={handleStage}
          layoutFilter="require"
        />
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
        <LayoutEditorCanvas
          doc={layoutDoc.doc}
          compiled={layoutDoc.compiled}
          selection={layoutDoc.selection}
          tool={tool}
          stagedKindId={stagedKindId}
          buildHeight={buildHeight}
          onPlaceAt={handlePlace}
          onSelectInstance={handleSelectInstance}
          onDeleteCommand={layoutDoc.deleteCommand}
          onSetTool={setTool}
          onClickEmpty={layoutDoc.clearSelection}
          onMoveSelection={handleMoveSelection}
        />
        <BakeStatusPill layoutName={layoutDoc.layoutName} />
        <Toolbar
          active={tool}
          stagedKindId={stagedKindId}
          onChange={setTool}
        />
      </main>
      <SidePanel>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <InspectorPanel roomDoc={roomDocCompat as Parameters<typeof InspectorPanel>[0]['roomDoc']} />
          </div>
          <OptimizerPicker
            value={layoutDoc.doc.optimizer}
            onChange={layoutDoc.setOptimizer}
          />
          <div style={{ flex: '0 0 auto', maxHeight: '45%', overflowY: 'auto' }}>
            <CommandHistory
              nodes={[]}
              currentNodeId={null}
              onJumpTo={() => undefined}
            />
          </div>
        </div>
      </SidePanel>
    </div>
  );
}
