import { loginOf, PROP_OP_KIND, PROP_OP_RESULT_KIND, ZPropOp, type PropOpResult } from '@officexr/sdk';
import type { OfficeApi, PropsOutcome } from './office-api.ts';
import type { CustomFrameHandler, Room } from './server.ts';

export type PlacedPropsApi = Pick<OfficeApi, 'listProps' | 'propOp'>;

const UNAVAILABLE: PropsOutcome = { ok: false, error: 'unavailable' };

export function createPlacedPropsHandler(api: PlacedPropsApi | undefined): CustomFrameHandler {
  /** Per-room tail of pending ops: replies come back in call order, so the last broadcast is never a stale list. */
  const queues = new WeakMap<Room, Promise<unknown>>();
  return (client, kind, payload, room) => {
    if (kind !== PROP_OP_KIND) {
      return false;
    }
    const parsed = ZPropOp.safeParse(payload);
    if (!parsed.success) {
      return false;
    }
    const login = loginOf(client.userId);
    const run = async (): Promise<void> => {
      const outcome = api ? await api.propOp(room.officeId, login, parsed.data) : UNAVAILABLE;
      const { reqId } = parsed.data;
      const result: PropOpResult = outcome.ok ? { ok: true, reqId } : { ok: false, error: outcome.error, reqId };
      room.sendCustom(PROP_OP_RESULT_KIND, result, client.userId);
      if (outcome.ok) {
        room.pushPlacedProps(outcome.props);
      }
    };
    const queued = (queues.get(room) ?? Promise.resolve()).then(run).catch((err: unknown) => {
      console.error('[realtime-server] prop op failed:', err);
    });
    queues.set(room, queued);
    return true;
  };
}
