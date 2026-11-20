import { PROTOCOL, type DeskClaimant, type DeskClaimResult, type PlacedProp, type PropOp, type PropOpResult } from '@officexr/sdk';
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

export type DeskClaimOutcome =
  | { ok: true; claims: Record<string, string>; claimants?: Record<string, DeskClaimant> }
  | { ok: false; error: Extract<DeskClaimResult, { ok: false }>['error'] };

export type PropsOutcome =
  | { ok: true; props: PlacedProp[] }
  | { ok: false; error: Extract<PropOpResult, { ok: false }>['error'] };

export type OfficeApi = ReturnType<typeof createOfficeApi>;

/** Backend data for the realtime server, read over the `packages/server` HTTP API acting as the given login. */
export function createOfficeApi({ baseUrl, tokenSecret, fetch: fetchFn = fetch, now = Date.now }: OfficeApiOptions) {
  const request = (method: string, path: string, login: string, body?: unknown): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (tokenSecret) {
      headers.authorization = `Bearer ${signJoinToken(tokenSecret, { login, ttlMs: TOKEN_TTL_MS, now: now(), aud: 'api' })}`;
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    return fetchFn(new URL(path, baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };
  const officePath = (officeId: string) => `/api/offices/${encodeURIComponent(officeId)}`;
  const deskClaimsPath = (officeId: string) => `${officePath(officeId)}/desk-claims`;

  const propsPath = (officeId: string) => `${officePath(officeId)}/props`;

  const propsOutcome = async (send: () => Promise<Response>): Promise<PropsOutcome> => {
    try {
      const res = await send();
      if (res.status === 200) {
        const parsed = PROTOCOL['office:props'].schema.safeParse(await res.json());
        return parsed.success ? { ok: true, props: parsed.data.props } : { ok: false, error: 'unavailable' };
      }
      await res.body?.cancel();
      return { ok: false, error: res.status === 400 ? 'invalid' : res.status === 404 ? 'not-found' : res.status === 409 ? 'limit' : 'unavailable' };
    } catch {
      return { ok: false, error: 'unavailable' };
    }
  };

  const claimsOutcome = async (send: () => Promise<Response>): Promise<DeskClaimOutcome> => {
    try {
      const res = await send();
      if (res.status === 200) {
        const parsed = PROTOCOL['desk:claims'].schema.safeParse(await res.json());
        return parsed.success ? { ok: true, claims: parsed.data.claims, claimants: parsed.data.claimants } : { ok: false, error: 'unavailable' };
      }
      await res.body?.cancel();
      return { ok: false, error: res.status === 400 ? 'unknown-desk' : res.status === 409 ? 'taken' : 'unavailable' };
    } catch {
      return { ok: false, error: 'unavailable' };
    }
  };

  return {
    /** Whether `login` may hold several live sessions in `officeId`. Any failure resolves `false`. */
    async allowsMultiSession(officeId: string, login: string): Promise<boolean> {
      try {
        const res = await request('GET', officePath(officeId), login);
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

    /** The office's current claims; any failure is `unavailable`. */
    listDeskClaims: (officeId: string, login: string): Promise<DeskClaimOutcome> =>
      claimsOutcome(() => request('GET', deskClaimsPath(officeId), login)),

    claimDesk: (officeId: string, login: string, deskId: string): Promise<DeskClaimOutcome> =>
      claimsOutcome(() => request('PUT', `${deskClaimsPath(officeId)}/me`, login, { deskId })),

    listProps: (officeId: string, login: string): Promise<PropsOutcome> =>
      propsOutcome(() => request('GET', propsPath(officeId), login)),

    propOp: (officeId: string, login: string, op: PropOp): Promise<PropsOutcome> =>
      propsOutcome(() => request('POST', propsPath(officeId), login, op)),

    releaseDesk: (officeId: string, login: string): Promise<DeskClaimOutcome> =>
      claimsOutcome(() => request('DELETE', `${deskClaimsPath(officeId)}/me`, login)),
  };
}
