/**
 * Tool kinds for the Map editor. The active tool decides what
 * hover/click in the canvas mean:
 *
 *   - **select** (default): click a room or spawn marker to select
 *     it. Click empty floor to deselect. Drag does nothing (camera
 *     orbit / pan continue to work via right-drag and WASD).
 *   - **move**: drag a room to reposition it. The room's voxel AABB
 *     snaps to nearby rooms' AABBs (face-to-face flush, or
 *     co-planar wall alignment) within a small threshold; otherwise
 *     it snaps to the voxel grid. Clicking an unselected room
 *     auto-selects + starts the drag in one gesture.
 *   - **spawn**: click on a room cube or a room's baked-layout
 *     surface to drop a SpawnPoint at the raycast hit. Empty-ground
 *     clicks are ignored — spawns only land on a room surface.
 *
 * Kept deliberately narrower than `scene-editor/tools.ts` (which has
 * `add`, `delete`, `tile`, etc.) — the Map editor composes whole
 * rooms, not individual cubes, so the tool surface is different.
 */
export type MapTool = 'select' | 'move' | 'spawn';

export interface MapToolDef {
  tool: MapTool;
  label: string;
  description: string;
  /** Single-key shortcut (case-insensitive). */
  shortcut: string;
}

export const MAP_TOOLS: readonly MapToolDef[] = [
  {
    tool: 'select',
    label: 'Select',
    description: 'Click a room or spawn marker to select it.',
    shortcut: 'V',
  },
  {
    tool: 'move',
    label: 'Move',
    description:
      'Drag a room to move it. Snaps to other rooms’ edges within 2 voxels.',
    shortcut: 'M',
  },
  {
    tool: 'spawn',
    label: 'Spawn',
    description:
      'Click a room surface to drop a spawn point. Empty ground is ignored.',
    shortcut: 'P',
  },
];
