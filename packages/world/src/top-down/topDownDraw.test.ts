import { describe, expect, it } from 'vitest';
import type { PlayerState } from '@officexr/sdk';
import { drawMap, drawPlayers, STYLE, type TopDownContext } from './topDownDraw.ts';

type Call = { op: string; args: unknown[]; fillStyle: unknown; strokeStyle: unknown };

/** Records every draw call with the styles in effect at the time. */
function recordingContext(): { ctx: TopDownContext; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) {
        return target[prop];
      }
      return (...args: unknown[]) =>
        calls.push({ op: prop, args, fillStyle: target.fillStyle, strokeStyle: target.strokeStyle });
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as TopDownContext;
  return { ctx, calls };
}

const IDENTITY = { scale: 1, offsetX: 0, offsetY: 0 };
const SIZE = { width: 100, height: 100 };

function player(id: string, viewMode: '2d' | '3d', x: number): PlayerState {
  return { id, name: id, pos: { x, y: 0, z: 0 }, yaw: 0, avatar: { viewMode } } as unknown as PlayerState;
}

describe('drawMap', () => {
  it('styles layout objects apart from furniture and outlines the footprint', () => {
    const { ctx, calls } = recordingContext();
    drawMap(
      ctx,
      IDENTITY,
      SIZE,
      [
        { min: { x: 1, z: 1 }, max: { x: 2, z: 2 }, layout: false },
        { min: { x: 0, z: 0 }, max: { x: 10, z: 10 }, layout: true },
      ],
      [{ min: { x: -1, z: -1 }, max: { x: 11, z: 11 } }],
    );
    const fills = calls.filter((c) => c.op === 'fillRect').slice(1);
    expect(fills.map((c) => [c.args, c.fillStyle])).toEqual([
      [[0, 0, 10, 10], STYLE.layoutFill],
      [[1, 1, 1, 1], STYLE.furnitureFill],
    ]);
    expect(
      calls.filter((c) => c.op === 'strokeRect' && c.strokeStyle === STYLE.footprintStroke).map((c) => c.args),
    ).toEqual([[-1, -1, 12, 12]]);
  });
});

describe('drawPlayers', () => {
  it('draws 2D players distinctly from 3D ones, plus the self rings', () => {
    const { ctx, calls } = recordingContext();
    drawPlayers(
      ctx,
      IDENTITY,
      { me: player('me', '3d', 0), ghost: player('ghost', '2d', 20), body: player('body', '3d', 40) },
      'me',
      { inner: 3, outer: 5 },
    );
    const dotFill = (x: number) =>
      calls.find((c) => c.op === 'fill' && calls[calls.indexOf(c) - 1]?.args[0] === x)?.fillStyle;
    expect(dotFill(20)).toBe(STYLE.player2d);
    expect(dotFill(40)).toBe(STYLE.player3d);
    expect(dotFill(0)).toBe(STYLE.self);
    expect(calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toEqual(['me', 'ghost', 'body']);
    const rings = calls.filter((c) => c.op === 'arc' && c.args[0] === 0).map((c) => c.args[2]);
    expect(rings).toEqual([3, 5, 6]);
  });
});
