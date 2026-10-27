import {
  DEFAULT_ROTATION_STEP_DEG,
  isYawAllowed,
  type CatalogStorage,
  type LayoutDocument,
  type PlaceObjectCommand,
  type SerializedScene,
} from '@officexr/world/scenes';

export const YAW_CONTRACT =
  'A placeObject may set `yawDeg` (degrees, optional, default 0, normalised to [0, 360)): rotation about +Y in ' +
  'the same sense as a map room\'s `rotationY` and three.js `rotation.y` (counter-clockwise seen from above, +X ' +
  'turns toward -Z), pivoting on the centre of the object\'s unrotated footprint. ' +
  '`position` stays the min corner of the unrotated bounding box; occupancy and collision use the axis-aligned box ' +
  'around the rotated footprint. `yawDeg` must be a multiple of the kind\'s `rotationStepDeg` (default 90).';

type YawedPlacement = PlaceObjectCommand & { yawDeg: number };

/**
 * A `beforeSave` hook that rejects a placeObject whose `yawDeg` its kind does not allow. `deserialize` is the
 * document's own deserializer. Kinds missing from the catalog are not checked.
 */
export function rejectDisallowedYaws(
  catalog: CatalogStorage,
  deserialize: (doc: unknown) => SerializedScene | LayoutDocument,
): (doc: unknown) => Promise<void> {
  return async (doc) => {
    const parsed = deserialize(doc);
    const yawed = ('commands' in parsed ? parsed.commands : []).filter(
      (command): command is YawedPlacement => command.op === 'placeObject' && command.yawDeg !== undefined,
    );
    if (yawed.length === 0) {
      return;
    }
    const kinds = new Map((await catalog.load())?.kinds.map((kind) => [kind.id, kind]));
    for (const { id, kindId, yawDeg } of yawed) {
      const kind = kinds.get(kindId);
      if (kind && !isYawAllowed(kind, yawDeg)) {
        throw new Error(
          `placeObject "${id}": yawDeg ${yawDeg} is not allowed for kind "${kindId}" ` +
            `(rotationStepDeg ${kind.rotationStepDeg ?? DEFAULT_ROTATION_STEP_DEG})`,
        );
      }
    }
  };
}
