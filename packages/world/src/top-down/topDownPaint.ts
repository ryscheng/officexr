/** The subset of `CanvasRenderingContext2D` the 2D view draws with, so tests can record calls. */
export type TopDownContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'globalAlpha'
  | 'setLineDash'
  | 'setTransform'
  | 'save'
  | 'restore'
  | 'clip'
  | 'rect'
  | 'fillRect'
  | 'strokeRect'
  | 'beginPath'
  | 'closePath'
  | 'arc'
  | 'arcTo'
  | 'ellipse'
  | 'moveTo'
  | 'lineTo'
  | 'fill'
  | 'stroke'
  | 'fillText'
  | 'measureText'
  | 'drawImage'
>;

/** A screen rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Adds a rounded rectangle to the current path; the radius shrinks to fit small rects. */
export function roundedRectPath(ctx: TopDownContext, r: Rect, radius: number): void {
  const k = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.moveTo(r.x + k, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, k);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, k);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, k);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, k);
  ctx.closePath();
}

export function fillRounded(ctx: TopDownContext, r: Rect, radius: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  roundedRectPath(ctx, r, radius);
  ctx.fill();
}

export function fillEllipse(ctx: TopDownContext, cx: number, cy: number, rx: number, ry: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 0), Math.max(ry, 0), 0, 0, Math.PI * 2);
  ctx.fill();
}

export function inset(r: Rect, by: number): Rect {
  const dx = Math.min(by, r.w / 2);
  const dy = Math.min(by, r.h / 2);
  return { x: r.x + dx, y: r.y + dy, w: r.w - 2 * dx, h: r.h - 2 * dy };
}

/** Whether two screen rects overlap. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Picks from `options` by `seed`, so one instance always gets the same one. */
export function pick<T>(options: readonly T[], seed: number): T {
  return options[seed % options.length];
}
