import { PROP_OP_KIND, PROP_OP_RESULT_KIND, ZPropOpResult, type PropOp, type PropOpResult } from '@officexr/sdk';
import type { CustomFrames } from '../desk/requestDeskClaim';

export type RequestPropOp = (op: PropOp) => Promise<PropOpResult>;

export const PROP_OP_TIMEOUT_MS = 5000;

const UNAVAILABLE: PropOpResult = { ok: false, error: 'unavailable' };

export interface PropOpRequester {
  request: RequestPropOp;
  /** Resolves requests still waiting as unavailable and stops listening. */
  dispose(): void;
}

/**
 * Sends a place, turn or remove request and resolves with the server's verdict. The server replies to the sender in
 * order, so replies are matched to requests first-in-first-out. A request fails as unavailable at once while the
 * channel isn't live, when it drops, or after `timeoutMs` without a reply.
 */
export function createPropOpRequester(channel: CustomFrames, timeoutMs = PROP_OP_TIMEOUT_MS): PropOpRequester {
  const pending: ((result: PropOpResult) => void)[] = [];
  let live = false;
  const offResult = channel.onCustom(PROP_OP_RESULT_KIND, (payload) => {
    const parsed = ZPropOpResult.safeParse(payload);
    if (parsed.success) {
      pending.shift()?.(parsed.data);
    }
  });
  const failPending = () => [...pending].forEach((settle) => settle(UNAVAILABLE));
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
        const settle = (result: PropOpResult) => {
          clearTimeout(timer);
          const i = pending.indexOf(settle);
          if (i >= 0) {
            pending.splice(i, 1);
          }
          resolve(result);
        };
        const timer = setTimeout(() => settle(UNAVAILABLE), timeoutMs);
        pending.push(settle);
        channel.sendCustom(PROP_OP_KIND, op);
      }),
    dispose() {
      offResult();
      offStatus();
      failPending();
    },
  };
}
