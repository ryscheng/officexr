import type { FootprintRect, PlayerId, PlayerState } from '@officexr/sdk';
import { worldToScreen, type TopDownTransform, type XZBounds } from './topDownGeometry.ts';

export interface MapBox extends XZBounds {
  /** Walls and floors, as opposed to furniture. */
  layout: boolean;
}

export interface ProximityRings {
  inner: number;
  outer: number;
}

/** The subset of `CanvasRenderingContext2D` the draw functions use, so tests can record calls. */
export type TopDownContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'setLineDash'
  | 'fillRect'
  | 'strokeRect'
  | 'beginPath'
  | 'arc'
  | 'moveTo'
  | 'lineTo'
  | 'fill'
  | 'stroke'
  | 'fillText'
>;

export const STYLE = {
  background: '#f4f4f5',
  layoutFill: '#a1a1aa',
  furnitureFill: '#fcd34d',
  furnitureStroke: '#b45309',
  footprintStroke: '#2563eb',
  player3d: '#16a34a',
  player2d: '#9333ea',
  self: '#dc2626',
  label: '#18181b',
  ring: '#dc2626',
} as const;

export const PLAYER_RADIUS_PX = 6;
const FACING_TICK_PX = 12;

export function drawMap(
  ctx: TopDownContext,
  t: TopDownTransform,
  size: { width: number; height: number },
  boxes: readonly MapBox[],
  footprint: readonly FootprintRect[],
): void {
  ctx.fillStyle = STYLE.background;
  ctx.fillRect(0, 0, size.width, size.height);
  // Layout first so furniture sits on top of floors.
  for (const box of [...boxes].sort((a, b) => Number(b.layout) - Number(a.layout))) {
    const a = worldToScreen(t, box.min);
    const b = worldToScreen(t, box.max);
    ctx.fillStyle = box.layout ? STYLE.layoutFill : STYLE.furnitureFill;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    if (!box.layout) {
      ctx.strokeStyle = STYLE.furnitureStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
  }
  ctx.strokeStyle = STYLE.footprintStroke;
  ctx.lineWidth = 2;
  for (const rect of footprint) {
    const a = worldToScreen(t, rect.min);
    const b = worldToScreen(t, rect.max);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }
}

export function drawPlayers(
  ctx: TopDownContext,
  t: TopDownTransform,
  players: Readonly<Record<PlayerId, PlayerState>>,
  selfId: PlayerId,
  rings: ProximityRings,
): void {
  const self = players[selfId];
  if (self) {
    const c = worldToScreen(t, self.pos);
    ctx.strokeStyle = STYLE.ring;
    ctx.lineWidth = 1;
    for (const [radius, dash] of [
      [rings.inner, []],
      [rings.outer, [4, 4]],
    ] as const) {
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius * t.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  for (const [id, p] of Object.entries(players)) {
    const c = worldToScreen(t, p.pos);
    const is2d = p.avatar.viewMode === '2d';
    ctx.fillStyle = id === selfId ? STYLE.self : is2d ? STYLE.player2d : STYLE.player3d;
    ctx.beginPath();
    ctx.arc(c.x, c.y, PLAYER_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();
    if (is2d) {
      ctx.strokeStyle = STYLE.label;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Yaw 0 faces -Z (screen up), positive turns counter-clockwise.
    ctx.strokeStyle = STYLE.label;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x - Math.sin(p.yaw) * FACING_TICK_PX, c.y - Math.cos(p.yaw) * FACING_TICK_PX);
    ctx.stroke();
    ctx.fillStyle = STYLE.label;
    ctx.fillText(p.name, c.x, c.y - PLAYER_RADIUS_PX - 4);
  }
}
