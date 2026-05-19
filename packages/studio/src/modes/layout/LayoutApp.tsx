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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { ObjectPalette } from '../scene-editor/ObjectPalette.tsx';
import { InspectorPanel } from '../room/InspectorPanel.tsx';
import { CommandHistory } from '../scene-editor/CommandHistory.tsx';
import { ContextMenu, type ContextMenuItem } from '../room/ContextMenu.tsx';
import { Toolbar } from '../scene-editor/Toolbar.tsx';
import type { Tool } from '../scene-editor/tools.ts';
import { SceneEditorCanvas } from '../scene-editor/SceneEditorCanvas.tsx';
import type { SceneEditorBackend } from '../scene-editor/SceneEditorBackend.ts';
import { selectionIsExactlyOneGroup } from '../room/room-selection.ts';
import { LayoutPicker } from './LayoutPicker.tsx';
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

  // Group-aware click: clicking a tile-grouped cube selects the whole
  // group, matching Room behavior. Uses the same `pickFromClick` /
  // `toggleFromClick` helpers the Room editor uses — they read the
  // doc's group lookup tables and expand the click into the atomic
  // select-set for that group.
  const handleSelectInstance = useCallback(
    (commandId: string, modKey: boolean) => {
      if (modKey) layoutDoc.toggleFromClick(commandId);
      else layoutDoc.pickFromClick(commandId);
    },
    [layoutDoc],
  );

  const handleMoveSelection = useCallback(
    (moves: Array<{ commandId: string; position: [number, number, number] }>) => {
      // Single history step covers the whole drag — Ctrl+Z undoes the
      // entire move at once, not per-command.
      layoutDoc.setPositionMany(moves);
    },
    [layoutDoc],
  );

  // Context menu state (mirrors RoomApp). `null` = closed.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  /**
   * Right-click handler. Mirrors `RoomApp.handleContextMenuRequest`
   * because group/ungroup/delete in the Layout editor should behave
   * identically to the Room editor — the tile tool needs them for the
   * "clean up a misplaced tile" workflow.
   */
  const handleContextMenuRequest = useCallback(
    (commandId: string | null, screenX: number, screenY: number) => {
      let selectionForMenu: ReadonlySet<string>;
      if (commandId !== null) {
        if (layoutDoc.selection.has(commandId)) {
          selectionForMenu = layoutDoc.selection;
        } else {
          layoutDoc.pickFromClick(commandId);
          const g = layoutDoc.lookup.commandToGroup.get(commandId);
          if (g) {
            const members = layoutDoc.lookup.groupMembers.get(g) ?? [commandId];
            selectionForMenu = new Set(members);
          } else {
            selectionForMenu = new Set([commandId]);
          }
        }
      } else {
        if (layoutDoc.selection.size === 0) return;
        selectionForMenu = layoutDoc.selection;
      }

      const items: ContextMenuItem[] = [];
      const noneGrouped = Array.from(selectionForMenu).every(
        (id) => !layoutDoc.lookup.commandToGroup.has(id),
      );
      if (selectionForMenu.size >= 2 && noneGrouped) {
        items.push({
          id: 'group',
          label: 'Group',
          shortcut: 'Ctrl+G',
          onActivate: () => {
            layoutDoc.groupCommands(selectionForMenu);
          },
        });
      }
      const exactGroupId = selectionIsExactlyOneGroup(
        selectionForMenu,
        layoutDoc.lookup.groupMembers,
      );
      if (exactGroupId) {
        items.push({
          id: 'ungroup',
          label: 'Ungroup',
          shortcut: 'Ctrl+Shift+G',
          onActivate: () => {
            layoutDoc.ungroupCommands(exactGroupId);
          },
        });
      }
      items.push({
        id: 'delete',
        label: 'Delete',
        shortcut: 'Del',
        danger: true,
        onActivate: () => {
          if (commandId !== null && !layoutDoc.selection.has(commandId)) {
            layoutDoc.deleteCommand(commandId);
          } else {
            layoutDoc.deleteSelection();
          }
        },
      });

      setContextMenu({ x: screenX, y: screenY, items });
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
        // Ctrl+Shift+G ungroups — matches Room. Must come BEFORE the
        // plain `g` branch so the shift modifier is checked first.
        if (k === 'g' && e.shiftKey) {
          e.preventDefault();
          const exact = selectionIsExactlyOneGroup(
            layoutDoc.selection,
            layoutDoc.lookup.groupMembers,
          );
          if (exact) layoutDoc.ungroupCommands(exact);
          return;
        }
        if (k === 'g') {
          e.preventDefault();
          if (layoutDoc.selection.size >= 2) {
            layoutDoc.groupCommands(layoutDoc.selection);
          }
          return;
        }
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
      else if (k === 't') {
        // Tile tool — same shortcut + same staged-kind requirement as
        // RoomApp. Without a staged kind the tile tool has nothing to
        // place, so silently ignore the keypress in that case.
        if (stagedKindId) setTool('tile');
      }
      else if (k === 'm') setTool('move');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layoutDoc, stagedKindId]);

  // Canvas backend: every field SceneEditorCanvas needs, sourced from
  // useLayoutDocument + the editor's UI state. Mirrors how RoomApp
  // builds its backend — both editors satisfy the same
  // `SceneEditorBackend` contract.
  const backend = useMemo<SceneEditorBackend>(
    () => ({
      compiled: layoutDoc.compiled,
      selection: layoutDoc.selection,
      tool,
      stagedKindId,
      buildHeight,
      commandToGroup: layoutDoc.lookup.commandToGroup,
      groupMembers: layoutDoc.lookup.groupMembers,
      doc: layoutDoc.doc,
      // Layouts have no nested base layout — they ARE the base. The
      // canvas leaves the BakedLayout slot empty when these are
      // undefined.
      bakedLayoutPath: undefined,
      bakedLayoutName: undefined,
      onPlaceAt: handlePlace,
      onPlaceMany: layoutDoc.placeMany,
      onSelectInstance: handleSelectInstance,
      onDeleteCommand: layoutDoc.deleteCommand,
      onClickEmpty: layoutDoc.clearSelection,
      onCreateGroup: layoutDoc.groupCommands,
      onSetTool: setTool,
      onContextMenuRequest: handleContextMenuRequest,
      onMoveSelection: handleMoveSelection,
    }),
    [
      layoutDoc.compiled,
      layoutDoc.selection,
      tool,
      stagedKindId,
      buildHeight,
      layoutDoc.lookup.commandToGroup,
      layoutDoc.lookup.groupMembers,
      layoutDoc.doc,
      handlePlace,
      layoutDoc.placeMany,
      handleSelectInstance,
      layoutDoc.deleteCommand,
      layoutDoc.clearSelection,
      layoutDoc.groupCommands,
      handleContextMenuRequest,
      handleMoveSelection,
    ],
  );

  // useLayoutDocument now spreads the entire useRoomDocument shape, so
  // InspectorPanel takes layoutDoc directly with one targeted override:
  // setLayoutName is suppressed because layouts don't link to other
  // layouts. (Editing the "Layout" field inside the inspector would
  // otherwise corrupt the layout's own name.)
  const inspectorDoc = useMemo(
    () => ({
      ...layoutDoc,
      setLayoutName: (_name: string | undefined) => undefined,
    }),
    [layoutDoc],
  );

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
        <SceneEditorCanvas backend={backend} />
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
            <InspectorPanel roomDoc={inspectorDoc} />
          </div>
          <OptimizerPicker
            value={layoutDoc.optimizer}
            onChange={layoutDoc.setOptimizer}
          />
          <div style={{ flex: '0 0 auto', maxHeight: '45%', overflowY: 'auto' }}>
            <CommandHistory
              nodes={layoutDoc.historyNodes}
              currentNodeId={layoutDoc.historyCurrentNodeId}
              onJumpTo={layoutDoc.jumpTo}
            />
          </div>
        </div>
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
