import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isGridPosition,
  parseCommandPositions,
  quantizePosition,
  quantizeVoxel,
  type SceneCommand,
} from './commands.ts';
import { compileScene } from './compile.ts';
import { deserializeLayout } from './layout-document.ts';
import { deserializeMap, deserializeScene, serializeRoom } from './serialize.ts';

const place = (id: string, position: number[]) => ({ id, op: 'placeObject', kindId: 'k', position });
const extrude = (id: string, targetCommandId: string) => ({
  id,
  op: 'extrude',
  targetCommandId,
  face: 'px',
  count: 3,
});

describe('quantizeVoxel', () => {
  it('rounds to the 0.002-voxel (1 mm) sub-grid and strips float noise', () => {
    expect(quantizeVoxel(0.15 / 0.5)).toBe(0.3);
    expect(quantizeVoxel(0.30049)).toBe(0.3);
    expect(quantizeVoxel(-0.0001)).toBe(0);
    expect(Object.is(quantizeVoxel(-0.0001), 0)).toBe(true);
    expect(quantizePosition([1, 2.4000000001, -3])).toEqual([1, 2.4, -3]);
  });

  it('isGridPosition is true only for whole voxels', () => {
    expect(isGridPosition([0, 4, -2])).toBe(true);
    expect(isGridPosition([0, 0.3, 0])).toBe(false);
  });
});

describe('parseCommandPositions', () => {
  it('passes integer positions through unchanged', () => {
    const cmds = [place('a', [0, 0, 0]), extrude('e', 'a')];
    expect(parseCommandPositions(cmds, 't')).toEqual(cmds);
  });

  it('accepts sub-grid positions and normalises decimal noise', () => {
    const [out] = parseCommandPositions([place('a', [0.5, 0.15 / 0.5, 1.25])], 't');
    expect((out as { position: number[] }).position).toEqual([0.5, 0.3, 1.25]);
  });

  it.each([
    [[0, 0.0011, 0]],
    [[0, Number.NaN, 0]],
    [[0, 0]],
    ['0,0,0'],
  ])('rejects %j', (position) => {
    expect(() => parseCommandPositions([place('a', position as number[])], 'room')).toThrow(
      /room: commands\[0\]\.position/,
    );
  });

  it('rejects an extrude whose target (directly or via another extrude) is sub-grid', () => {
    expect(() => parseCommandPositions([place('a', [0, 0.3, 0]), extrude('e', 'a')], 't')).toThrow(
      /extrude "e" cannot target sub-grid placement "a"/,
    );
    expect(() =>
      parseCommandPositions([place('a', [0.5, 0, 0]), extrude('e1', 'a'), extrude('e2', 'e1')], 't'),
    ).toThrow(/extrude "e1"/);
  });

  it('ignores extrudes with unknown or cyclic targets (compile treats them as no-ops)', () => {
    expect(() => parseCommandPositions([extrude('e', 'missing')], 't')).not.toThrow();
    expect(() => parseCommandPositions([extrude('e1', 'e2'), extrude('e2', 'e1')], 't')).not.toThrow();
  });
});

describe('document deserializers', () => {
  it('round-trips a room with a sub-grid placement', () => {
    const room = serializeRoom({
      name: 'r',
      commands: [place('tile', [0, 0, 0]), place('rug', [0, 0.3, 0])] as SceneCommand[],
    });
    expect(deserializeScene(JSON.parse(JSON.stringify(room)))).toEqual(room);
  });

  it('rejects off-quantum room and layout positions', () => {
    const commands = [place('a', [0, 0.0005, 0])];
    expect(() => deserializeScene({ schemaVersion: 5, name: 'r', commands, groups: {} })).toThrow(
      /scene: commands\[0\]\.position/,
    );
    expect(() => deserializeLayout({ schemaVersion: 1, name: 'l', commands })).toThrow(
      /layout: commands\[0\]\.position/,
    );
  });

  it('rejects extrude-from-sub-grid in rooms and layouts', () => {
    const commands = [place('a', [0, 0.3, 0]), extrude('e', 'a')];
    expect(() => deserializeScene({ schemaVersion: 5, name: 'r', commands, groups: {} })).toThrow(
      /cannot target sub-grid/,
    );
    expect(() => deserializeLayout({ schemaVersion: 1, name: 'l', commands })).toThrow(
      /cannot target sub-grid/,
    );
  });

  it('requires integer map room offsets', () => {
    const map = (position: unknown) => ({
      schemaVersion: 2,
      name: 'm',
      rooms: [{ id: 'r', roomName: 'r', position }],
      spawnPoints: [],
      environment: {},
    });
    expect(() => deserializeMap(map([0, 0, 4]))).not.toThrow();
    expect(() => deserializeMap(map([0, 0.5, 4]))).toThrow(/integer voxel offsets/);
    expect(() => deserializeMap(map(undefined))).toThrow(/integer voxel offsets/);
  });
});

describe('bundled documents load unchanged', () => {
  const root = path.resolve(__dirname, '../..');
  const jsonIn = (dir: string) =>
    readdirSync(path.join(root, dir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => [`${dir}/${f}`, JSON.parse(readFileSync(path.join(root, dir, f), 'utf8'))] as const);

  it.each([...jsonIn('rooms'), ...jsonIn('scenes')])('%s', (_name, raw) => {
    const parsed = deserializeScene(raw) as { commands?: unknown[] };
    if (raw.commands) expect(parsed.commands).toEqual(raw.commands);
  });

  it.each(jsonIn('layouts'))('%s', (_name, raw) => {
    expect(deserializeLayout(raw).commands).toEqual(raw.commands);
  });

  it.each(jsonIn('maps'))('%s', (_name, raw) => {
    expect(() => deserializeMap(raw)).not.toThrow();
  });
});

describe('compileScene with sub-grid positions', () => {
  it('emits sub-grid instances at their exact position', () => {
    const compiled = compileScene(
      { commands: [place('tile', [0, 0, 0]), place('rug', [0, 0.3, 0])] as SceneCommand[] },
      0.5,
    );
    expect(compiled.instances.map((i) => i.position)).toEqual([
      [0, 0.3, 0],
      [0, 0, 0],
    ]);
  });

  it('skips an extrude whose target is sub-grid (in-memory docs that bypass deserialize)', () => {
    const compiled = compileScene(
      { commands: [place('a', [0, 0.3, 0]), extrude('e', 'a')] as SceneCommand[] },
      0.5,
    );
    expect(compiled.instances).toHaveLength(1);
  });
});
