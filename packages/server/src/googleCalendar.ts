import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BusyInterval } from './calendarStatus';

/** Free/busy only: never event titles or attendees. */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.freebusy';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';
const REQUEST_TIMEOUT_MS = 5_000;
const STATE_TTL_MS = 10 * 60 * 1000;

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleCalendarError extends Error {
  constructor(
    readonly code: 'invalid_grant' | 'scope_missing' | 'no_refresh_token' | 'failed',
    message: string,
  ) {
    super(message);
  }
}

export interface ConsentUrlOptions {
  config: GoogleCalendarConfig;
  state: string;
  loginHint: string;
}

export function consentUrl({ config, state, loginHint }: ConsentUrlOptions): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    login_hint: loginHint,
    state,
  }).toString();
  return url.href;
}

export interface OAuthState {
  login: string;
  returnTo: string;
}

const sign = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function signOAuthState(secret: string, state: OAuthState, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ l: state.login, r: state.returnTo, e: now + STATE_TTL_MS })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyOAuthState(secret: string, value: string, now = Date.now()): OAuthState | null {
  const [payload, signature, ...rest] = value.split('.');
  if (!payload || !signature || rest.length) {
    return null;
  }
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  try {
    const { l, r, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { l?: unknown; r?: unknown; e?: unknown };
    return typeof l === 'string' && typeof r === 'string' && typeof e === 'number' && e > now ? { login: l, returnTo: r } : null;
  } catch {
    return null;
  }
}

export interface GoogleCalendarClient {
  exchangeCode: (code: string) => Promise<{ refreshToken: string }>;
  accessToken: (refreshToken: string) => Promise<string>;
  freeBusy: (accessToken: string, timeMin: Date, timeMax: Date) => Promise<BusyInterval[]>;
  revoke: (token: string) => Promise<void>;
}

export function createGoogleCalendarClient(config: GoogleCalendarConfig, fetchFn: typeof fetch = fetch): GoogleCalendarClient {
  const post = (url: string, init: { body: string; contentType: string; authorization?: string }) =>
    fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': init.contentType, ...(init.authorization && { authorization: init.authorization }) },
      body: init.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  const tokenRequest = async (params: Record<string, string>): Promise<Record<string, unknown>> => {
    const res = await post(TOKEN_URL, {
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }).toString(),
      contentType: 'application/x-www-form-urlencoded',
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new GoogleCalendarError(body.error === 'invalid_grant' ? 'invalid_grant' : 'failed', `Google token request failed (${res.status})`);
    }
    return body;
  };
  return {
    async exchangeCode(code) {
      const body = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri });
      if (typeof body.scope !== 'string' || !body.scope.split(' ').includes(CALENDAR_SCOPE)) {
        throw new GoogleCalendarError('scope_missing', 'The calendar permission was not granted');
      }
      if (typeof body.refresh_token !== 'string' || !body.refresh_token) {
        throw new GoogleCalendarError('no_refresh_token', 'Google returned no refresh token');
      }
      return { refreshToken: body.refresh_token };
    },
    async accessToken(refreshToken) {
      const body = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
      if (typeof body.access_token !== 'string') {
        throw new GoogleCalendarError('failed', 'Google returned no access token');
      }
      return body.access_token;
    },
    async freeBusy(accessToken, timeMin, timeMax) {
      const res = await post(FREEBUSY_URL, {
        body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: [{ id: 'primary' }] }),
        contentType: 'application/json',
        authorization: `Bearer ${accessToken}`,
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new GoogleCalendarError('failed', `Google free/busy request failed (${res.status})`);
      }
      const body = (await res.json()) as { calendars?: { primary?: { busy?: BusyInterval[]; errors?: unknown[] } } };
      const primary = body.calendars?.primary;
      if (!primary || primary.errors?.length) {
        throw new GoogleCalendarError('failed', 'Google returned no free/busy for the primary calendar');
      }
      return primary.busy ?? [];
    },
    async revoke(token) {
      const res = await post(REVOKE_URL, { body: new URLSearchParams({ token }).toString(), contentType: 'application/x-www-form-urlencoded' });
      await res.body?.cancel();
    },
  };
}
