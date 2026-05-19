/**
 * `SceneEditorBackend` — the parent contract for `<SceneEditorCanvas>`.
 *
 * The canvas is document-agnostic: it edits a list of `SceneCommand`s
 * plus an authoring layer of `CommandGroup`s and a small bundle of UI
 * state (tool, selection, staged kind, build height). Whether those
 * live in a `RoomDocument` or a `LayoutDocument` is none of the
 * canvas's business — both kinds of document hook implement this
 * interface and pass it in via `<SceneEditorCanvas backend={...} />`.
 *
 * DIP: the canvas (high-level rendering / interaction) depends on this
 * abstraction; concrete document hooks (`useRoomDocument`,
 * `useLayoutDocument`) implement it. The previous design had the
 * canvas depending on `RoomDocument` directly, which forced Layout to
 * shim its document into a Room shape (`asRoomDoc`) and stub out the
 * group / placeMany / contextMenu callbacks. That violated DIP and
 * silently broke the tile tool in Layout. This interface removes the
 * direct coupling.
 *
 * ISP: the `doc` field is narrowed to `{ commands: readonly SceneCommand[] }`
 * because that is the only thing the canvas reads off the document
 * (in `MoveController` — see `SceneEditorCanvas.tsx`). Anything richer
 * (room title, layout name, schemaVersion, …) would force consumers
 * that don't have those fields to fake them.
 *
 * Stable usage: every callback may safely be called from inside a React
 * event handler / R3F event. Implementations should already be wrapped
 * in `useCallback` (or equivalent) so the canvas's effects don't churn.
 */

import type { SceneCommand } from '@officexr/world/scenes';
import type { WorldObjects } from '@officexr/sdk';
import type { Tool } from './tools.ts';

export interface SceneEditorBackend {
  // -------------------------------------------------------------------------
  // Rendering / selection state
  // -------------------------------------------------------------------------

  /** Compiled snapshot of the scene to render. */
  compiled: WorldObjects;
  /** Currently-selected source command ids (multi-select). */
  selection: ReadonlySet<string>;
  /** Active editor tool — determines what a left-click does. */
  tool: Tool;
  /** Kind id staged for the Add / Tile tools (palette selection). */
  stagedKindId: string | null;
  /** Integer voxel Y the Add-tool floor picker sits at. */
  buildHeight: number;

  // -------------------------------------------------------------------------
  // Group lookup tables (derived from doc.groups)
  // -------------------------------------------------------------------------

  /** commandId → groupId (if the command is in a group). */
  commandToGroup: ReadonlyMap<string, string>;
  /** groupId → ordered commandIds in the group. */
  groupMembers: ReadonlyMap<string, readonly string[]>;

  // -------------------------------------------------------------------------
  // Document (narrowed)
  // -------------------------------------------------------------------------

  /**
   * Read-only view of the document. The canvas only consults
   * `doc.commands` (in the move-tool occupancy / delta computation).
   * Concrete document hooks expose their richer document elsewhere.
   */
  doc: { commands: readonly SceneCommand[] };

  // -------------------------------------------------------------------------
  // Optional baked layout (rendered behind the live commands)
  // -------------------------------------------------------------------------

  /** URL of the pre-baked layout GLB for this room's structural base.
   *  Requires `bakedLayoutName`. Optional — Layouts don't have a base. */
  bakedLayoutPath?: string;
  /** Layout name for cache-busting via BakeRegistry. */
  bakedLayoutName?: string;

  // -------------------------------------------------------------------------
  // Placement callbacks
  // -------------------------------------------------------------------------

  /** Place a single cube at an integer voxel position. */
  onPlaceAt(position: [number, number, number]): void;
  /** Batch-place N cubes. If `groupId` is provided, all are added to
   *  that group. Returns the new commandIds in insertion order. */
  onPlaceMany(
    kindId: string,
    positions: ReadonlyArray<[number, number, number]>,
    groupId?: string | null,
  ): string[];

  // -------------------------------------------------------------------------
  // Selection / deletion
  // -------------------------------------------------------------------------

  /** Click on an existing cube with the Select tool. `modKey` is true
   *  when Ctrl/Cmd was held — caller maps that to toggle vs. replace. */
  onSelectInstance(commandId: string, modKey: boolean): void;
  /** Delete a command (cascades through its group if any). */
  onDeleteCommand(commandId: string): void;
  /** Click on empty floor — deselects in the Room editor; document
   *  hooks may interpret it differently. */
  onClickEmpty(): void;

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------

  /** Create a new group containing `commandIds`. Returns the new
   *  groupId, or `null` if grouping isn't supported by this backend. */
  onCreateGroup(commandIds: Iterable<string>): string | null;

  // -------------------------------------------------------------------------
  // Tool state
  // -------------------------------------------------------------------------

  /** External tool-state setter. Tile tool returns to Select on
   *  click 4 / Esc; the canvas owns the state machine but `tool`
   *  itself lives in the parent. */
  onSetTool(tool: Tool): void;

  // -------------------------------------------------------------------------
  // UI interaction
  // -------------------------------------------------------------------------

  /** Right-click — open the context menu. `commandId` is null when
   *  the click missed every cube. */
  onContextMenuRequest(
    commandId: string | null,
    screenX: number,
    screenY: number,
  ): void;

  /** Move-tool batched position update — one history action per drag. */
  onMoveSelection(
    moves: ReadonlyArray<{
      commandId: string;
      position: [number, number, number];
    }>,
  ): void;
}
