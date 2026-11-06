import { signJoinToken } from './join-token.ts';
import { officeAllowsMultiSession } from './office-policy.ts';

const REQUEST_TIMEOUT_MS = 2_000;
const TOKEN_TTL_MS = 60_000;

export interface OfficeApiOptions {
  /** API origin, e.g. `http://host:4173`. */
  baseUrl: string;
  /** Signs the per-request bearer token; must equal the API's `OFFICEXR_REALTIME_TOKEN_SECRET`. Unset sends no token. */
  tokenSecret?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export type OfficeApi = ReturnType<typeof createOfficeApi>;

/** Backend data for the realtime server, read over the `packages/server` HTTP API acting as the given login. */
export function createOfficeApi({ baseUrl, tokenSecret, fetch: fetchFn = fetch, now = Date.now }: OfficeApiOptions) {
  const get = (path: string, login: string): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (tokenSecret) {
      headers.authorization = `Bearer ${signJoinToken(tokenSecret, { login, ttlMs: TOKEN_TTL_MS, now: now(), aud: 'api' })}`;
    }
    return fetchFn(new URL(path, baseUrl), { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  };

  return {
    /** Whether `login` may hold several live sessions in `officeId`. Any failure resolves `false`. */
    async allowsMultiSession(officeId: string, login: string): Promise<boolean> {
      try {
        const res = await get(`/api/offices/${encodeURIComponent(officeId)}`, login);
        if (res.status !== 200) {
          await res.body?.cancel();
          return false;
        }
        const office: unknown = await res.json();
        return !!office && typeof office === 'object' && officeAllowsMultiSession(office, login);
      } catch {
        return false;
      }
    },
  };
}
