import type { PlayerId, PlayerState, VoiceZone } from '@officexr/sdk';
import { characterHeight, drawCharacter, drawNameTag } from './topDownCharacter.ts';
import type { MotionSample } from './topDownMotion.ts';
import { fillEllipse, inset, intersects, roundedRectPath, type Rect, type TopDownContext } from './topDownPaint.ts';
import { ARCHETYPE_STYLES, ELEVATION, workstation, type ItemGeometry } from './topDownPainters.ts';
import type { Facing, SpriteSource } from './sprites.ts';
import { PALETTE, ZONE_EDGES, ZONE_TINTS } from './topDownPalette.ts';
import { hashString, type SceneItem, type Side, type TopDownScene } from './topDownScene.ts';
import { worldToScreen, type TopDownTransform, type XZ, type XZBounds } from './topDownGeometry.ts';

export type { TopDownContext } from './topDownPaint.ts';

export interface ProximityRings {
  inner: number;
  outer: number;
}

/** A claimed desk's area and the name to show on it. */
export interface DeskLabel extends XZBounds {
  owner: string;
}

/** Everything one frame of the 2D view draws. */
export interface TopDownFrame {
  t: TopDownTransform;
  size: { width: number; height: number };
  timeSec: number;
  scene: TopDownScene;
  /** Voice zones that aren't desk areas: tinted and labelled like team areas. */
  zones: readonly VoiceZone[];
  desks: readonly DeskLabel[];
  players: Readonly<Record<PlayerId, PlayerState>>;
  motion: (id: PlayerId) => MotionSample;
  /** Baked art; anything it can't supply (yet) falls back to the procedural painters. */
  sprites: SpriteSource;
  selfId: PlayerId;
  hoveredId: PlayerId | null;
  rings: ProximityRings;
  /** Where a click sent you, until you get there. */
  destination: XZ | null;
}

type Layer = (ctx: TopDownContext, f: TopDownFrame) => void;

/** Drawn this far outside the viewport, so tall items and tags don't pop at the edges. */
const CULL_MARGIN_PX = 120;
/** Others' name tags show from this zoom up; below it they would pile on top of each other. */
const TAGS_MIN_ZOOM = 18;
/** Desk owner labels show from this zoom up. */
const DESK_LABELS_MIN_ZOOM = 30;
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif';
const LABEL_FONT = `600 12px ${SYSTEM_FONT}`;
const SMALL_LABEL_FONT = `600 10px ${SYSTEM_FONT}`;

const viewport = (f: TopDownFrame): Rect => ({
  x: -CULL_MARGIN_PX,
  y: -CULL_MARGIN_PX,
  w: f.size.width + 2 * CULL_MARGIN_PX,
  h: f.size.height + 2 * CULL_MARGIN_PX,
});

export function screenRect(t: TopDownTransform, b: XZBounds): Rect {
  const a = worldToScreen(t, b.min);
  const c = worldToScreen(t, b.max);
  return { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y };
}

/** Where an item lands in the three-quarter view: its footprint, lifted top and exposed south face. */
export function itemGeometry(item: SceneItem, t: TopDownTransform): ItemGeometry {
  const px = t.scale;
  const floor = screenRect(t, item);
  const visibleHeight = Math.min(Math.max(item.maxY - item.minY, 0), ARCHETYPE_STYLES[item.archetype].maxHeightM);
  const base = Math.max(item.minY, 0) * px * ELEVATION;
  const lift = base + visibleHeight * px * ELEVATION;
  return {
    floor,
    top: { ...floor, y: floor.y - lift },
    front: { x: floor.x, y: floor.y + floor.h - lift, w: floor.w, h: lift - base },
    px,
  };
}

/**
 * One item: its baked sprite, footprint corner on the footprint corner, when it has one; its
 * archetype's painter otherwise. A desk with chairs pulled up gets a workstation per chair on top.
 */
function paintItem(ctx: TopDownContext, item: SceneItem, g: ItemGeometry, t: TopDownTransform, sprites: SpriteSource): void {
  const sprite = sprites.kind(item.kindId, item.yawDeg);
  if (!sprite) {
    ARCHETYPE_STYLES[item.archetype].paint({ ctx, item, g });
    return;
  }
  const { image, frame, ppm } = sprite;
  const s = t.scale / ppm;
  const base = Math.max(item.minY, 0) * t.scale * ELEVATION;
  ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, g.floor.x - frame.ax * s, g.floor.y - base - frame.ay * s, frame.w * s, frame.h * s);
  if (item.archetype === 'desk' && item.seats.length > 0) {
    // The model's real top, not the painter's capped one.
    const lift = base + (item.maxY - Math.max(item.minY, 0)) * t.scale * ELEVATION;
    const top = inset({ ...g.floor, y: g.floor.y - lift }, t.scale * 0.06);
    item.seats.forEach((seat) => workstation(ctx, top, seat, t.scale));
  }
}

const onScreen = (g: ItemGeometry, view: Rect) =>
  intersects({ x: g.top.x, y: g.top.y, w: g.floor.w, h: g.floor.y + g.floor.h - g.top.y }, view);

/** Grid lines every metre across `r`, aligned to world metres. */
function gridLines(ctx: TopDownContext, r: Rect, stepX: number, stepY: number): void {
  const phase = (v: number, step: number) => ((v % step) + step) % step;
  ctx.beginPath();
  for (let x = r.x - phase(r.x, stepX); x <= r.x + r.w; x += stepX) {
    ctx.moveTo(Math.round(x) + 0.5, r.y);
    ctx.lineTo(Math.round(x) + 0.5, r.y + r.h);
  }
  for (let y = r.y - phase(r.y, stepY); y <= r.y + r.h; y += stepY) {
    ctx.moveTo(r.x, Math.round(y) + 0.5);
    ctx.lineTo(r.x + r.w, Math.round(y) + 0.5);
  }
  ctx.stroke();
}

const drawGround: Layer = (ctx, f) => {
  ctx.fillStyle = PALETTE.lawn;
  ctx.fillRect(0, 0, f.size.width, f.size.height);
  const step = f.t.scale * 2;
  if (step >= 18) {
    ctx.strokeStyle = PALETTE.lawnLine;
    ctx.lineWidth = 1;
    const origin = worldToScreen(f.t, { x: 0, z: 0 });
    gridLines(ctx, { x: origin.x - Math.ceil(origin.x / step) * step, y: origin.y - Math.ceil(origin.y / step) * step, w: f.size.width + 2 * step, h: f.size.height + 2 * step }, step, step);
  }
};

const paintFlat = (match: (item: SceneItem, f: TopDownFrame) => boolean): Layer => (ctx, f) => {
  const view = viewport(f);
  for (const item of f.scene.floors) {
    if (!match(item, f)) {
      continue;
    }
    const g = itemGeometry(item, f.t);
    if (intersects(g.floor, view)) {
      paintItem(ctx, item, g, f.t, f.sprites);
    }
  }
};

/** The walkable office: warm planks in staggered rows, with a soft edge so the building reads. */
const drawFootprint: Layer = (ctx, f) => {
  const px = f.t.scale;
  for (const rect of f.scene.footprint) {
    const r = screenRect(f.t, rect);
    if (!intersects(r, viewport(f))) {
      continue;
    }
    ctx.fillStyle = PALETTE.planks;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (px >= 14) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      const rowH = px * 0.5;
      const plank = px * 2;
      ctx.strokeStyle = PALETTE.plankLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const firstRow = Math.floor(rect.min.z / 0.5);
      for (let row = firstRow, y = worldToScreen(f.t, { x: 0, z: row * 0.5 }).y; y <= r.y + r.h; row++, y += rowH) {
        if (y + rowH < 0 || y > f.size.height) {
          continue;
        }
        ctx.moveTo(r.x, Math.round(y) + 0.5);
        ctx.lineTo(r.x + r.w, Math.round(y) + 0.5);
        // Seams stagger by half a plank on alternate rows.
        const shift = (row & 1) * plank * 0.5;
        const startX = worldToScreen(f.t, { x: Math.floor(rect.min.x / 2) * 2, z: 0 }).x + shift - plank;
        for (let x = startX; x <= r.x + r.w; x += plank) {
          if (x >= r.x && x >= -1 && x <= f.size.width + 1) {
            ctx.moveTo(Math.round(x) + 0.5, y);
            ctx.lineTo(Math.round(x) + 0.5, y + rowH);
          }
        }
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = PALETTE.footprintEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
  }
};

const zoneStyle = (zone: VoiceZone) => {
  const i = hashString(zone.id) % ZONE_TINTS.length;
  return { tint: ZONE_TINTS[i], edge: ZONE_EDGES[i] };
};

const drawZones: Layer = (ctx, f) => {
  const view = viewport(f);
  for (const zone of f.zones) {
    const r = screenRect(f.t, zone);
    if (!intersects(r, view)) {
      continue;
    }
    const { tint, edge } = zoneStyle(zone);
    ctx.fillStyle = tint;
    ctx.beginPath();
    roundedRectPath(ctx, r, Math.min(8, f.t.scale * 0.2));
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
};

const drawShadows: Layer = (ctx, f) => {
  const view = viewport(f);
  const off = Math.max(1.5, f.t.scale * 0.06);
  ctx.fillStyle = PALETTE.shadow;
  for (const item of f.scene.items) {
    const shape = ARCHETYPE_STYLES[item.archetype].shadow;
    if (!shape || item.minY > 0.3) {
      continue;
    }
    const r = screenRect(f.t, item);
    if (!intersects(r, view)) {
      continue;
    }
    ctx.beginPath();
    if (shape === 'round') {
      const radius = Math.min(r.w, r.h) * 0.42;
      ctx.ellipse(r.x + r.w / 2 + off, r.y + r.h / 2 + off, radius, radius * 0.6, 0, 0, Math.PI * 2);
    } else if (f.sprites.kind(item.kindId, item.yawDeg)) {
      // Baked art has its own silhouette (round tables, couches); a soft contact ellipse suits any of them.
      ctx.ellipse(r.x + r.w / 2 + off, r.y + r.h / 2 + off * 1.5, r.w * 0.5, r.h * 0.46, 0, 0, Math.PI * 2);
    } else {
      roundedRectPath(ctx, { x: r.x + off, y: r.y + off * 1.5, w: r.w, h: r.h }, Math.min(r.w, r.h) * 0.2);
    }
    ctx.fill();
  }
};

const drawProximity: Layer = (ctx, f) => {
  const self = f.players[f.selfId];
  if (!self) {
    return;
  }
  const c = worldToScreen(f.t, self.pos);
  ctx.fillStyle = 'rgba(0, 122, 255, 0.06)';
  ctx.strokeStyle = 'rgba(0, 122, 255, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, f.rings.inner * f.t.scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0, 122, 255, 0.22)';
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(c.x, c.y, f.rings.outer * f.t.scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
};

const drawDestination: Layer = (ctx, f) => {
  if (!f.destination) {
    return;
  }
  const c = worldToScreen(f.t, f.destination);
  const pulse = (f.timeSec * 1.6) % 1;
  const base = Math.max(6, f.t.scale * 0.2);
  ctx.strokeStyle = PALETTE.destination;
  ctx.globalAlpha = 1 - pulse;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, base * (1 + pulse), base * 0.55 * (1 + pulse), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  fillEllipse(ctx, c.x, c.y, base * 0.45, base * 0.25, PALETTE.destination);
};

type Drawable = { depth: number; draw: () => void };

/**
 * Everyone draws by where they stand, except a seated player, who draws against their seat:
 * behind it when its backrest faces the viewer (so the backrest hides their lower half, as
 * Gather's foreground layer does), in front of it otherwise.
 */
function playerDepth(p: PlayerState, scene: TopDownScene): number {
  const seat = p.seat ? scene.byId.get(p.seat) : undefined;
  if (!seat) {
    return p.pos.z;
  }
  const depth = seat.max.z + seat.minY;
  return seat.back === 's' ? depth - 1e-3 : depth + 1e-3;
}

/** A seated character sits on the seat cushion, above the floor. */
const SEAT_LIFT_M = 0.1;

/** Pixels a player stands above the floor: on a raised floor (their height), or on a seat cushion. */
function standingLift(p: PlayerState, px: number): number {
  return (Math.max(p.pos.y, 0) + (p.seat ? SEAT_LIFT_M : 0)) * px * ELEVATION;
}

/** Seated, you face away from the backrest. */
const FACING_FROM_BACKREST: Record<Side, Facing> = { n: 'down', s: 'up', w: 'right', e: 'left' };

/** Furniture and characters back to front, so whoever stands south of a desk hides its front. */
const drawStanding: Layer = (ctx, f) => {
  const view = viewport(f);
  const drawables: Drawable[] = [];
  for (const item of f.scene.items) {
    const g = itemGeometry(item, f.t);
    if (onScreen(g, view)) {
      // Something resting on another item (a monitor on a desk) draws after its support.
      drawables.push({ depth: item.max.z + item.minY, draw: () => paintItem(ctx, item, g, f.t, f.sprites) });
    }
  }
  for (const [id, p] of Object.entries(f.players)) {
    const c = worldToScreen(f.t, p.pos);
    if (c.x < view.x || c.x > view.x + view.w || c.y < view.y || c.y > view.y + view.h) {
      continue;
    }
    const lift = standingLift(p, f.t.scale);
    const backrest = p.seat ? f.scene.byId.get(p.seat)?.back : null;
    drawables.push({
      depth: playerDepth(p, f.scene),
      draw: () =>
        drawCharacter(ctx, {
          player: p,
          sprite: f.sprites.character(p.avatar.model, id),
          facing: backrest ? FACING_FROM_BACKREST[backrest] : undefined,
          x: c.x,
          y: c.y - lift,
          px: f.t.scale,
          motion: f.motion(id),
          isSelf: id === f.selfId,
          hovered: id === f.hoveredId,
          timeSec: f.timeSec,
        }),
    });
  }
  drawables.sort((a, b) => a.depth - b.depth).forEach((d) => d.draw());
};

/** A rounded label centred on `x`, its top at `y`. */
function pill(ctx: TopDownContext, text: string, x: number, y: number, font: string, height: number): void {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + height;
  ctx.fillStyle = PALETTE.zoneLabel;
  ctx.beginPath();
  roundedRectPath(ctx, { x: x - w / 2, y, w, h: height }, height / 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.zoneLabelText;
  ctx.fillText(text, x, y + height / 2 + 0.5);
}

const drawZoneLabels: Layer = (ctx, f) => {
  const view = viewport(f);
  for (const zone of f.zones) {
    const r = screenRect(f.t, zone);
    if (zone.label && intersects(r, view) && r.w > 60) {
      pill(ctx, zone.label, r.x + r.w / 2, r.y + 8, LABEL_FONT, 22);
    }
  }
  if (f.t.scale < DESK_LABELS_MIN_ZOOM) {
    return;
  }
  for (const desk of f.desks) {
    const r = screenRect(f.t, desk);
    if (intersects(r, view)) {
      pill(ctx, `${desk.owner}'s desk`, r.x + r.w / 2, r.y + r.h - 20, SMALL_LABEL_FONT, 16);
    }
  }
};

/** Name tags float over everything; nearer (lower) tags draw last. */
const drawNameTags: Layer = (ctx, f) => {
  const H = characterHeight(f.t.scale);
  const showAll = f.t.scale >= TAGS_MIN_ZOOM;
  const tags = Object.entries(f.players)
    .filter(([id, p]) => showAll || id === f.selfId || id === f.hoveredId || p.mic === 'speaking')
    .map(([id, p]) => {
      const c = worldToScreen(f.t, p.pos);
      const lift = standingLift(p, f.t.scale);
      return { id, p, x: c.x, bottom: c.y - lift - H - 4 };
    })
    .filter((tag) => tag.x > -CULL_MARGIN_PX && tag.x < f.size.width + CULL_MARGIN_PX && tag.bottom > -20 && tag.bottom < f.size.height + H)
    .sort((a, b) => a.bottom - b.bottom);
  for (const { id, p, x, bottom } of tags) {
    drawNameTag(ctx, { text: p.name || 'Joining…', status: p.status, isSelf: id === f.selfId }, x, bottom);
  }
};

/** Back to front. Each layer is one concern; add a layer rather than growing one. */
export const LAYERS: readonly Layer[] = [
  drawGround,
  // Plain structural floors go under the office planks; floors with baked art (a kitchen's tiles) and rugs go over them.
  paintFlat((item, f) => item.archetype === 'floor' && !f.sprites.kind(item.kindId, item.yawDeg)),
  drawFootprint,
  paintFlat((item, f) => item.archetype !== 'floor' || f.sprites.kind(item.kindId, item.yawDeg) !== null),
  drawZones,
  drawShadows,
  drawProximity,
  drawDestination,
  drawStanding,
  drawZoneLabels,
  drawNameTags,
];

export function drawFrame(ctx: TopDownContext, frame: TopDownFrame): void {
  for (const layer of LAYERS) {
    layer(ctx, frame);
  }
}
