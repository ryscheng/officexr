import { PROP_OP_KIND, PROP_OP_RESULT_KIND, ZPropOpResult, type PropOp, type PropOpResult } from '@officexr/sdk';
import type { CustomFrames } from '../desk/requestDeskClaim';

export type RequestPropOp = (op: PropOp) => Promise<PropOpResult>;

export const PROP_OP_TIMEOUT_MS = 5000;

const UNAVAILABLE: PropOpResult = { ok: false, error: 'unavailable' };

export interface PropOpRequester {
  request: RequestPropOp;
  dispose(): void;
}

// Each request carries an id the server echoes, so a reply that arrives after its timeout is dropped, not given to the next request.
export function createPropOpRequester(channel: CustomFrames, timeoutMs = PROP_OP_TIMEOUT_MS): PropOpRequester {
  const pending = new Map<string, (result: PropOpResult) => void>();
  let live = false;
  let counter = 0;
  const offResult = channel.onCustom(PROP_OP_RESULT_KIND, (payload) => {
    const parsed = ZPropOpResult.safeParse(payload);
    if (parsed.success && parsed.data.reqId !== undefined) {
      pending.get(parsed.data.reqId)?.(parsed.data);
    }
  });
  const failPending = () => [...pending.values()].forEach((settle) => settle(UNAVAILABLE));
  const offStatus = channel.onStatusChange((status) => {
    live = status === 'live';
    if (!live) {
      failPending();
    }
  });
  return {
    request: (op) =>
      new Promise((resolve) => {
        if (!live) {
          resolve(UNAVAILABLE);
          return;
        }
        const reqId = `r${++counter}`;
        const settle = (result: PropOpResult) => {
          clearTimeout(timer);
          pending.delete(reqId);
          resolve(result);
        };
        const timer = setTimeout(() => settle(UNAVAILABLE), timeoutMs);
        pending.set(reqId, settle);
        channel.sendCustom(PROP_OP_KIND, { ...op, reqId });
      }),
    dispose() {
      offResult();
      offStatus();
      failPending();
    },
  };
}
