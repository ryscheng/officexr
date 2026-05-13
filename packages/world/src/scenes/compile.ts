import type { ObjectInstance, WorldObjects } from '@officexr/sdk';
import type {
  CubeFace,
  PlaceCubeCommand,
  SceneCommand,
  SceneDocument,
} from './commands.ts';

/**
 * Pure replay of a `SceneDocument`'s command list into a flat list of
 * placed cube instances. Same input → same output; safe to call as
 * often as the editor needs (it runs on every command-list edit).
 *
 * Algorithm:
 *   - Maintain a `byCommand: Map<commandId, ObjectInstance[]>` so
 *     subsequent extrudes can look up the cells produced by their
 *     target.
 *   - `placeCube` adds one instance whose `sourceCommandId` is the
 *     command itself.
 *   - `extrude` reads the target's instance set, finds the outermost
 *     layer of cells along the chosen face's normal, and emits
 *     `count` new layers walking outward. Each new instance's
 *     `sourceCommandId` is the extrude command (so the inspector can
 *     focus the right command on selection); its `kindId` inherits
 *     from the target's first instance.
 *
 * Edge cases handled:
 *   - Unknown `targetCommandId` → no-op (logged but doesn't throw).
 *   - `count <= 0` → no-op.
 *   - Two cubes occupying the same voxel after extrude → the later
 *     wins (the earlier instance is dropped from the global set).
 */
export function compileScene(
  doc: SceneDocument,
  cubeSize: number,
): WorldObjects {
  const byCommand = new Map<string, ObjectInstance[]>();
  const byVoxel = new Map<string, ObjectInstance>();

  const upsert = (instance: ObjectInstance) => {
    const key = voxelKey(instance.position);
    const existing = byVoxel.get(key);
    if (existing) {
      // Drop the previous occupant from its source command's bucket.
      const bucket = byCommand.get(existing.sourceCommandId);
      if (bucket) {
        const idx = bucket.indexOf(existing);
        if (idx !== -1) bucket.splice(idx, 1);
      }
    }
    byVoxel.set(key, instance);
    let bucket = byCommand.get(instance.sourceCommandId);
    if (!bucket) {
      bucket = [];
      byCommand.set(instance.sourceCommandId, bucket);
    }
    bucket.push(instance);
  };

  for (const cmd of doc.commands) {
    switch (cmd.op) {
      case 'placeCube':
        upsert(makeInstance(cmd, cmd.position, cmd.kindId));
        break;
      case 'extrude': {
        const target = byCommand.get(cmd.targetCommandId);
        if (!target || target.length === 0 || cmd.count <= 1) break;
        const kindId = target[0].kindId;
        const layer = outerLayer(target, cmd.face);
        const stride = faceNormal(cmd.face);
        // count = TOTAL cubes along the direction including the
        // source. The source already exists in `target`, so we add
        // count - 1 new layers walking outward from its outer face.
        const newLayers = cmd.count - 1;
        for (let step = 1; step <= newLayers; step++) {
          for (const cell of layer) {
            const pos: [number, number, number] = [
              cell[0] + stride[0] * step,
              cell[1] + stride[1] * step,
              cell[2] + stride[2] * step,
            ];
            upsert(makeInstance(cmd, pos, kindId));
          }
        }
        break;
      }
      default: {
        const _exhaustive: never = cmd;
        void _exhaustive;
      }
    }
  }

  const instances = Array.from(byVoxel.values());
  // Keep iteration order deterministic so the diff broadcaster sees a
  // stable JSON shape across runs of identical commands.
  instances.sort((a, b) => a.id.localeCompare(b.id));
  return { cubeSize, instances };
}

function makeInstance(
  cmd: SceneCommand,
  position: [number, number, number],
  kindId: string,
): ObjectInstance {
  return {
    id: `${cmd.id}@${position[0]},${position[1]},${position[2]}`,
    sourceCommandId: cmd.id,
    kindId,
    position: [position[0], position[1], position[2]],
  };
}

function voxelKey(position: [number, number, number]): string {
  return `${position[0]}|${position[1]}|${position[2]}`;
}

const FACE_NORMALS: Record<CubeFace, [number, number, number]> = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
};

function faceNormal(face: CubeFace): [number, number, number] {
  return FACE_NORMALS[face];
}

/**
 * Outermost layer of an instance set along a face direction.
 * Used by extrude to find the "starting plane" to tile from.
 *
 * For face `+x`: pick all instances whose x equals `max(x)`.
 * For face `-x`: pick all instances whose x equals `min(x)`.
 * Same for y and z.
 *
 * Returns positions, not full instances, since the caller only needs
 * coordinates to derive the next layer.
 */
function outerLayer(
  instances: ObjectInstance[],
  face: CubeFace,
): Array<[number, number, number]> {
  const axis = axisOf(face);
  const sign = signOf(face);
  let extreme = sign > 0 ? -Infinity : Infinity;
  for (const i of instances) {
    const v = i.position[axis];
    if (sign > 0 ? v > extreme : v < extreme) extreme = v;
  }
  const out: Array<[number, number, number]> = [];
  for (const i of instances) {
    if (i.position[axis] === extreme) {
      out.push([i.position[0], i.position[1], i.position[2]]);
    }
  }
  return out;
}

function axisOf(face: CubeFace): 0 | 1 | 2 {
  if (face === 'px' || face === 'nx') return 0;
  if (face === 'py' || face === 'ny') return 1;
  return 2;
}

function signOf(face: CubeFace): 1 | -1 {
  return face === 'px' || face === 'py' || face === 'pz' ? 1 : -1;
}

/**
 * Bounding box of a command's contribution. Useful for the inspector
 * to display "this object occupies (1,0,0) → (3,0,2), 9 cubes" and
 * for the editor's "select all instances by command" workflow.
 */
export function commandBounds(
  doc: SceneDocument,
  commandId: string,
  cubeSize: number,
): { min: [number, number, number]; max: [number, number, number]; count: number } | null {
  const compiled = compileScene(doc, cubeSize);
  const owned = compiled.instances.filter((i) => i.sourceCommandId === commandId);
  if (owned.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const i of owned) {
    for (let a = 0; a < 3; a++) {
      if (i.position[a] < min[a]) min[a] = i.position[a];
      if (i.position[a] > max[a]) max[a] = i.position[a];
    }
  }
  return { min, max, count: owned.length };
}
