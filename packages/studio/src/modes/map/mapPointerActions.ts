import type { MapTool } from './mapTools.ts';

/**
 * What a left-pointer-down on a room should do, given the active tool.
 *
 *   - `place-spawn`  — Spawn tool: drop a spawn at the raycast hit.
 *   - `select`       — Select tool: select the room, no drag.
 *   - `select-drag`  — Move tool: select the room AND begin a drag.
 *
 * IMPORTANT (taxonomy F regression guard): this decision depends ONLY
 * on the active tool. It deliberately does NOT branch on the hit mesh's
 * `userData` (e.g. `isObjectInstanceMesh`). That gate was the c606f10
 * regression — once rooms started rendering a `BakedLayout` mesh in
 * front of the raw cubes, the flag-gated handler early-returned on the
 * baked-layout hit and silently broke drag + spawn. Routing purely off
 * the tool means any descendant of the room group (cube OR baked
 * layout) behaves identically.
 */
export type RoomPointerAction = 'place-spawn' | 'select' | 'select-drag';

export function resolveRoomPointerAction(tool: MapTool): RoomPointerAction {
  switch (tool) {
    case 'spawn':
      return 'place-spawn';
    case 'move':
      return 'select-drag';
    case 'select':
      return 'select';
  }
}
