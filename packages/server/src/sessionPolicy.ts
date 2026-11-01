import { officeAllowsMultiSession } from '@officexr/realtime-server/server';
import type { QueryOffices } from './api';

const POLICY_TIMEOUT_MS = 2_000;

/** A `RealtimeServer` `sessionPolicy` over the offices table. A lookup slower than `timeoutMs` resolves `false`,
 * since the realtime server waits on the policy before admitting a join. */
export function officeSessionPolicy(queryOffices: QueryOffices, timeoutMs = POLICY_TIMEOUT_MS) {
  return (officeId: string, login: string): Promise<boolean> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(resolve, timeoutMs, false);
    });
    const lookup = queryOffices(officeId).then(([office]) => !!office && officeAllowsMultiSession(office, login));
    return Promise.race([lookup, timeout]).finally(() => clearTimeout(timer));
  };
}
