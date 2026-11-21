export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type HintSide = 'above' | 'below' | 'left' | 'left-top';
export type HintArrow = { side: 'down' | 'up' | 'right'; offset: number };
export type HintPlacement = { left: number; top: number; arrow: HintArrow | null; maxWidth: number };

export const HINT_GAP = 12;
export const HINT_MAX_WIDTH = 240;
const MIN_WIDTH = 120;
const ARROW_INSET = 28;
const ARROW_EDGE = 16;
const NAME_CHIP_CENTRE = 12;

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));
const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;

export function middleThird(viewport: Size): Rect {
  return { left: viewport.width / 3, top: viewport.height / 3, width: viewport.width / 3, height: viewport.height / 3 };
}

// A plate flush right that would reach into a `keepClear` box, such as the middle third or the joystick, gets narrower instead.
export function placeHint({
  anchor,
  size,
  bounds,
  keepClear,
  side,
  align = 'start',
  pointAt,
  clearBelow,
}: {
  anchor: Rect;
  size: Size;
  bounds: Rect;
  keepClear: Rect[];
  side: HintSide;
  align?: 'start' | 'end';
  pointAt?: number;
  clearBelow?: number;
}): HintPlacement {
  if (side === 'left' || side === 'left-top') {
    const maxWidth = clamp(anchor.left - HINT_GAP - bounds.left, MIN_WIDTH, HINT_MAX_WIDTH);
    const width = Math.min(size.width, maxWidth);
    const centred = anchor.top + anchor.height / 2 - size.height / 2;
    const top = clamp(side === 'left' ? centred : anchor.top, bounds.top, bottom(bounds) - size.height);
    const target = side === 'left' ? anchor.top + anchor.height / 2 : anchor.top + NAME_CHIP_CENTRE;
    return { left: Math.max(bounds.left, anchor.left - HINT_GAP - width), top, arrow: { side: 'right', offset: clamp(target - top, ARROW_EDGE, size.height - ARROW_EDGE) }, maxWidth };
  }
  const top = side === 'above' ? anchor.top - HINT_GAP - size.height : Math.max(bottom(anchor) + HINT_GAP, clearBelow ?? 0);
  const rooms = keepClear
    .filter((box) => top < bottom(box) && top + size.height > box.top && right(box) < right(bounds))
    .map((box) => right(bounds) - right(box));
  const room = Math.min(...rooms);
  const maxWidth = align === 'end' && rooms.length > 0 && room >= MIN_WIDTH ? Math.min(room, HINT_MAX_WIDTH) : HINT_MAX_WIDTH;
  const width = Math.min(size.width, maxWidth);
  const cx = pointAt ?? anchor.left + anchor.width / 2;
  const left = align === 'end' ? right(bounds) - width : clamp(cx - ARROW_INSET, bounds.left, right(bounds) - width);
  const offset = clamp(cx - left, ARROW_EDGE, width - ARROW_EDGE);
  return { left, top, arrow: { side: side === 'above' ? 'down' : 'up', offset }, maxWidth };
}
