import type { Archetype } from './furnitureArchetype.ts';
import { fillEllipse, fillRounded, inset, pick, type Rect, type TopDownContext } from './topDownPaint.ts';
import { BOOK_COLOURS, DECOR_COLOURS, PALETTE, RUG_COLOURS } from './topDownPalette.ts';
import type { DeskSeat, SceneItem, Side } from './topDownScene.ts';

/**
 * Screen pixels a metre of height lifts a surface, per pixel-per-metre of zoom: the
 * three-quarter view that shows a top face and the south face below it.
 */
export const ELEVATION = 0.6;

/** One item's screen geometry in the three-quarter view. */
export interface ItemGeometry {
  /** The item's footprint on the floor. */
  floor: Rect;
  /** The top face, lifted by the item's (capped) height. */
  top: Rect;
  /** The south face, from the lifted top down to where the item stands. */
  front: Rect;
  /** Pixels per metre. */
  px: number;
}

export interface PaintArgs {
  ctx: TopDownContext;
  item: SceneItem;
  g: ItemGeometry;
}

export interface ArchetypeStyle {
  /** Taller items are drawn as this tall, so walls and shelves don't swallow the room. */
  maxHeightM: number;
  /** The soft drop shadow it casts on the floor: its box, a round blot (plants, lamps), or none. */
  shadow: 'box' | 'round' | null;
  paint(args: PaintArgs): void;
}

/** A box: south face, then top face. */
function block(ctx: TopDownContext, g: ItemGeometry, top: string, front: string, radius = 0): void {
  if (g.front.h > 0.5) {
    fillRounded(ctx, { ...g.front, y: g.front.y - radius, h: g.front.h + radius }, radius, front);
  }
  fillRounded(ctx, g.top, radius, top);
}

/** A sub-rectangle of `r` hugging `side`, `thickness` deep. */
function edge(r: Rect, side: Side, thickness: number): Rect {
  const t = Math.min(thickness, side === 'n' || side === 's' ? r.h : r.w);
  switch (side) {
    case 'n':
      return { ...r, h: t };
    case 's':
      return { ...r, y: r.y + r.h - t, h: t };
    case 'w':
      return { ...r, w: t };
    case 'e':
      return { ...r, x: r.x + r.w - t, w: t };
  }
}

/** Lifts `r` by `by` pixels and adds the south face that lift exposes. */
function raised(ctx: TopDownContext, r: Rect, by: number, top: string, front: string, radius: number): void {
  fillRounded(ctx, { ...r, y: r.y - by + r.h - radius, h: by + radius }, radius, front);
  fillRounded(ctx, { ...r, y: r.y - by }, radius, top);
}

const opposite: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** A monitor (and keyboard) on a desk top for the chair at `seat`, screen towards the chair. */
export function workstation(ctx: TopDownContext, top: Rect, seat: DeskSeat, px: number): void {
  const horizontal = seat.side === 'n' || seat.side === 's';
  const span = horizontal ? top.h : top.w;
  // Single-sided desks put the screen near the far edge; double-sided ones leave the middle free.
  const reach = Math.min(span * 0.72, px * 0.55);
  const along = horizontal ? top.x + seat.t * top.w : top.y + seat.t * top.h;
  const width = Math.min(px * 0.5, (horizontal ? top.w : top.h) * 0.8);
  const depth = Math.max(px * 0.07, 2);
  const lift = px * 0.32 * ELEVATION;
  const keyboard = { w: Math.min(px * 0.36, width * 0.8), d: Math.max(px * 0.1, 2) };
  if (horizontal) {
    const fromSeat = seat.side === 'n' ? 1 : -1;
    const edgeY = seat.side === 'n' ? top.y : top.y + top.h;
    const screenY = edgeY + fromSeat * reach;
    const keyY = edgeY + fromSeat * Math.min(span * 0.25, px * 0.18);
    fillRounded(ctx, { x: along - keyboard.w / 2, y: keyY - keyboard.d / 2, w: keyboard.w, h: keyboard.d }, 1.5, PALETTE.keyboard);
    const panel = { x: along - width / 2, y: screenY - lift - depth / 2, w: width, h: lift + depth };
    if (seat.side === 's') {
      // Facing the viewer: a lit screen in a dark bezel.
      fillRounded(ctx, panel, 2, PALETTE.monitorFrame);
      fillRounded(ctx, inset(panel, Math.max(1, px * 0.025)), 1.5, PALETTE.monitorScreen);
      ctx.fillStyle = PALETTE.monitorGlow;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(panel.x + panel.w * 0.18, panel.y + panel.h * 0.3, panel.w * 0.4, Math.max(1, panel.h * 0.12));
      ctx.globalAlpha = 1;
    } else {
      fillRounded(ctx, panel, 2, PALETTE.monitorBack);
    }
  } else {
    const fromSeat = seat.side === 'w' ? 1 : -1;
    const edgeX = seat.side === 'w' ? top.x : top.x + top.w;
    const screenX = edgeX + fromSeat * reach;
    const keyX = edgeX + fromSeat * Math.min(span * 0.25, px * 0.18);
    fillRounded(ctx, { x: keyX - keyboard.d / 2, y: along - keyboard.w / 2, w: keyboard.d, h: keyboard.w }, 1.5, PALETTE.keyboard);
    // Side-on: a thin dark slab with a sliver of screen on the chair's side.
    const slab = { x: screenX - depth / 2, y: along - width / 2 - lift, w: depth, h: width + lift * 0.4 };
    fillRounded(ctx, slab, 1.5, PALETTE.monitorFrame);
    ctx.fillStyle = PALETTE.monitorScreen;
    ctx.fillRect(seat.side === 'w' ? slab.x - 1 : slab.x + slab.w, slab.y + 1, 1, slab.h - 2);
  }
}

const desk: ArchetypeStyle = {
  maxHeightM: 0.75,
  shadow: 'box',
  paint({ ctx, item, g }) {
    block(ctx, g, PALETTE.deskEdge, PALETTE.deskFront, 2);
    const top = inset(g.top, 1);
    fillRounded(ctx, top, 2, PALETTE.deskTop);
    const seats = item.seats.length > 0 ? item.seats : [{ side: g.top.w >= g.top.h ? 's' : 'e', t: 0.5 } as DeskSeat];
    seats.forEach((seat) => workstation(ctx, top, seat, g.px));
  },
};

const table: ArchetypeStyle = {
  maxHeightM: 0.75,
  shadow: 'box',
  paint({ ctx, item, g }) {
    const square = Math.abs(g.top.w - g.top.h) < g.px * 0.1 && g.top.w < g.px * 1.3;
    const top = item.wooden || item.seed % 2 === 0 ? PALETTE.woodTop : PALETTE.deskTop;
    const front = top === PALETTE.woodTop ? PALETTE.woodFront : PALETTE.deskFront;
    if (square) {
      // Small square tables read better round, like café tables.
      const cx = g.top.x + g.top.w / 2;
      const rx = g.top.w / 2;
      const ry = g.top.h / 2;
      fillEllipse(ctx, cx, g.top.y + ry + g.front.h * 0.5, rx, ry, front);
      ctx.fillRect(cx - rx, g.top.y + ry, rx * 2, g.front.h * 0.5);
      fillEllipse(ctx, cx, g.top.y + ry, rx, ry, top);
      return;
    }
    block(ctx, g, top, front, Math.max(2, g.px * 0.06));
    ctx.strokeStyle = top === PALETTE.woodTop ? PALETTE.woodHighlight : PALETTE.deskEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const r = inset(g.top, Math.max(2, g.px * 0.08));
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.stroke();
  },
};

/** A seat with a backrest on `item.back` (south when unoriented). */
function seat(ctx: TopDownContext, item: SceneItem, g: ItemGeometry, colours: { seat: string; back: string; front: string }, armrests: boolean): void {
  const side = item.back ?? 's';
  const radius = Math.max(2, g.px * 0.1);
  const backDepth = Math.max(2.5, Math.min(g.top.w, g.top.h) * 0.22);
  const backLift = g.px * (armrests ? 0.4 : 0.32) * ELEVATION;
  const backrest = () => raised(ctx, edge(g.top, side, backDepth), backLift, colours.back, colours.front, radius);
  // Whichever of seat and backrest is further south draws last.
  if (side === 'n') {
    backrest();
  }
  block(ctx, g, colours.seat, colours.front, radius);
  if (armrests) {
    const arms: Side[] = side === 'n' || side === 's' ? ['w', 'e'] : ['n', 's'];
    arms.forEach((arm) => raised(ctx, edge(g.top, arm, backDepth * 0.8), backLift * 0.5, colours.back, colours.front, radius));
  }
  if (side !== 'n') {
    backrest();
  }
}

const chair: ArchetypeStyle = {
  maxHeightM: 0.45,
  shadow: 'round',
  paint({ ctx, item, g }) {
    const colours = item.wooden
      ? { seat: PALETTE.woodTop, back: PALETTE.woodFront, front: PALETTE.shelfFront }
      : { seat: PALETTE.chairSeat, back: PALETTE.chairBack, front: PALETTE.chairFront };
    // Chair models fill their box loosely; a smaller seat reads as a chair, not a crate.
    const shrink = Math.min(g.top.w, g.top.h) * 0.18;
    const tight = { ...g, top: inset(g.top, shrink), front: { ...g.front, x: g.front.x + shrink, w: g.front.w - 2 * shrink } };
    seat(ctx, item, tight, colours, false);
  },
};

const sofa: ArchetypeStyle = {
  maxHeightM: 0.45,
  shadow: 'box',
  paint({ ctx, item, g }) {
    seat(ctx, item, g, { seat: PALETTE.sofaTop, back: PALETTE.sofaBack, front: PALETTE.sofaFront }, true);
    // Cushion seams across the long axis.
    const horizontal = g.top.w >= g.top.h;
    const cushions = Math.max(1, Math.round((horizontal ? g.top.w : g.top.h) / (g.px * 0.9)));
    ctx.strokeStyle = PALETTE.sofaSeam;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < cushions; i++) {
      if (horizontal) {
        const x = g.top.x + (g.top.w * i) / cushions;
        ctx.moveTo(x, g.top.y + g.top.h * 0.3);
        ctx.lineTo(x, g.top.y + g.top.h * 0.75);
      } else {
        const y = g.top.y + (g.top.h * i) / cushions;
        ctx.moveTo(g.top.x + g.top.w * 0.3, y);
        ctx.lineTo(g.top.x + g.top.w * 0.75, y);
      }
    }
    ctx.stroke();
  },
};

const bed: ArchetypeStyle = {
  maxHeightM: 0.5,
  shadow: 'box',
  paint({ ctx, item, g }) {
    block(ctx, g, PALETTE.bedFrame, PALETTE.woodFront, 3);
    const mattress = inset(g.top, Math.max(2, g.px * 0.06));
    fillRounded(ctx, mattress, 3, PALETTE.bedSheet);
    const head = item.back ?? 'n';
    fillRounded(ctx, inset(edge(mattress, head, Math.min(mattress.w, mattress.h) * 0.22), 2), 3, '#ffffff');
    fillRounded(ctx, edge(mattress, opposite[head], Math.max(mattress.w, mattress.h) * 0.55), 3, PALETTE.bedBlanket);
  },
};

const plant: ArchetypeStyle = {
  maxHeightM: 0.35,
  shadow: 'round',
  paint({ ctx, item, g }) {
    const cx = g.floor.x + g.floor.w / 2;
    const span = Math.min(g.floor.w, g.floor.h);
    const potW = Math.max(span * 0.55, 4);
    const pot = { x: cx - potW / 2, y: g.top.y + (g.top.h - potW * 0.6) / 2, w: potW, h: potW * 0.6 };
    raised(ctx, pot, Math.max(g.front.h * 0.6, 2), PALETTE.potTop, PALETTE.potFront, potW * 0.2);
    // Foliage: a seeded cluster of leaves over the pot, taller than its box like Gather's plants.
    const leafR = Math.max(span * 0.3, 3);
    const foliageY = pot.y - Math.max(g.front.h * 0.6, 2) - leafR * 0.4;
    const leaves = 5 + (item.seed % 3);
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + (item.seed % 7);
      const r = leafR * (0.55 + ((item.seed >> i) % 3) * 0.12);
      fillEllipse(ctx, cx + Math.cos(a) * leafR * 0.7, foliageY + Math.sin(a) * leafR * 0.45, r, r * 0.85, i % 2 ? PALETTE.leafLight : PALETTE.leafDark);
    }
    fillEllipse(ctx, cx, foliageY - leafR * 0.2, leafR * 0.7, leafR * 0.6, PALETTE.leafLight);
    fillEllipse(ctx, cx - leafR * 0.25, foliageY - leafR * 0.4, leafR * 0.22, leafR * 0.16, PALETTE.leafHighlight);
  },
};

const shelf: ArchetypeStyle = {
  maxHeightM: 1.6,
  shadow: 'box',
  paint({ ctx, item, g }) {
    block(ctx, g, PALETTE.shelfTop, PALETTE.shelfFront, 1);
    if (g.front.h < 8 || g.front.w < 6) {
      return;
    }
    // The south face shows the shelves: boards, and a row of books on each.
    const rows = Math.max(1, Math.min(4, Math.floor(g.front.h / 10)));
    const rowH = g.front.h / rows;
    const pad = Math.max(1, g.px * 0.04);
    for (let row = 0; row < rows; row++) {
      const y = g.front.y + row * rowH;
      ctx.fillStyle = PALETTE.shelfBoard;
      ctx.fillRect(g.front.x + pad, y + rowH - 2, g.front.w - 2 * pad, 2);
      let x = g.front.x + pad;
      let n = item.seed + row * 31;
      while (x < g.front.x + g.front.w - pad - 2) {
        const w = Math.max(2, g.px * (0.05 + (n % 3) * 0.02));
        const h = (rowH - 3) * (0.6 + (n % 4) * 0.1);
        ctx.fillStyle = pick(BOOK_COLOURS, n);
        ctx.fillRect(x, y + rowH - 2 - h, Math.min(w, g.front.x + g.front.w - pad - x), h);
        x += w + 1;
        n = (n * 1103515245 + 12345) >>> 8;
        if (n % 5 === 0) {
          x += w;
        }
      }
    }
  },
};

const storage: ArchetypeStyle = {
  maxHeightM: 1.1,
  shadow: 'box',
  paint({ ctx, g }) {
    block(ctx, g, PALETTE.storageTop, PALETTE.storageFront, 2);
    if (g.front.h < 6) {
      return;
    }
    const drawers = Math.max(1, Math.min(3, Math.floor(g.front.h / 9)));
    ctx.strokeStyle = PALETTE.storageLine;
    ctx.fillStyle = PALETTE.storageLine;
    ctx.lineWidth = 1;
    for (let i = 0; i < drawers; i++) {
      const y = g.front.y + (g.front.h * (i + 0.5)) / drawers;
      ctx.fillRect(g.front.x + g.front.w / 2 - 3, y - 0.5, 6, 1.5);
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(g.front.x + 2, g.front.y + (g.front.h * i) / drawers);
        ctx.lineTo(g.front.x + g.front.w - 2, g.front.y + (g.front.h * i) / drawers);
        ctx.stroke();
      }
    }
  },
};

const lamp: ArchetypeStyle = {
  maxHeightM: 0.3,
  shadow: 'round',
  paint({ ctx, g }) {
    const cx = g.floor.x + g.floor.w / 2;
    const cy = g.floor.y + g.floor.h / 2;
    const r = Math.max(Math.min(g.floor.w, g.floor.h) * 0.45, 3);
    fillEllipse(ctx, cx, cy, r * 0.5, r * 0.3, PALETTE.lampBase);
    const shadeY = cy - g.px * 0.6 * ELEVATION;
    fillEllipse(ctx, cx, shadeY, r * 2.2, r * 1.8, PALETTE.lampGlow);
    fillEllipse(ctx, cx, shadeY, r, r * 0.85, PALETTE.lampShade);
  },
};

const screen: ArchetypeStyle = {
  maxHeightM: 0.5,
  shadow: 'box',
  paint({ ctx, g }) {
    block(ctx, g, PALETTE.screenTop, PALETTE.screenFront, 2);
    if (g.front.h > 4) {
      fillRounded(ctx, inset(g.front, 1.5), 1.5, PALETTE.monitorScreen);
    }
  },
};

const decor: ArchetypeStyle = {
  maxHeightM: 0.4,
  shadow: null,
  paint({ ctx, item, g }) {
    block(ctx, g, pick(DECOR_COLOURS, item.seed), PALETTE.shelfFront, Math.min(g.top.w, g.top.h) * 0.3);
  },
};

const wall: ArchetypeStyle = {
  maxHeightM: 1.4,
  shadow: null,
  paint({ ctx, g }) {
    ctx.fillStyle = PALETTE.wallFront;
    ctx.fillRect(g.front.x, g.front.y, g.front.w, g.front.h);
    ctx.fillStyle = PALETTE.wallBase;
    const base = Math.max(1, Math.min(g.front.h * 0.14, g.px * 0.12));
    ctx.fillRect(g.front.x, g.front.y + g.front.h - base, g.front.w, base);
    ctx.fillStyle = PALETTE.wallTop;
    ctx.fillRect(g.top.x, g.top.y, g.top.w, g.top.h);
    ctx.fillStyle = PALETTE.wallHighlight;
    ctx.fillRect(g.top.x, g.top.y, g.top.w, Math.min(1.5, g.top.h));
  },
};

const blockStyle: ArchetypeStyle = {
  maxHeightM: 1.2,
  shadow: 'box',
  paint({ ctx, g }) {
    block(ctx, g, PALETTE.blockTop, PALETTE.blockFront, 2);
  },
};

const floor: ArchetypeStyle = {
  maxHeightM: 0,
  shadow: null,
  paint({ ctx, g }) {
    ctx.fillStyle = PALETTE.paving;
    ctx.fillRect(g.floor.x, g.floor.y, g.floor.w, g.floor.h);
    if (g.px < 12) {
      return;
    }
    // A one-metre tile grid, clipped to the floor, aligned to world metres so neighbouring floors line up.
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.floor.x, g.floor.y, g.floor.w, g.floor.h);
    ctx.clip();
    ctx.strokeStyle = PALETTE.pavingLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const phase = (v: number) => ((v % g.px) + g.px) % g.px;
    for (let x = g.floor.x - phase(g.floor.x); x <= g.floor.x + g.floor.w; x += g.px) {
      ctx.moveTo(x + 0.5, g.floor.y);
      ctx.lineTo(x + 0.5, g.floor.y + g.floor.h);
    }
    for (let y = g.floor.y - phase(g.floor.y); y <= g.floor.y + g.floor.h; y += g.px) {
      ctx.moveTo(g.floor.x, y + 0.5);
      ctx.lineTo(g.floor.x + g.floor.w, y + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  },
};

const rug: ArchetypeStyle = {
  maxHeightM: 0,
  shadow: null,
  paint({ ctx, item, g }) {
    const radius = Math.min(g.floor.w, g.floor.h) * 0.12;
    const colour = pick(RUG_COLOURS, item.seed);
    fillRounded(ctx, g.floor, radius, colour);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = Math.max(1, g.px * 0.04);
    ctx.setLineDash([Math.max(2, g.px * 0.12), Math.max(2, g.px * 0.08)]);
    ctx.beginPath();
    const r = inset(g.floor, Math.max(3, g.px * 0.15));
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.stroke();
    ctx.setLineDash([]);
  },
};

/** One painter per archetype; a missing entry is a compile error. */
export const ARCHETYPE_STYLES: Record<Archetype, ArchetypeStyle> = {
  floor,
  wall,
  rug,
  desk,
  table,
  chair,
  sofa,
  bed,
  plant,
  shelf,
  storage,
  lamp,
  screen,
  decor,
  block: blockStyle,
};
