import { assertNever } from '../../assertNever.ts';
import { snapDeskAreaBounds } from './deskAreaGeometry.ts';

type Point = { x: number; z: number };
type Bounds = NonNullable<ReturnType<typeof snapDeskAreaBounds>>;

export type DeskAreaDrag =
  | { type: 'idle' }
  | { type: 'dragging'; anchor: Point; draft: Bounds | null };

/** `point` is the floor hit under the cursor, or null when the ray misses the floor. */
export type DeskAreaDragEvent =
  | { type: 'down'; point: Point | null }
  | { type: 'move'; point: Point | null }
  | { type: 'up'; point: Point | null };

/** `commit` is set on release when the dragged rectangle has area. */
export function reduceDeskAreaDrag(
  drag: DeskAreaDrag,
  event: DeskAreaDragEvent,
): { drag: DeskAreaDrag; commit: Bounds | null } {
  switch (event.type) {
    case 'down':
      return {
        drag: event.point ? { type: 'dragging', anchor: event.point, draft: null } : drag,
        commit: null,
      };
    case 'move':
      return {
        drag:
          drag.type === 'dragging' && event.point
            ? { ...drag, draft: snapDeskAreaBounds(drag.anchor, event.point) }
            : drag,
        commit: null,
      };
    case 'up':
      return {
        drag: { type: 'idle' },
        commit:
          drag.type === 'dragging' && event.point
            ? snapDeskAreaBounds(drag.anchor, event.point)
            : null,
      };
    default:
      return assertNever(event);
  }
}
