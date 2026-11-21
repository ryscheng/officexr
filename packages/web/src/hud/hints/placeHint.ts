export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type HintSide = 'above' | 'below' | 'left';
export type HintArrow = { side: 'down' | 'up' | 'right'; offset: number };
export type HintPlacement = { left: number; top: number; arrow: HintArrow | null };

export const HINT_GAP = 12;
export const HINT_MARGIN = 16;
const ARROW_INSET = 28;
const ARROW_EDGE = 16;

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

export function placeHint({
  anchor,
  size,
  viewport,
  side,
  align = 'start',
  pointAt,
  clearBelow,
}: {
  anchor: Rect;
  size: Size;
  viewport: Size;
  side: HintSide;
  align?: 'start' | 'end';
  pointAt?: number;
  clearBelow?: number;
}): HintPlacement {
  if (side === 'left') {
    const top = clamp(anchor.top + anchor.height / 2 - size.height / 2, HINT_MARGIN, viewport.height - HINT_MARGIN - size.height);
    return { left: Math.max(HINT_MARGIN, anchor.left - HINT_GAP - size.width), top, arrow: { side: 'right', offset: anchor.top + anchor.height / 2 - top } };
  }
  const cx = pointAt ?? anchor.left + anchor.width / 2;
  const preferred = align === 'end' ? cx + ARROW_INSET - size.width : cx - ARROW_INSET;
  const left = clamp(preferred, HINT_MARGIN, viewport.width - HINT_MARGIN - size.width);
  const offset = clamp(cx - left, ARROW_EDGE, size.width - ARROW_EDGE);
  if (side === 'above') {
    return { left, top: anchor.top - HINT_GAP - size.height, arrow: { side: 'down', offset } };
  }
  return { left, top: Math.max(anchor.top + anchor.height + HINT_GAP, clearBelow ?? 0), arrow: { side: 'up', offset } };
}
