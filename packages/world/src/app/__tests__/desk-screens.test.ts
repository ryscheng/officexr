import { describe, expect, it } from 'vitest';
import type { DeskAreaState, ObjectInstance } from '@officexr/sdk';
import type { WorldObjectKind } from '../../scenes/index.ts';
import {
  deskScreenPlacements,
  MONITOR_INSET_M,
  SCREEN_OFF,
  SCREEN_OFF_DELAY_SEC,
  SCREEN_POWER_UP_SEC,
  screenGlow,
  stepScreenPower,
  type ScreenPower,
} from '../desk-screens.ts';
import { createInstanceGeometry } from '../geometry-service.ts';

const kinds: Record<string, Partial<WorldObjectKind>> = {
  chair: { id: 'chair', dimensions: { width: 1, height: 1, depth: 1 }, seat: { offset: { x: 0.5, y: 0.5, z: 0.5 }, yawDeg: 0 } },
  desk: { id: 'desk', dimensions: { width: 3, height: 1, depth: 2 }, isDesk: true },
};
const catalog = { getKind: (id: string) => kinds[id] as WorldObjectKind | undefined };
const geometry = createInstanceGeometry({ catalog, voxelSize: 1 });

const inst = (id: string, kindId: string, x: number, z: number, yawDeg?: number): ObjectInstance => ({
  id,
  sourceCommandId: id,
  kindId,
  position: [x, 0, z],
  yawDeg,
});
const area = (id: string, seat: string | null, minX = 0, maxX = 8): DeskAreaState => ({
  id,
  label: id,
  min: { x: minX, z: 0 },
  max: { x: maxX, z: 8 },
  seatInstanceId: seat,
});

describe('deskScreenPlacements', () => {
  it('stands the monitor on the desk top where the sitter looks, facing the chair', () => {
    const instances = [inst('desk', 'desk', 2, 3), inst('chair', 'chair', 3, 1)];
    const [p] = deskScreenPlacements([area('a', 'chair')], instances, catalog, geometry);
    expect(p).toMatchObject({ deskAreaId: 'a', seatInstanceId: 'chair', deskInstanceId: 'desk' });
    expect(p.position[0]).toBeCloseTo(3.5);
    expect(p.position[1]).toBeCloseTo(1);
    expect(p.position[2]).toBeCloseTo(3 + MONITOR_INSET_M);
    expect(p.yawRad).toBeCloseTo(Math.PI);
  });

  it('follows the chair yaw', () => {
    const instances = [inst('desk', 'desk', 2, 3), inst('chair', 'chair', 3, 6, 180)];
    const [p] = deskScreenPlacements([area('a', 'chair')], instances, catalog, geometry);
    expect(p.position[2]).toBeCloseTo(5 - MONITOR_INSET_M);
    expect(Math.cos(p.yawRad)).toBeCloseTo(1);
  });

  it('falls back to the desk centre when the sitter looks past the desk', () => {
    const instances = [inst('desk', 'desk', 2, 3), inst('chair', 'chair', 7, 1)];
    const [p] = deskScreenPlacements([area('a', 'chair')], instances, catalog, geometry);
    expect(p.position[0]).toBeCloseTo(3.5);
    expect(p.position[2]).toBeCloseTo(4);
  });

  it('uses the desk of the occupied chair own area, not a nearer desk of another area', () => {
    const instances = [
      inst('deskA', 'desk', 0, 3),
      inst('chairA', 'chair', 1, 1),
      inst('deskB', 'desk', 5, 3),
      inst('chairB', 'chair', 6, 1),
    ];
    const places = deskScreenPlacements([area('a', 'chairA', 0, 4), area('b', 'chairB', 5, 9)], instances, catalog, geometry);
    expect(places.map((p) => [p.deskAreaId, p.deskInstanceId])).toEqual([
      ['a', 'deskA'],
      ['b', 'deskB'],
    ]);
  });

  it('skips areas with no chair, no desk, or several desks', () => {
    const noChair = deskScreenPlacements([area('a', null)], [inst('desk', 'desk', 2, 3)], catalog, geometry);
    const noDesk = deskScreenPlacements([area('a', 'chair')], [inst('chair', 'chair', 3, 1)], catalog, geometry);
    const two = deskScreenPlacements(
      [area('a', 'chair')],
      [inst('d1', 'desk', 0, 3), inst('d2', 'desk', 4, 3), inst('chair', 'chair', 3, 1)],
      catalog,
      geometry,
    );
    expect([noChair, noDesk, two]).toEqual([[], [], []]);
  });
});

describe('screen power', () => {
  const run = (p: ScreenPower, occupied: boolean, sec: number, dt = 0.05): ScreenPower => {
    let cur = p;
    for (let t = 0; t < sec - 1e-9; t += dt) cur = stepScreenPower(cur, occupied, dt);
    return cur;
  };

  it('turns on at once when someone sits and glows fully after the power-up', () => {
    const first = stepScreenPower(SCREEN_OFF, true, 0.016);
    expect(first.on).toBe(true);
    expect(screenGlow(first)).toBeLessThan(1);
    expect(screenGlow(run(first, true, SCREEN_POWER_UP_SEC + 0.1))).toBe(1);
  });

  it('flickers during the power-up and never exceeds the steady glow', () => {
    const glows = Array.from({ length: 12 }, (_, i) => screenGlow({ on: true, litSec: i * 0.025, emptySec: 0 }));
    expect(glows.every((g) => g >= 0 && g <= 1)).toBe(true);
    expect(glows.some((g, i) => i > 0 && g < glows[i - 1])).toBe(true);
  });

  it('stays dark with nobody seated', () => {
    expect(run(SCREEN_OFF, false, 2)).toBe(SCREEN_OFF);
    expect(screenGlow(SCREEN_OFF)).toBe(0);
  });

  it('stays lit for the delay after standing up, then goes dark', () => {
    const lit = run(SCREEN_OFF, true, 1);
    const justAfter = run(lit, false, SCREEN_OFF_DELAY_SEC - 0.1);
    expect(justAfter.on).toBe(true);
    expect(run(justAfter, false, 0.2).on).toBe(false);
  });

  it('keeps the screen on when the seat is retaken inside the delay', () => {
    const lit = run(SCREEN_OFF, true, 1);
    const resat = run(run(lit, false, 0.6), true, 0.1);
    expect(resat.emptySec).toBe(0);
    expect(run(resat, false, 0.6).on).toBe(true);
  });
});
