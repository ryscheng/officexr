/**
 * One-shot migration: take a list of (roomName, layoutName) pairs,
 * compile the room (expanding extrudes), split commands into a layout
 * (kinds with isLayoutObject) and a residual room, then write both to
 * disk. The original room JSON is updated in place: schemaVersion 5,
 * layoutName set, layout-eligible commands replaced by a single
 * reference (commands array becomes only the non-layout placements).
 *
 * Usage:
 *   pnpm -C packages/world tsx scripts/migrate-rooms-to-layouts.ts
 *
 * Then bake the produced layouts:
 *   pnpm -C packages/world bake:layout <layoutName>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileScene } from '../src/scenes/compile.ts';
import type { RoomDocument, PlaceObjectCommand } from '../src/scenes/commands.ts';
import type { LayoutDocument } from '../src/scenes/layout-document.ts';
import type { WorldObjectKind, WorldObjectKindCatalogV1 } from '../src/scenes/world-object-kinds-schema.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORLD_ROOT = path.resolve(__dirname, '..');
const VOXEL_SIZE = 0.5;

interface MigrationSpec {
  room: string;
  layout: string;
}

const SPECS: MigrationSpec[] = [
  { room: 'platform', layout: 'platform' },
  { room: 'default-v2', layout: 'long_corridor' },
];

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

function writeJson(p: string, value: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
}

function loadCatalog(): Map<string, WorldObjectKind> {
  const catalogPath = path.join(WORLD_ROOT, 'world-object-kinds.json');
  const defaultPath = path.join(WORLD_ROOT, 'world-object-kinds.default.json');
  const sourcePath = fs.existsSync(catalogPath) ? catalogPath : defaultPath;
  const catalog = readJson<WorldObjectKindCatalogV1>(sourcePath);
  const byId = new Map<string, WorldObjectKind>();
  for (const k of catalog.kinds) byId.set(k.id, k);
  return byId;
}

function buildTileStep(catalog: Map<string, WorldObjectKind>) {
  return (kindId: string): [number, number, number] => {
    const kind = catalog.get(kindId);
    if (kind?.dimensions) {
      return [
        Math.max(1, Math.round(kind.dimensions.width / VOXEL_SIZE)),
        Math.max(1, Math.round(kind.dimensions.height / VOXEL_SIZE)),
        Math.max(1, Math.round(kind.dimensions.depth / VOXEL_SIZE)),
      ];
    }
    if (kind?.localAABB) {
      const { min, max } = kind.localAABB;
      return [
        Math.max(1, Math.round((max.x - min.x) / VOXEL_SIZE)),
        Math.max(1, Math.round((max.y - min.y) / VOXEL_SIZE)),
        Math.max(1, Math.round((max.z - min.z) / VOXEL_SIZE)),
      ];
    }
    return [1, 1, 1];
  };
}

function migrate(spec: MigrationSpec, catalog: Map<string, WorldObjectKind>): void {
  const roomPath = path.join(WORLD_ROOT, 'rooms', `${spec.room}.json`);
  const layoutPath = path.join(WORLD_ROOT, 'layouts', `${spec.layout}.json`);
  const room = readJson<RoomDocument & { schemaVersion: number }>(roomPath);

  const compiled = compileScene(
    { name: room.name, commands: room.commands },
    VOXEL_SIZE,
    buildTileStep(catalog),
  );

  const layoutCommands: PlaceObjectCommand[] = [];
  const residualCommands: PlaceObjectCommand[] = [];
  let layoutCount = 0;
  let residualCount = 0;
  let idx = 0;

  for (const inst of compiled.instances) {
    const kind = catalog.get(inst.kindId);
    if (!kind) {
      throw new Error(`migrate(${spec.room}): unknown kind "${inst.kindId}"`);
    }
    const cmd: PlaceObjectCommand = {
      id: `place-${spec.room}-${++idx}`,
      op: 'placeObject',
      kindId: inst.kindId,
      position: inst.position,
    };
    if (kind.isLayoutObject) {
      layoutCommands.push(cmd);
      layoutCount++;
    } else {
      residualCommands.push(cmd);
      residualCount++;
    }
  }

  const now = Date.now();
  const layoutDoc: LayoutDocument = {
    schemaVersion: 1,
    name: spec.layout,
    title: room.title ?? spec.layout,
    updatedAt: now,
    commands: layoutCommands,
  };
  writeJson(layoutPath, layoutDoc);

  const updatedRoom = {
    schemaVersion: 5 as const,
    name: room.name,
    title: room.title,
    updatedAt: now,
    layoutName: spec.layout,
    commands: residualCommands,
    groups: {},
  };
  writeJson(roomPath, updatedRoom);

  console.log(
    `migrate ${spec.room} → layout ${spec.layout}: ${layoutCount} layout / ${residualCount} residual commands`,
  );
}

function main(): void {
  const catalog = loadCatalog();
  for (const spec of SPECS) {
    migrate(spec, catalog);
  }
}

main();
