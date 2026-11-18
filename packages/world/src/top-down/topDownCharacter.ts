import { loginOf, type PlayerState } from '@officexr/sdk';
import { fillEllipse, fillRounded, roundedRectPath, type TopDownContext } from './topDownPaint.ts';
import { HAIR_COLOURS, PALETTE, PANTS_COLOURS, SHIRT_COLOURS, SKIN_TONES } from './topDownPalette.ts';
import { hashString } from './topDownScene.ts';
import type { MotionSample } from './topDownMotion.ts';
import type { CharacterSpriteDraw, Facing } from './sprites.ts';

export type { Facing } from './sprites.ts';

export interface Appearance {
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  /** 0 short, 1 long, 2 bun. */
  hairStyle: number;
}

/** The same person looks the same in every window: the look comes from the login, not the window's player id. */
export function appearanceFor(playerId: string): Appearance {
  const h = hashString(loginOf(playerId));
  return {
    skin: SKIN_TONES[h % SKIN_TONES.length],
    hair: HAIR_COLOURS[(h >>> 4) % HAIR_COLOURS.length],
    shirt: SHIRT_COLOURS[(h >>> 8) % SHIRT_COLOURS.length],
    pants: PANTS_COLOURS[(h >>> 12) % PANTS_COLOURS.length],
    hairStyle: (h >>> 16) % 3,
  };
}

/** Yaw 0 faces -Z (screen up), positive turns counter-clockwise. */
export function facingOf(yaw: number): Facing {
  const dx = -Math.sin(yaw);
  const dy = -Math.cos(yaw);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

/**
 * Characters draw a little larger than life, like Gather's: at true scale a person beside a desk
 * reads as a detail rather than as someone you can walk up to.
 */
export const CHARACTER_SCALE = 1.1;
/** Screen metres from the feet to the top of the head in the baked sheets (measured: ~1.9). */
const CHARACTER_SCREEN_HEIGHT_M = 1.9;

/** A character's on-screen height at a zoom: it scales with the map but stays legible zoomed out. */
export function characterHeight(px: number): number {
  return Math.max(px * CHARACTER_SCREEN_HEIGHT_M * CHARACTER_SCALE, 30);
}

export interface CharacterDraw {
  player: Pick<PlayerState, 'id' | 'yaw' | 'status' | 'mic' | 'seat'>;
  /** Feet, in screen pixels. */
  x: number;
  y: number;
  px: number;
  motion: MotionSample;
  isSelf: boolean;
  hovered: boolean;
  timeSec: number;
  /** The baked sheet for this player, or null to draw the procedural figure. */
  sprite: CharacterSpriteDraw | null;
  /** Overrides the yaw's facing, e.g. a seated player faces away from the backrest. */
  facing?: Facing;
}

/** Draws one character standing (or sitting) with its feet at `(x, y)`: the baked sprite when loaded, else a drawn figure. */
export function drawCharacter(ctx: TopDownContext, d: CharacterDraw): void {
  const H = characterHeight(d.px);
  drawGround(ctx, d, H * 0.2, H * 0.055);
  if (d.sprite) {
    drawSprite(ctx, d, d.sprite);
  } else {
    drawFigure(ctx, d, H);
  }
}

/** Under the feet: you get the accent ring, a speaker a pulsing green one, the hovered player a highlight; everyone a shadow. */
function drawGround(ctx: TopDownContext, d: CharacterDraw, rx: number, ry: number): void {
  const ringRx = rx * 1.15;
  const ringRy = ry * 1.5;
  const { x } = d;
  if (d.player.mic === 'speaking') {
    const pulse = 0.5 + 0.5 * Math.sin(d.timeSec * 8);
    ctx.globalAlpha = 0.35 + pulse * 0.35;
    ctx.strokeStyle = PALETTE.speaking;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(x, d.y, ringRx + pulse * 3, ringRy + pulse * 1.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (d.isSelf || d.hovered) {
    ctx.strokeStyle = d.isSelf ? PALETTE.accent : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, d.y, ringRx, ringRy, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  fillEllipse(ctx, x, d.y, rx, ry, PALETTE.shadow);
}

/** One frame of the baked sheet: the facing's row, and the idle, walk-cycle or seated column. */
function drawSprite(ctx: TopDownContext, d: CharacterDraw, sprite: CharacterSpriteDraw): void {
  const { sheet, image, ppm } = sprite;
  const facing = d.facing ?? facingOf(d.player.yaw);
  const row = Math.max(0, sheet.directions.indexOf(facing));
  const seated = Boolean(d.player.seat);
  const [walkStart, walkCount] = sheet.columns.walk;
  const column = seated
    ? sheet.columns.sit
    : d.motion.moving
      ? walkStart + (Math.floor((d.motion.phase / (Math.PI * 2)) * walkCount) % walkCount)
      : sheet.columns.idle;
  const s = (d.px / ppm) * CHARACTER_SCALE;
  ctx.globalAlpha = d.player.status === 'away' ? 0.6 : 1;
  ctx.drawImage(
    image,
    column * sheet.cell.w,
    row * sheet.cell.h,
    sheet.cell.w,
    sheet.cell.h,
    d.x - sheet.anchor.x * s,
    d.y - sheet.anchor.y * s,
    sheet.cell.w * s,
    sheet.cell.h * s,
  );
  ctx.globalAlpha = 1;
}

/** The drawn fallback figure, for a sheet that hasn't loaded (or a test without images). */
function drawFigure(ctx: TopDownContext, d: CharacterDraw, H: number): void {
  const W = H * 0.6;
  const look = appearanceFor(d.player.id);
  const facing = d.facing ?? facingOf(d.player.yaw);
  const seated = Boolean(d.player.seat);
  const walking = d.motion.moving && !seated;
  const swing = walking ? Math.sin(d.motion.phase) : 0;
  const bob = walking ? Math.abs(Math.cos(d.motion.phase)) * H * 0.035 : 0;
  const { x } = d;
  const y = d.y - bob + (seated ? H * 0.1 : 0);

  // Away players fade a little, like a dimmed avatar.
  ctx.globalAlpha = d.player.status === 'away' ? 0.6 : 1;
  const side = facing === 'left' || facing === 'right';
  const dir = facing === 'left' ? -1 : 1;

  if (!seated) {
    const legW = W * 0.2;
    const legH = H * 0.2;
    const legTop = y - legH;
    if (side) {
      fillRounded(ctx, { x: x - legW / 2 + swing * W * 0.12, y: legTop, w: legW, h: legH }, legW / 2, look.pants);
      fillRounded(ctx, { x: x - legW / 2 - swing * W * 0.12, y: legTop, w: legW, h: legH }, legW / 2, look.pants);
    } else {
      fillRounded(ctx, { x: x - W * 0.2, y: legTop - swing * H * 0.04, w: legW, h: legH }, legW / 2, look.pants);
      fillRounded(ctx, { x: x + W * 0.0, y: legTop + swing * H * 0.04, w: legW, h: legH }, legW / 2, look.pants);
    }
  }

  // Torso and arms; arms swing against the legs.
  const bodyW = W * (side ? 0.5 : 0.66);
  const bodyH = H * 0.32;
  const bodyTop = y - H * 0.18 - bodyH;
  const armW = W * 0.16;
  const armH = bodyH * 0.8;
  if (side) {
    fillRounded(ctx, { x: x - armW / 2 - swing * W * 0.1, y: bodyTop + bodyH * 0.12, w: armW, h: armH }, armW / 2, look.skin);
  } else {
    fillRounded(ctx, { x: x - bodyW / 2 - armW * 0.7, y: bodyTop + bodyH * 0.1 + swing * H * 0.03, w: armW, h: armH }, armW / 2, look.skin);
    fillRounded(ctx, { x: x + bodyW / 2 - armW * 0.3, y: bodyTop + bodyH * 0.1 - swing * H * 0.03, w: armW, h: armH }, armW / 2, look.skin);
  }
  fillRounded(ctx, { x: x - bodyW / 2, y: bodyTop, w: bodyW, h: bodyH }, bodyW * 0.3, look.shirt);
  if (side) {
    fillRounded(ctx, { x: x - armW / 2 + swing * W * 0.1, y: bodyTop + bodyH * 0.12, w: armW, h: armH }, armW / 2, look.skin);
  }

  // Head and hair.
  const r = H * 0.22;
  const hx = x;
  const hy = bodyTop - r * 0.75;
  if (look.hairStyle === 1 && facing !== 'down') {
    // Long hair falls behind the shoulders.
    fillRounded(ctx, { x: hx - r * 0.95, y: hy, w: r * 1.9, h: r * 1.5 }, r * 0.6, look.hair);
  }
  fillEllipse(ctx, hx, hy, r, r * 0.95, look.skin);
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  if (facing === 'up') {
    ctx.ellipse(hx, hy - r * 0.05, r * 1.04, r * 1.0, 0, 0, Math.PI * 2);
  } else if (side) {
    // Cap over the top and the back of the head.
    ctx.ellipse(hx - dir * r * 0.12, hy - r * 0.18, r * 1.0, r * 0.82, 0, Math.PI * 0.95, Math.PI * 2.05);
    ctx.ellipse(hx - dir * r * 0.45, hy + r * 0.05, r * 0.6, r * 0.75, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(hx, hy - r * 0.15, r * 1.04, r * 0.85, 0, Math.PI, Math.PI * 2);
    ctx.ellipse(hx, hy - r * 0.35, r * 0.95, r * 0.5, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  if (look.hairStyle === 1 && facing === 'down') {
    fillRounded(ctx, { x: hx - r * 1.02, y: hy - r * 0.3, w: r * 0.38, h: r * 1.5 }, r * 0.18, look.hair);
    fillRounded(ctx, { x: hx + r * 0.64, y: hy - r * 0.3, w: r * 0.38, h: r * 1.5 }, r * 0.18, look.hair);
  }
  if (look.hairStyle === 2) {
    fillEllipse(ctx, hx - (side ? dir * r * 0.7 : 0), hy - r * 1.0, r * 0.38, r * 0.34, look.hair);
  }

  // Face: two eyes looking down, one in profile, none from behind.
  ctx.fillStyle = '#1f2433';
  const eyeR = Math.max(r * 0.11, 0.9);
  if (facing === 'down') {
    fillEllipse(ctx, hx - r * 0.36, hy + r * 0.18, eyeR, eyeR * 1.3, '#1f2433');
    fillEllipse(ctx, hx + r * 0.36, hy + r * 0.18, eyeR, eyeR * 1.3, '#1f2433');
    ctx.globalAlpha *= 0.35;
    fillEllipse(ctx, hx - r * 0.55, hy + r * 0.45, eyeR * 1.4, eyeR * 0.8, '#ef8a8a');
    fillEllipse(ctx, hx + r * 0.55, hy + r * 0.45, eyeR * 1.4, eyeR * 0.8, '#ef8a8a');
    ctx.globalAlpha = d.player.status === 'away' ? 0.6 : 1;
  } else if (side) {
    fillEllipse(ctx, hx + dir * r * 0.5, hy + r * 0.18, eyeR, eyeR * 1.3, '#1f2433');
  }
  ctx.globalAlpha = 1;
}

export interface NameTag {
  text: string;
  status: PlayerState['status'];
  isSelf: boolean;
}

const TAG_FONT = '600 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif';
const TAG_H = 22;

/** A glass pill with a presence dot, centred above `(x, bottom)`; yours is accent blue. */
export function drawNameTag(ctx: TopDownContext, tag: NameTag, x: number, bottom: number): void {
  ctx.font = TAG_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const textW = ctx.measureText(tag.text).width;
  const w = textW + 28;
  const r = { x: Math.round(x - w / 2), y: Math.round(bottom - TAG_H), w: Math.round(w), h: TAG_H };
  // A soft drop shadow, then the pill.
  ctx.fillStyle = PALETTE.tagShadow;
  ctx.beginPath();
  roundedRectPath(ctx, { ...r, y: r.y + 1.5 }, TAG_H / 2);
  ctx.fill();
  ctx.fillStyle = tag.isSelf ? PALETTE.tagSelf : PALETTE.tag;
  ctx.beginPath();
  roundedRectPath(ctx, r, TAG_H / 2);
  ctx.fill();
  fillEllipse(ctx, r.x + 12, r.y + TAG_H / 2, 3.5, 3.5, tag.status === 'away' ? PALETTE.away : PALETTE.available);
  ctx.fillStyle = tag.isSelf ? PALETTE.tagSelfText : PALETTE.tagText;
  ctx.fillText(tag.text, r.x + 20, r.y + TAG_H / 2 + 0.5);
}
