import { describe, expect, it, vi } from 'vitest';
import { STATUS_WINDOW_MS } from './calendarStatus';
import { createCalendarService, type CalendarLinks } from './calendarService';
import { CALENDAR_SCOPE, consentUrl, createGoogleCalendarClient, GoogleCalendarError, signOAuthState, verifyOAuthState } from './googleCalendar';
import { createSecretBox } from './secretBox';

const CONFIG = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://office.test/auth/google/calendar/callback' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  body: string;
  authorization: string | null;
}

function fakeGoogle(routes: Record<string, (body: string) => Response>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? '');
    calls.push({ url, body, authorization: new Headers(init?.headers).get('authorization') });
    const route = routes[url];
    if (!route) {
      throw new Error(`unexpected request to ${url}`);
    }
    return route(body);
  });
  return { calls, fetchFn: fetchFn as unknown as typeof fetch };
}

const TOKEN = 'https://oauth2.googleapis.com/token';
const FREEBUSY = 'https://www.googleapis.com/calendar/v3/freeBusy';
const REVOKE = 'https://oauth2.googleapis.com/revoke';

describe('consentUrl', () => {
  it('asks only for free/busy, offline, with consent so a refresh token is returned', () => {
    const url = new URL(consentUrl({ config: CONFIG, state: 'st', loginHint: 'a@example.com' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid',
      redirect_uri: CONFIG.redirectUri,
      response_type: 'code',
      scope: CALENDAR_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      login_hint: 'a@example.com',
      state: 'st',
    });
    expect(CALENDAR_SCOPE).toBe('https://www.googleapis.com/auth/calendar.freebusy');
  });
});

describe('OAuth state', () => {
  const state = { login: 'a@example.com', returnTo: '/room/x' };

  it('round-trips until it expires', () => {
    const signed = signOAuthState('secret', state, 1_000);
    expect(verifyOAuthState('secret', signed, 1_000 + 9 * 60_000)).toEqual(state);
    expect(verifyOAuthState('secret', signed, 1_000 + 10 * 60_000)).toBeNull();
  });

  it('rejects a forged payload, another secret and junk', () => {
    const [payload, signature] = signOAuthState('secret', state, 1_000).split('.');
    const forged = Buffer.from(JSON.stringify({ l: 'b@example.com', r: '/', e: 9e15 })).toString('base64url');
    expect(verifyOAuthState('secret', `${forged}.${signature}`, 1_000)).toBeNull();
    expect(verifyOAuthState('other', `${payload}.${signature}`, 1_000)).toBeNull();
    expect(verifyOAuthState('secret', 'junk', 1_000)).toBeNull();
    expect(verifyOAuthState('secret', '', 1_000)).toBeNull();
  });
});

describe('createGoogleCalendarClient', () => {
  it('exchanges the code for a refresh token and keeps nothing else', async () => {
    const google = fakeGoogle({ [TOKEN]: () => json({ access_token: 'at', refresh_token: 'rt', scope: `openid ${CALENDAR_SCOPE}` }) });
    const client = createGoogleCalendarClient(CONFIG, google.fetchFn);
    expect(await client.exchangeCode('the-code')).toEqual({ refreshToken: 'rt' });
    const sent = new URLSearchParams(google.calls[0].body);
    expect(Object.fromEntries(sent)).toEqual({ client_id: 'cid', client_secret: 'csecret', grant_type: 'authorization_code', code: 'the-code', redirect_uri: CONFIG.redirectUri });
  });

  it('rejects a consent that left the calendar scope unticked, and a missing refresh token', async () => {
    const noScope = createGoogleCalendarClient(CONFIG, fakeGoogle({ [TOKEN]: () => json({ refresh_token: 'rt', scope: 'openid email' }) }).fetchFn);
    await expect(noScope.exchangeCode('c')).rejects.toMatchObject({ code: 'scope_missing' });
    const noRefresh = createGoogleCalendarClient(CONFIG, fakeGoogle({ [TOKEN]: () => json({ scope: CALENDAR_SCOPE }) }).fetchFn);
    await expect(noRefresh.exchangeCode('c')).rejects.toMatchObject({ code: 'no_refresh_token' });
  });

  it('marks a revoked grant as invalid_grant', async () => {
    const client = createGoogleCalendarClient(CONFIG, fakeGoogle({ [TOKEN]: () => json({ error: 'invalid_grant' }, 400) }).fetchFn);
    await expect(client.accessToken('rt')).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('asks free/busy for the primary calendar only, with a bearer token', async () => {
    const google = fakeGoogle({ [FREEBUSY]: () => json({ calendars: { primary: { busy: [{ start: 'a', end: 'b' }] } } }) });
    const client = createGoogleCalendarClient(CONFIG, google.fetchFn);
    const busy = await client.freeBusy('at', new Date('2026-11-20T10:00:00Z'), new Date('2026-11-20T18:00:00Z'));
    expect(busy).toEqual([{ start: 'a', end: 'b' }]);
    expect(google.calls[0].authorization).toBe('Bearer at');
    expect(JSON.parse(google.calls[0].body)).toEqual({ timeMin: '2026-11-20T10:00:00.000Z', timeMax: '2026-11-20T18:00:00.000Z', items: [{ id: 'primary' }] });
  });

  it('fails when Google reports an error for the calendar', async () => {
    const client = createGoogleCalendarClient(CONFIG, fakeGoogle({ [FREEBUSY]: () => json({ calendars: { primary: { errors: [{ reason: 'notFound' }] } } }) }).fetchFn);
    await expect(client.freeBusy('at', new Date(), new Date())).rejects.toBeInstanceOf(GoogleCalendarError);
  });
});

describe('createCalendarService', () => {
  const NOW = Date.parse('2026-11-20T14:20:00Z');
  const box = createSecretBox('a-long-test-secret-value');

  function setup(routes: Record<string, (body: string) => Response>) {
    const stored = new Map<string, string>();
    const links: CalendarLinks = {
      getMany: vi.fn(async (logins: string[]) => Object.fromEntries(logins.filter((l) => stored.has(l)).map((l) => [l, stored.get(l)!]))),
      set: async (login, sealed) => void stored.set(login, sealed),
      remove: async (login, onlySealed) => {
        const sealed = stored.get(login) ?? null;
        if (onlySealed !== undefined && sealed !== onlySealed) {
          return null;
        }
        stored.delete(login);
        return sealed;
      },
    };
    const google = fakeGoogle(routes);
    let now = NOW;
    const service = createCalendarService({ client: createGoogleCalendarClient(CONFIG, google.fetchFn), links, box, now: () => now });
    return { stored, links, google, service, advance: (ms: number) => void (now += ms) };
  }
  const happyRoutes = (busy: unknown[] = [{ start: '2026-11-20T14:00:00Z', end: '2026-11-20T15:00:00Z' }]) => ({
    [TOKEN]: (body: string) => (body.includes('authorization_code') ? json({ refresh_token: 'rt-1', scope: CALENDAR_SCOPE }) : json({ access_token: 'at-1' })),
    [FREEBUSY]: () => json({ calendars: { primary: { busy } } }),
    [REVOKE]: () => new Response(null, { status: 200 }),
  });

  it('stores the refresh token encrypted, never in plaintext', async () => {
    const { stored, service } = setup(happyRoutes());
    await service.connect('a@example.com', 'code');
    const sealed = stored.get('a@example.com')!;
    expect(sealed).not.toContain('rt-1');
    expect(box.decrypt(sealed, 'a@example.com')).toBe('rt-1');
    expect(await service.isConnected('a@example.com')).toBe(true);
    expect(await service.isConnected('b@example.com')).toBe(false);
  });

  it('maps free/busy to a status, and leaves out logins with no calendar', async () => {
    const { service } = setup(happyRoutes());
    await service.connect('a@example.com', 'code');
    expect(await service.statuses(['a@example.com', 'b@example.com'])).toEqual({ 'a@example.com': { busy: true, until: '2026-11-20T15:00:00.000Z' } });
  });

  it('asks Google for the next 8 hours only', async () => {
    const { service, google } = setup(happyRoutes());
    await service.connect('a@example.com', 'code');
    await service.statuses(['a@example.com']);
    const request = JSON.parse(google.calls.find((c) => c.url === FREEBUSY)!.body);
    expect(Date.parse(request.timeMin)).toBe(NOW);
    expect(Date.parse(request.timeMax)).toBe(NOW + STATUS_WINDOW_MS);
  });

  it('caches a status for a few minutes, then asks again', async () => {
    const { service, google, advance } = setup(happyRoutes());
    await service.connect('a@example.com', 'code');
    const freeBusyCalls = () => google.calls.filter((c) => c.url === FREEBUSY).length;
    await service.statuses(['a@example.com']);
    await service.statuses(['a@example.com']);
    advance(2 * 60_000);
    await service.statuses(['a@example.com']);
    expect(freeBusyCalls()).toBe(1);
    advance(61_000);
    await service.statuses(['a@example.com']);
    expect(freeBusyCalls()).toBe(2);
  });

  it('shares one Google call between concurrent requests', async () => {
    const { service, google } = setup(happyRoutes());
    await service.connect('a@example.com', 'code');
    await Promise.all([service.statuses(['a@example.com']), service.statuses(['a@example.com'])]);
    expect(google.calls.filter((c) => c.url === FREEBUSY)).toHaveLength(1);
  });

  it('remembers a failed lookup briefly and shows no status', async () => {
    const routes = { ...happyRoutes(), [FREEBUSY]: () => json({}, 500) };
    const { service, google, advance } = setup(routes);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await service.connect('a@example.com', 'code');
    expect(await service.statuses(['a@example.com'])).toEqual({});
    await service.statuses(['a@example.com']);
    expect(google.calls.filter((c) => c.url === FREEBUSY)).toHaveLength(1);
    advance(61_000);
    await service.statuses(['a@example.com']);
    expect(google.calls.filter((c) => c.url === FREEBUSY)).toHaveLength(2);
  });

  it('forgets a link whose grant Google no longer honours', async () => {
    const routes = { ...happyRoutes(), [TOKEN]: (body: string) => (body.includes('authorization_code') ? json({ refresh_token: 'rt-1', scope: CALENDAR_SCOPE }) : json({ error: 'invalid_grant' }, 400)) };
    const { service, stored } = setup(routes);
    await service.connect('a@example.com', 'code');
    expect(await service.statuses(['a@example.com'])).toEqual({});
    expect(stored.has('a@example.com')).toBe(false);
  });

  it('disconnects by deleting the row, revoking the token and dropping the cached status', async () => {
    const { service, stored, google } = setup(happyRoutes());
    await service.connect('a@example.com', 'code');
    await service.statuses(['a@example.com']);
    await service.disconnect('a@example.com');
    expect(stored.size).toBe(0);
    expect(new URLSearchParams(google.calls.find((c) => c.url === REVOKE)!.body).get('token')).toBe('rt-1');
    expect(await service.statuses(['a@example.com'])).toEqual({});
  });

  it('still disconnects when the revoke call fails', async () => {
    const { service, stored } = setup({ ...happyRoutes(), [REVOKE]: () => Promise.reject(new Error('offline')) as unknown as Response });
    await service.connect('a@example.com', 'code');
    await service.disconnect('a@example.com');
    expect(stored.size).toBe(0);
  });

  it('keeps a newly connected link when a stale lookup of the old one gets invalid_grant', async () => {
    const { service, stored } = setup(happyRoutes());
    await service.connect('a@example.com', 'code');
    const oldSealed = stored.get('a@example.com')!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = createCalendarService({
      client: {
        exchangeCode: async () => ({ refreshToken: 'NEW' }),
        accessToken: async (token) => {
          if (token === 'rt-1') {
            await gate;
            throw new GoogleCalendarError('invalid_grant', 'revoked');
          }
          return 'at';
        },
        freeBusy: async () => [],
        revoke: async () => undefined,
      },
      links: { getMany: async () => ({ 'a@example.com': stored.get('a@example.com')! }), set: async (l, s) => void stored.set(l, s), remove: async (l, only) => {
        const sealed = stored.get(l) ?? null;
        if (only !== undefined && sealed !== only) {
          return null;
        }
        stored.delete(l);
        return sealed;
      } },
      box,
      now: () => NOW,
    });
    const pending = slow.statuses(['a@example.com']);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await slow.disconnect('a@example.com');
    await slow.connect('a@example.com', 'code');
    expect(stored.get('a@example.com')).not.toBe(oldSealed);
    release();
    await pending;
    expect(stored.has('a@example.com')).toBe(true);
  });
});
