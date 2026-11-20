import { frozenClaimants, type FrozenClaimant, type OfficeState, type Vec3 } from '@officexr/sdk';
import { resolvePlayerModel, type CatalogCharacters, type PlayerModel } from '../characters/registry.ts';
import { seatedPlayerPose, seatOf } from './seating.ts';
import type { KindResolver } from './geometry-service.ts';
import type { InstanceGeometryService } from './types.ts';

export interface FrozenAvatar extends FrozenClaimant {
  /** Store-style body position and yaw, as a seated player would have. */
  pos: Vec3;
  yaw: number;
  model: PlayerModel;
}

type FrozenState = Pick<
  OfficeState,
  'selfId' | 'players' | 'deskClaims' | 'deskClaimants' | 'deskAreas' | 'worldObjects' | 'worldSettings' | 'worldConstants'
>;

/** The absent claimants whose desk has a seat to sit on, each placed at that seat. */
export function frozenAvatars(
  state: FrozenState,
  catalog: KindResolver,
  geometry: Pick<InstanceGeometryService, 'worldAABB'>,
  characters: CatalogCharacters,
): FrozenAvatar[] {
  return frozenClaimants(state).flatMap((claimant) => {
    const seatId = state.deskAreas.find((area) => area.id === claimant.deskId)?.seatInstanceId;
    const seat = seatId ? seatOf(state, catalog, geometry, seatId) : null;
    if (!seat) {
      return [];
    }
    const { pos, yaw } = seatedPlayerPose(seat.pose, state.worldSettings.charRadius);
    const model = resolvePlayerModel(
      claimant.login,
      { model: claimant.characterId ?? 'default' },
      state.worldConstants.ghostAvatar,
      characters,
    );
    return [{ ...claimant, pos, yaw, model }];
  });
}

export const sameFrozenAvatars = (a: FrozenAvatar[], b: FrozenAvatar[]): boolean =>
  a.length === b.length &&
  a.every(
    (f, i) =>
      f.login === b[i].login &&
      f.deskId === b[i].deskId &&
      f.name === b[i].name &&
      f.claimedAt === b[i].claimedAt &&
      JSON.stringify(f.calendar) === JSON.stringify(b[i].calendar) &&
      JSON.stringify(f.slack) === JSON.stringify(b[i].slack) &&
      f.model.url === b[i].model.url &&
      f.pos.x === b[i].pos.x &&
      f.pos.y === b[i].pos.y &&
      f.pos.z === b[i].pos.z &&
      f.yaw === b[i].yaw,
  );
