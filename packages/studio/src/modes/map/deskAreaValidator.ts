import type { ApplicationApi } from '@officexr/world/app';
import {
  isBakedRoom,
  migrateMapV1toV2,
  type LayoutDocument,
  type MapDocumentV2,
  type RoomDocument,
  type SerializedMap,
} from '@officexr/world/scenes';
import { assertNever } from '../../assertNever.ts';
import { deskAreasOf } from './deskAreaGeometry.ts';
import { findDeskAreaViolations, type DeskAreaViolation } from './deskAreaViolations.ts';

/** `pending` means the map's rooms are not all loaded, so validity is unknown and saving must wait. */
export type DeskAreaCheck =
  | { type: 'pending'; reason: string }
  | { type: 'checked'; violations: DeskAreaViolation[] };

export const NO_DESK_AREA_VIOLATIONS: DeskAreaCheck = { type: 'checked', violations: [] };

export function blocksSave(check: DeskAreaCheck): boolean {
  return check.type === 'pending'
    ? true
    : check.type === 'checked'
      ? check.violations.length > 0
      : assertNever(check);
}

export function violationsOf(check: DeskAreaCheck): DeskAreaViolation[] {
  return check.type === 'pending'
    ? []
    : check.type === 'checked'
      ? check.violations
      : assertNever(check);
}

/** What the room library has loaded, and which names it has already tried (loaded or failed). */
export interface DeskAreaLibrary {
  rooms: ReadonlyMap<string, RoomDocument>;
  layouts: ReadonlyMap<string, LayoutDocument>;
  settledRooms: ReadonlySet<string>;
  settledLayouts: ReadonlySet<string>;
}

interface Deps {
  catalogReady: boolean;
  roomService: Pick<ApplicationApi['rooms'], 'compileMap'>;
  catalog: Pick<ApplicationApi['catalog'], 'getKind'>;
  geometry: Pick<ApplicationApi['geometry'], 'worldAABBOfInstance'>;
  library: DeskAreaLibrary;
}

/**
 * Builds the validator for one library snapshot. A map without desk areas is
 * trivially checked; otherwise every placed room (and baked layout) must have
 * loaded, since compiling around a missing room would silently pass. A room
 * that failed to load stays pending: the map can't be proven valid.
 * Compiled instances are reused while `doc.rooms` is unchanged.
 */
export function createDeskAreaValidator(deps: Deps): (doc: SerializedMap) => DeskAreaCheck {
  const { catalogReady, roomService, catalog, geometry, library } = deps;
  const compileInstances = (doc: MapDocumentV2) =>
    roomService.compileMap(doc, library.rooms, library.layouts).instances;
  let compiled: { rooms: SerializedMap['rooms']; instances: ReturnType<typeof compileInstances> } | null = null;

  return (doc) => {
    if (deskAreasOf(doc).length === 0) {
      return NO_DESK_AREA_VIOLATIONS;
    }
    if (!catalogReady) {
      return { type: 'pending', reason: 'loading the object catalog' };
    }
    const roomNames = [...new Set(doc.rooms.map((ri) => ri.roomName))];
    const layoutNames = roomNames.flatMap((n) => library.rooms.get(n)?.layoutName ?? []);
    if (
      roomNames.some((n) => !library.settledRooms.has(n)) ||
      layoutNames.some((n) => !library.settledLayouts.has(n))
    ) {
      return { type: 'pending', reason: 'loading rooms' };
    }
    const failed = [
      ...roomNames.filter((n) => !library.rooms.has(n)),
      ...layoutNames.filter((n) => !library.layouts.has(n)),
    ];
    if (failed.length > 0) {
      return { type: 'pending', reason: `could not load ${failed.join(', ')}` };
    }
    const v2 =
      doc.schemaVersion === 1
        ? migrateMapV1toV2(doc, (n) => {
            const room = library.rooms.get(n);
            return room !== undefined && isBakedRoom(room);
          })
        : doc;
    if (compiled?.rooms !== doc.rooms) {
      compiled = { rooms: doc.rooms, instances: compileInstances(v2) };
    }
    return {
      type: 'checked',
      violations: findDeskAreaViolations(v2, compiled.instances, catalog, geometry),
    };
  };
}
