import {
  DESK_CLAIM_KIND,
  DESK_CLAIM_RESULT_KIND,
  loginOf,
  ZDeskClaim,
  type DeskClaimResult,
} from '@officexr/sdk';
import type { DeskClaimOutcome, OfficeApi } from './office-api.ts';
import type { CustomFrameHandler, Room } from './server.ts';

export type DeskClaimsApi = Pick<OfficeApi, 'listDeskClaims' | 'claimDesk' | 'releaseDesk'>;

const UNAVAILABLE: DeskClaimOutcome = { ok: false, error: 'unavailable' };

/** Per-room tail of pending claim calls: replies come back in call order, so the last broadcast is never a stale list. */
const queues = new WeakMap<Room, Promise<unknown>>();

/** Handles `desk:claim` frames by persisting through `api`, replying to the sender and broadcasting the new claims. Without an API every claim is `unavailable`. */
export function createDeskClaimHandler(api: DeskClaimsApi | undefined): CustomFrameHandler {
  return (client, kind, payload, room) => {
    if (kind !== DESK_CLAIM_KIND) {
      return false;
    }
    const parsed = ZDeskClaim.safeParse(payload);
    if (!parsed.success) {
      return false;
    }
    const { deskId } = parsed.data;
    const login = loginOf(client.userId);
    const run = async (): Promise<void> => {
      const outcome = !api
        ? UNAVAILABLE
        : deskId === null
          ? await api.releaseDesk(room.officeId, login)
          : await api.claimDesk(room.officeId, login, deskId);
      const result: DeskClaimResult = outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
      room.sendCustom(DESK_CLAIM_RESULT_KIND, result, client.userId);
      if (outcome.ok) {
        room.pushDeskClaims(outcome.claims);
      }
    };
    const queued = (queues.get(room) ?? Promise.resolve()).then(run).catch((err: unknown) => {
      console.error('[realtime-server] desk claim failed:', err);
    });
    queues.set(room, queued);
    return true;
  };
}
