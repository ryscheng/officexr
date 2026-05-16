/**
 * Editor tool kinds. The active tool determines what hover + click in
 * the canvas do.
 *
 *   - **select** (default): click an existing cube to select its
 *     command. Ctrl/Cmd-click toggles multi-select. Empty click
 *     deselects. Right-drag orbits the camera.
 *   - **add**: hovering over the floor or an existing cube's face
 *     shows a 50%-transparent ghost cube at the snap target. Click
 *     to commit. Tool stays sticky so the user can keep placing
 *     cubes; Esc returns to Select.
 *   - **delete**: hovering over a cube (or any group member) shows a
 *     PULSING (25%–75% opacity) overlay over the cube AND every
 *     other cube in its group. Click deletes the whole group
 *     atomically. Esc returns to Select.
 *   - **tile**: Task 9 — rectangular tile-tool state machine (4
 *     stages: idle → placed → x-extruded → z-extruded → committed).
 *     Disabled in the toolbar until Task 9 lands.
 */
export type Tool = 'select' | 'add' | 'delete' | 'tile' | 'move';

export const TOOLS: ReadonlyArray<{
  tool: Tool;
  label: string;
  description: string;
  /** Keyboard shortcut (single key, case-insensitive). */
  shortcut?: string;
  /** Set when the tool isn't ready for use yet — Toolbar disables
   * the button + shows a "coming soon" tooltip. */
  comingSoon?: boolean;
}> = [
  {
    tool: 'select',
    label: 'Select',
    description: 'Click cubes to select (default). Ctrl/Cmd-click to multi-select.',
    shortcut: 'V',
  },
  {
    tool: 'add',
    label: 'Add',
    description: 'Click to place the staged cube. Q/E lower/raise build height.',
    shortcut: 'B',
  },
  {
    tool: 'delete',
    label: 'Delete',
    description: 'Click a cube to delete it (deletes the whole group if grouped).',
    shortcut: 'X',
  },
  {
    tool: 'tile',
    label: 'Tile',
    description:
      'Place a rectangular tile of cubes. Click 1: origin. Click 2: X row. Click 3: Z grid. Click 4: Y stack. Esc to stop.',
    shortcut: 'T',
  },
  {
    tool: 'move',
    label: 'Move',
    description: 'Drag selected objects to move them. Snap to voxel grid on release. Shift = Y-axis.',
    shortcut: 'M',
  },
];
