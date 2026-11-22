import { describe, expect, it } from 'vitest';
import type { DeskAreaState, ObjectInstance } from '@officexr/sdk';
import type { WorldObjectKind } from '../../scenes/index.ts';
import {
  deskScreenLinks,
  isChairOccupied,
  isScreenKind,
  SCREEN_OFF,
  SCREEN_OFF_DELAY_SEC,
  SCREEN_POWER_UP_SEC,
  screenGlow,
  stepScreenPower,
  type ScreenPower,
} from '../desk-screens.ts';
import { createInstanceGeometry } from '../geometry-service.ts';

const kinds: Record<string, Partial<WorldObjectKind>> = {
  chair: { id: 'chair', dimensions: { width: 1, height: 1, depth: 1 }, seats: [{ offset: { x: 0.5, y: 0.5, z: 0.5 }, yawDeg: 0 }] },
  desk: { id: 'desk', dimensions: { width: 3, height: 1, depth: 2 }, isDesk: true },
  monitor: { id: 'monitor', label: 'Monitor', dimensions: { width: 1, height: 1, depth: 0.5 } },
  lamp: { id: 'lamp', label: 'Lamp', dimensions: { width: 1, height: 1, depth: 1 } },
};
const catalog = { getKind: (id: string) => kinds[id] as WorldObjectKind | undefined };
const geometry = createInstanceGeometry({ catalog, voxelSize: 1 });

const inst = (id: string, kindId: string, x: number, z: number, y = 0): ObjectInstance => ({
  id,
  sourceCommandId: id,
  kindId,
  position: [x, y, z],
});
const area = (id: string, seat: string | null, minX = 0, maxX = 8): DeskAreaState => ({
  id,
  label: id,
  min: { x: minX, z: 0 },
  max: { x: maxX, z: 8 },
  seatInstanceId: seat,
});

describe('isScreenKind', () => {
  it('matches words in the id, label or model file name', () => {
    expect(isScreenKind({ id: 'office_monitor_a' })).toBe(true);
    expect(isScreenKind({ id: 'x', label: 'Laptop open' })).toBe(true);
    expect(isScreenKind({ id: 'x', gltfPath: '/models/office/DeskComputer.glb?v=2' })).toBe(true);
    expect(isScreenKind({ id: 'furniture_table_medium', label: 'Table Medium' })).toBe(false);
    expect(isScreenKind({ id: 'x', label: 'Monitoring station' })).toBe(false);
    expect(isScreenKind(undefined)).toBe(false);
  });
});

describe('deskScreenLinks', () => {
  const base = [inst('desk', 'desk', 2, 3), inst('chair', 'chair', 3, 1)];

  it('links a monitor standing on the desk top and adds no instance', () => {
    const instances = [...base, inst('mon', 'monitor', 3, 3, 1)];
    const links = deskScreenLinks([area('a', 'chair')], instances, catalog, geometry);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ deskAreaId: 'a', seatId: 'chair', monitorInstanceId: 'mon' });
    expect(links[0].chair).toEqual({ x: 3.5, z: 1.5 });
    expect(instances).toHaveLength(3);
  });

  it('ignores a monitor off the desk footprint, on the floor, or of another kind', () => {
    const instances = [
      ...base,
      inst('beside', 'monitor', 7, 3, 1),
      inst('floor', 'monitor', 3, 3, 0),
      inst('lamp', 'lamp', 3, 3, 1),
    ];
    expect(deskScreenLinks([area('a', 'chair')], instances, catalog, geometry)).toEqual([]);
  });

  it('does nothing for a desk without a monitor', () => {
    expect(deskScreenLinks([area('a', 'chair')], base, catalog, geometry)).toEqual([]);
  });

  it('keeps a monitor with the desk area it stands in', () => {
    const instances = [
      inst('deskA', 'desk', 0, 3),
      inst('chairA', 'chair', 1, 1),
      inst('deskB', 'desk', 5, 3),
      inst('chairB', 'chair', 6, 1),
      inst('monB', 'monitor', 6, 3, 1),
    ];
    const links = deskScreenLinks([area('a', 'chairA', 0, 4), area('b', 'chairB', 5, 9)], instances, catalog, geometry);
    expect(links.map((l) => [l.deskAreaId, l.monitorInstanceId])).toEqual([['b', 'monB']]);
  });

  it('skips areas with no chair or several desks', () => {
    const monitor = inst('mon', 'monitor', 3, 3, 1);
    expect(deskScreenLinks([area('a', null)], [...base, monitor], catalog, geometry)).toEqual([]);
    const two = [inst('d1', 'desk', 0, 3), inst('d2', 'desk', 4, 3), inst('chair', 'chair', 3, 1), monitor];
    expect(deskScreenLinks([area('a', 'chair')], two, catalog, geometry)).toEqual([]);
  });
});

describe('isChairOccupied', () => {
  const players = (...seats: Array<string | undefined>) =>
    ({ players: Object.fromEntries(seats.map((seat, i) => [`p${i}`, { id: `p${i}`, seat }])) }) as never;

  it('is true for any player on any seat of the chair instance', () => {
    expect(isChairOccupied(players('chair'), 'chair')).toBe(true);
    expect(isChairOccupied(players('chair#2'), 'chair')).toBe(true);
    expect(isChairOccupied(players(undefined, 'other'), 'chair')).toBe(false);
    expect(isChairOccupied(players(), 'chair')).toBe(false);
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
