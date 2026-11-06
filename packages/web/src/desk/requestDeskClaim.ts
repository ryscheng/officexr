import { DESK_CLAIM_KIND, DESK_CLAIM_RESULT_KIND, ZDeskClaimResult, type DeskClaimResult } from '@officexr/sdk/realtime';

/** The slice of `WsChannel` the requester needs. */
export interface CustomFrames {
  sendCustom(kind: string, payload: unknown): void;
  onCustom(kind: string, handler: (payload: unknown) => void): unknown;
}

export type RequestDeskClaim = (deskId: string | null) => Promise<DeskClaimResult>;

export const DESK_CLAIM_TIMEOUT_MS = 5000;

const UNAVAILABLE: DeskClaimResult = { ok: false, error: 'unavailable' };

/**
 * Claims `deskId` (null releases the caller's desk) and resolves with the server's verdict. The server replies to the
 * sender in order, so replies are matched to requests first-in-first-out. A request the server never answers (dropped
 * connection, no reply) resolves as unavailable after `timeoutMs`.
 */
export function createDeskClaimRequester(
  channel: CustomFrames,
  timeoutMs = DESK_CLAIM_TIMEOUT_MS,
): RequestDeskClaim {
  const pending: ((result: DeskClaimResult) => void)[] = [];
  channel.onCustom(DESK_CLAIM_RESULT_KIND, (payload) => {
    const parsed = ZDeskClaimResult.safeParse(payload);
    if (parsed.success) {
      pending.shift()?.(parsed.data);
    }
  });
  return (deskId) =>
    new Promise((resolve) => {
      const settle = (result: DeskClaimResult) => {
        clearTimeout(timer);
        const i = pending.indexOf(settle);
        if (i >= 0) {
          pending.splice(i, 1);
        }
        resolve(result);
      };
      // ponytail: a reply arriving after its timeout is matched to the next request in line.
      const timer = setTimeout(() => settle(UNAVAILABLE), timeoutMs);
      pending.push(settle);
      channel.sendCustom(DESK_CLAIM_KIND, { deskId });
    });
}
