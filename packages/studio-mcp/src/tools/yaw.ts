import { isYawAllowed, type CatalogStorage } from '@officexr/world/scenes';

/** Shared by the room, layout and kind tool descriptions. */
export const YAW_CONTRACT =
  'A placeObject may set `yawDeg` (degrees, optional, default 0, normalised to [0, 360)): rotation about +Y in ' +
  'the same sense as a map room\'s `rotationY`, pivoting on the centre of the object\'s unrotated footprint. ' +
  '`position` stays the min corner of the unrotated box; occupancy and collision use the axis-aligned box around ' +
  'the rotated footprint. `yawDeg` must be a multiple of the kind\'s `rotationStepDeg` (default 90).';

/**
 * A `beforeSave` hook that rejects a placeObject whose `yawDeg` its kind does not allow. Kinds missing from the
 * catalog are not checked, and a malformed document is left for the store's own validation to reject.
 */
export function rejectDisallowedYaws(catalog: CatalogStorage): (doc: unknown) => Promise<void> {
  return async (doc) => {
    const commands = (doc as { commands?: unknown } | null)?.commands;
    const yawed = Array.isArray(commands)
      ? commands.filter((c) => c?.op === 'placeObject' && typeof c.yawDeg === 'number')
      : [];
    if (yawed.length === 0) {
      return;
    }
    const kinds = new Map((await catalog.load())?.kinds.map((kind) => [kind.id, kind]));
    for (const { id, kindId, yawDeg } of yawed) {
      const kind = kinds.get(kindId);
      if (kind && !isYawAllowed(kind, yawDeg)) {
        throw new Error(
          `placeObject "${id}": yawDeg ${yawDeg} is not allowed for kind "${kindId}" (rotationStepDeg ${kind.rotationStepDeg ?? 90})`,
        );
      }
    }
  };
}
