import { describe, expect, it } from 'vitest';
import type { PlayerState } from '@officexr/sdk';
import { drawFrame, itemGeometry, LAYERS, type TopDownContext, type TopDownFrame } from './topDownDraw.ts';
import { ELEVATION } from './topDownPainters.ts';
import { PALETTE } from './topDownPalette.ts';
import { buildScene, type ResolveInstance } from './topDownScene.ts';
import { STILL } from './topDownMotion.ts';
import { NO_SPRITES } from './sprites.ts';

type Call = { op: string; args: unknown[]; fillStyle: unknown };

/** Records every draw call with the fill style in effect at the time. */
function recordingContext(): { ctx: TopDownContext; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) {
        return target[prop];
      }
      if (prop === 'measureText') {
        return (text: string) => ({ width: text.length * 6 });
      }
      return (...args: unknown[]) => calls.push({ op: prop, args, fillStyle: target.fillStyle });
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as TopDownContext;
  return { ctx, calls };
}

const desk = { id: 'desk', label: 'Desk', category: 'furniture' as const, isLayoutObject: false, isDesk: true };
const resolveDesk: ResolveInstance = () => ({ kind: desk, aabb: { min: [0, 0, 0], max: [2, 0.75, 1] } });

function player(id: string, x: number, z: number, extra: Partial<PlayerState> = {}): PlayerState {
  return { id, name: id, pos: { x, y: 0, z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, status: 'available', mic: 'none', avatar: { model: 'a' }, ...extra } as PlayerState;
}

function frame(overrides: Partial<TopDownFrame> = {}): TopDownFrame {
  return {
    t: { scale: 40, offsetX: 100, offsetY: 100 },
    size: { width: 400, height: 400 },
    timeSec: 0,
    scene: buildScene([{ id: 'd', sourceCommandId: 'd', kindId: 'desk', position: [0, 0, 0] }], resolveDesk, []),
    zones: [],
    desks: [],
    players: {},
    motion: () => STILL,
    sprites: NO_SPRITES,
    selfId: 'me',
    hoveredId: null,
    rings: { inner: 3, outer: 5 },
    destination: null,
    ...overrides,
  };
}

describe('itemGeometry', () => {
  it('lifts the top face by the height and exposes the south face below it', () => {
    const scene = frame().scene;
    const g = itemGeometry(scene.items[0], { scale: 40, offsetX: 0, offsetY: 0 });
    const lift = 0.75 * 40 * ELEVATION;
    expect(g.floor).toEqual({ x: 0, y: 0, w: 80, h: 40 });
    expect(g.top).toEqual({ x: 0, y: -lift, w: 80, h: 40 });
    expect(g.front).toEqual({ x: 0, y: 40 - lift, w: 80, h: lift });
  });
});

describe('drawFrame', () => {
  it('runs every layer, starting with the lawn', () => {
    const { ctx, calls } = recordingContext();
    drawFrame(ctx, frame());
    expect(LAYERS.length).toBeGreaterThan(5);
    expect(calls[0]).toMatchObject({ op: 'fillRect', args: [0, 0, 400, 400], fillStyle: PALETTE.lawn });
  });

  it('draws a player south of a desk after the desk, and one north of it before', () => {
    const { ctx, calls } = recordingContext();
    drawFrame(ctx, frame({ players: { north: player('north', 1, -0.5), south: player('south', 1, 1.5) } }));
    const tag = (name: string) => calls.findIndex((c) => c.op === 'fillText' && c.args[0] === name);
    const deskTop = calls.findIndex((c) => c.fillStyle === PALETTE.deskTop);
    // Each character's ellipses (shadow, head, hair) sit on x=140: the first are `north`'s, the last `south`'s.
    const shadows = calls.flatMap((c, i) => (c.op === 'ellipse' && c.args[0] === 140 ? [i] : []));
    expect(shadows[0]).toBeLessThan(deskTop);
    expect(shadows[shadows.length - 1]).toBeGreaterThan(deskTop);
    // Name tags float above everything.
    expect(tag('north')).toBeGreaterThan(deskTop);
    expect(tag('south')).toBeGreaterThan(deskTop);
  });

  it('hides others’ name tags when zoomed far out, but keeps yours', () => {
    const { ctx, calls } = recordingContext();
    drawFrame(ctx, frame({ t: { scale: 10, offsetX: 100, offsetY: 100 }, players: { me: player('me', 0, 0), you: player('you', 2, 2) } }));
    expect(calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toEqual(['me']);
  });

  it('labels voice zones and claimed desks', () => {
    const { ctx, calls } = recordingContext();
    drawFrame(
      ctx,
      frame({
        zones: [{ id: 'z', label: 'Product team', min: { x: 0, z: 0 }, max: { x: 5, z: 5 } }],
        desks: [{ min: { x: 0, z: 0 }, max: { x: 2, z: 2 }, owner: 'Brad' }],
      }),
    );
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts).toContain('Product team');
    expect(texts).toContain("Brad's desk");
  });
});
