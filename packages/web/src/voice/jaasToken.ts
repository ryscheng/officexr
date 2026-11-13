import { apiFetch, paths } from '../apiOrigin';

export interface JaasToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** A JaaS JWT the server minted for the signed-in user in `officeId`; throws when it has none to give. */
export async function fetchJaasToken(officeId: string, fetchFn: typeof apiFetch = apiFetch): Promise<JaasToken> {
  const res = await fetchFn(paths.voiceToken(officeId));
  if (!res.ok) {
    throw new Error(`Voice token request failed (${res.status})`);
  }
  const { token, expiresAt } = (await res.json()) as Partial<JaasToken>;
  if (typeof token !== 'string' || typeof expiresAt !== 'number') {
    throw new Error('Voice token response had no token');
  }
  return { token, expiresAt };
}

/** Refetch this long before expiry, so a call joined just before it still connects. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/** Hands out `first` until it nears expiry, then a freshly fetched token (one request at a time). */
export function jaasTokenSource(first: JaasToken, refetch: () => Promise<JaasToken>, now = () => Date.now()): () => Promise<string> {
  let latest = first;
  let refreshing: Promise<JaasToken> | null = null;
  return async () => {
    if (now() < latest.expiresAt - REFRESH_MARGIN_MS) {
      return latest.token;
    }
    // A failed refresh clears `refreshing`, so the next join retries instead of sticking.
    refreshing ??= refetch().finally(() => (refreshing = null));
    latest = await refreshing;
    return latest.token;
  };
}
