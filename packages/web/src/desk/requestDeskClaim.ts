import { DESK_CLAIM_KIND, DESK_CLAIM_RESULT_KIND, ZDeskClaimResult, type DeskClaimResult } from '@officexr/sdk/realtime';

/** The slice of `WsChannel` the requester needs. */
export interface CustomFrames {
  sendCustom(kind: string, payload: unknown): void;
  onCustom(kind: string, handler: (payload: unknown) => void): () => void;
  /** Calls `handler` with the current status right away, then on every change. */
  onStatusChange(handler: (status: string) => void): () => void;
}

export type RequestDeskClaim = (deskId: string | null) => Promise<DeskClaimResult>;

export const DESK_CLAIM_TIMEOUT_MS = 5000;

const UNAVAILABLE: DeskClaimResult = { ok: false, error: 'unavailable' };

export interface DeskClaimRequester {
  request: RequestDeskClaim;
  /** Resolves requests still waiting as unavailable and stops listening. */
  dispose(): void;
}

/**
 * Claims a desk (a null `deskId` releases the caller's) and resolves with the server's verdict. The server replies to
 * the sender in order, so replies are matched to requests first-in-first-out. A request fails as unavailable at once
 * while the channel isn't live, when it drops, or after `timeoutMs` without a reply.
 */
export function createDeskClaimRequester(channel: CustomFrames, timeoutMs = DESK_CLAIM_TIMEOUT_MS): DeskClaimRequester {
  const pending: ((result: DeskClaimResult) => void)[] = [];
  let live = false;
  const offResult = channel.onCustom(DESK_CLAIM_RESULT_KIND, (payload) => {
    const parsed = ZDeskClaimResult.safeParse(payload);
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
    request: (deskId) =>
      new Promise((resolve) => {
        if (!live) {
          resolve(UNAVAILABLE);
          return;
        }
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
      }),
    dispose() {
      offResult();
      offStatus();
      failPending();
    },
  };
}
