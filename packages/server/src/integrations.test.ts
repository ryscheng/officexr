import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import connect from 'connect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTEGRATION_NOTICE_KIND, type DeskClaimant } from '@officexr/sdk';
import type { CalendarService } from './calendarService';
import { claimantDecorator, integrationsMiddleware, SLACK_PING_COOLDOWN_MS, type SlackIntegration } from './integrations';
import { signOAuthState } from './googleCalendar';
import { createSlackClient, createSlackDirectory, type SlackClient } from './slack';
import type { Office } from './shared';

const ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'session-secret';
const SIGNING_SECRET = 'slack-signing-secret';
const office: Office = { id: ID, name: 'HQ', description: null, map_name: 'hq', created_by_login: null, debug_enabled: false };
const CONFIG = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://office.test/auth/google/calendar/callback' };

let server: Server | undefined;
afterEach(() => server?.close());

interface Harness {
  base: string;
  now: { value: number };
  calendar: { [K in keyof CalendarService]: ReturnType<typeof vi.fn> };
  slack: SlackIntegration;
  slackClient: { [K in keyof SlackClient]: ReturnType<typeof vi.fn> };
  presence: { hasLiveSession: ReturnType<typeof vi.fn>; notifyLogin: ReturnType<typeof vi.fn> };
  fetchCalls: { url: string; body: string }[];
}

const T0 = Date.parse('2026-11-20T14:20:00Z');

async function start({ calendarOn = true, slackOn = true } = {}): Promise<Harness> {
  const now = { value: T0 };
  const calendar = { connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined), isConnected: vi.fn(async () => true), statuses: vi.fn(async () => ({})) };
  const slackClient = {
    lookupUserByEmail: vi.fn(async (email: string) => (email === 'bob@example.com' ? 'U_BOB' : email === 'a@example.com' ? 'U_ALICE' : null)),
    openDm: vi.fn(async (user: string) => `D_${user}`),
    postMessage: vi.fn(async () => undefined),
    userStatus: vi.fn(async () => null),
  };
  const slack: SlackIntegration = { signingSecret: SIGNING_SECRET, client: slackClient, directory: createSlackDirectory({ client: slackClient, now: () => now.value }) };
  const presence = { hasLiveSession: vi.fn(() => false), notifyLogin: vi.fn(() => true) };
  const fetchCalls: { url: string; body: string }[] = [];
  const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), body: String(init?.body) });
    return new Response('ok');
  });
  const app = connect();
  app.use(
    integrationsMiddleware({
      identity: (req) => {
        const login = req.headers['x-test-login'];
        return typeof login === 'string' ? { login, name: login === 'a@example.com' ? 'Alice' : login } : null;
      },
      queryOffices: async (id) => (id === ID ? [office] : []),
      deskClaims: { claimants: async () => ({ 'bob@example.com': {}, 'nobody@example.com': {}, 'a@example.com': {} }) },
      presence,
      publicUrl: 'https://office.test',
      sessionSecret: SECRET,
      frontendOrigins: ['https://office.test'],
      calendar: calendarOn ? { service: calendar as unknown as CalendarService, config: CONFIG } : undefined,
      slack: slackOn ? slack : undefined,
      fetch: fetchFn as unknown as typeof fetch,
      now: () => now.value,
    }),
  );
  app.use((_req, res) => {
    res.statusCode = 404;
    res.end('fell through');
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, now, calendar, slack, slackClient, presence, fetchCalls };
}

const as = (login: string) => ({ 'x-test-login': login });

describe('with nothing configured', () => {
  it('leaves every integration route to the next handler', async () => {
    const h = await start({ calendarOn: false, slackOn: false });
    for (const [method, path] of [['DELETE', '/api/calendar'], ['GET', '/auth/google/calendar'], ['POST', '/api/slack/interactions'], ['POST', `/api/offices/${ID}/slack-ping`]] as const) {
      const res = await fetch(`${h.base}${path}`, { method, headers: as('a@example.com'), redirect: 'manual' });
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
    expect(await (await fetch(`${h.base}/api/integrations`, { headers: as('a@example.com') })).json()).toEqual({ calendar: { enabled: false, connected: false }, slack: { enabled: false } });
  });
});

describe('/api/integrations', () => {
  it('needs a signed-in user, and says what is on and whether the user connected the calendar', async () => {
    const h = await start();
    expect((await fetch(`${h.base}/api/integrations`)).status).toBe(401);
    expect(await (await fetch(`${h.base}/api/integrations`, { headers: as('a@example.com') })).json()).toEqual({ calendar: { enabled: true, connected: true }, slack: { enabled: true } });
    h.calendar.isConnected.mockResolvedValue(false);
    expect((await (await fetch(`${h.base}/api/integrations`, { headers: as('a@example.com') })).json()).calendar.connected).toBe(false);
  });
});

describe('calendar connect flow', () => {
  it('sends a signed-in user to Google for the free/busy scope, with a state bound to their login', async () => {
    const h = await start();
    const res = await fetch(`${h.base}/auth/google/calendar?next=${encodeURIComponent('/room/abc')}`, { headers: as('a@example.com'), redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.freebusy');
    expect(location.searchParams.get('login_hint')).toBe('a@example.com');
    expect(location.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('is 401 for anyone not signed in', async () => {
    const h = await start();
    expect((await fetch(`${h.base}/auth/google/calendar`, { redirect: 'manual' })).status).toBe(401);
  });

  it('connects on the callback and returns the user to where they were', async () => {
    const h = await start();
    const state = signOAuthState(SECRET, { login: 'a@example.com', returnTo: '/room/abc' }, h.now.value);
    const res = await fetch(`${h.base}/auth/google/calendar/callback?code=the-code&state=${state}`, { headers: as('a@example.com'), redirect: 'manual' });
    expect(h.calendar.connect).toHaveBeenCalledWith('a@example.com', 'the-code');
    expect(res.headers.get('location')).toBe('/room/abc?calendar=connected');
  });

  it('refuses a state made for another login, a forged state and an expired state, connecting nothing', async () => {
    const h = await start();
    const callback = (state: string) => fetch(`${h.base}/auth/google/calendar/callback?code=c&state=${state}`, { headers: as('a@example.com'), redirect: 'manual' });
    expect((await callback(signOAuthState(SECRET, { login: 'b@example.com', returnTo: '/' }, h.now.value))).status).toBe(400);
    expect((await callback(signOAuthState('other-secret', { login: 'a@example.com', returnTo: '/' }, h.now.value))).status).toBe(400);
    expect((await callback(signOAuthState(SECRET, { login: 'a@example.com', returnTo: '/' }, h.now.value - 11 * 60_000))).status).toBe(400);
    expect(h.calendar.connect).not.toHaveBeenCalled();
  });

  it('reports a declined consent and a failed exchange without storing anything', async () => {
    const h = await start();
    const state = signOAuthState(SECRET, { login: 'a@example.com', returnTo: '/room/abc?x=1' }, h.now.value);
    const declined = await fetch(`${h.base}/auth/google/calendar/callback?error=access_denied&state=${state}`, { headers: as('a@example.com'), redirect: 'manual' });
    expect(declined.headers.get('location')).toBe('/room/abc?x=1&calendar=declined');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.calendar.connect.mockRejectedValue(new Error('scope'));
    const failed = await fetch(`${h.base}/auth/google/calendar/callback?code=c&state=${state}`, { headers: as('a@example.com'), redirect: 'manual' });
    expect(failed.headers.get('location')).toBe('/room/abc?x=1&calendar=failed');
  });

  it('disconnects the signed-in user only', async () => {
    const h = await start();
    expect((await fetch(`${h.base}/api/calendar`, { method: 'DELETE' })).status).toBe(401);
    expect((await fetch(`${h.base}/api/calendar`, { method: 'DELETE', headers: as('a@example.com') })).status).toBe(204);
    expect(h.calendar.disconnect).toHaveBeenCalledExactlyOnceWith('a@example.com');
  });
});

describe('POST /api/offices/:id/slack-ping', () => {
  const ping = (h: Harness, targetLogin: unknown, login: string | null = 'a@example.com', officeId = ID) =>
    fetch(`${h.base}/api/offices/${officeId}/slack-ping`, { method: 'POST', headers: login ? as(login) : {}, body: JSON.stringify({ targetLogin }) });

  it('DMs the target with the Block Kit message and a link to the office', async () => {
    const h = await start();
    const res = await ping(h, 'bob@example.com');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(h.slackClient.lookupUserByEmail).toHaveBeenCalledWith('bob@example.com');
    expect(h.slackClient.openDm).toHaveBeenCalledWith('U_BOB');
    const [message] = h.slackClient.postMessage.mock.calls[0] as [{ channel: string; text: string; blocks: { elements?: { url?: string; value?: string }[] }[] }];
    expect(message.channel).toBe('D_U_BOB');
    expect(message.text).toBe('Alice is looking for you in HQ — Open office');
    const buttons = message.blocks[1].elements!;
    expect(buttons[0].url).toBe(`https://office.test/room/${ID}`);
    expect(JSON.parse(buttons[1].value!)).toEqual({ officeId: ID, senderLogin: 'a@example.com', senderName: 'Alice', targetLogin: 'bob@example.com', targetName: 'bob' });
    expect(h.presence.notifyLogin).toHaveBeenCalledExactlyOnceWith(ID, 'a@example.com', INTEGRATION_NOTICE_KIND, { from: 'Slack', text: 'Pinged bob on Slack.' });
  });

  it('is 401 when not signed in, 404 for an unknown office, 400 for a bad body or a self ping', async () => {
    const h = await start();
    expect((await ping(h, 'bob@example.com', null)).status).toBe(401);
    expect((await ping(h, 'bob@example.com', 'a@example.com', '22222222-2222-4222-8222-222222222222')).status).toBe(404);
    expect((await ping(h, 'bob@example.com', 'a@example.com', 'not-a-uuid')).status).toBe(404);
    expect((await ping(h, 42)).status).toBe(400);
    expect((await ping(h, 'a@example.com')).status).toBe(400);
    const junk = await fetch(`${h.base}/api/offices/${ID}/slack-ping`, { method: 'POST', headers: as('a@example.com'), body: 'junk' });
    expect(junk.status).toBe(400);
    expect(h.slackClient.postMessage).not.toHaveBeenCalled();
  });

  it('is 403 for someone who is not a desk claimant of the office, sending nothing', async () => {
    const h = await start();
    const res = await ping(h, 'stranger@example.com');
    expect(res.status).toBe(403);
    expect(h.slackClient.lookupUserByEmail).not.toHaveBeenCalled();
    expect(h.slackClient.postMessage).not.toHaveBeenCalled();
    expect(h.presence.notifyLogin).not.toHaveBeenCalled();
  });

  it('is 403 for a prototype key as the target, sending nothing', async () => {
    const h = await start();
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect([key, (await ping(h, key)).status]).toEqual([key, 403]);
    }
    expect(h.slackClient.lookupUserByEmail).not.toHaveBeenCalled();
  });

  it('is 409 when the target is online, since a normal ping reaches them', async () => {
    const h = await start();
    h.presence.hasLiveSession.mockReturnValue(true);
    expect((await ping(h, 'bob@example.com')).status).toBe(409);
    expect(h.presence.hasLiveSession).toHaveBeenCalledWith(ID, 'bob@example.com');
    expect(h.slackClient.postMessage).not.toHaveBeenCalled();
  });

  it('is 404 for a claimant who is not in Slack, and does not start the cooldown', async () => {
    const h = await start();
    expect((await ping(h, 'nobody@example.com')).status).toBe(404);
    expect((await ping(h, 'nobody@example.com')).status).toBe(404);
  });

  it('allows one ping per sender and target every 2 minutes, with Retry-After', async () => {
    const h = await start();
    expect((await ping(h, 'bob@example.com')).status).toBe(200);
    h.now.value += 30_000;
    const limited = await ping(h, 'bob@example.com');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('90');
    expect(await limited.json()).toMatchObject({ retryAfterSeconds: 90 });
    expect(h.slackClient.postMessage).toHaveBeenCalledTimes(1);
    expect(h.presence.notifyLogin).toHaveBeenLastCalledWith(ID, 'a@example.com', INTEGRATION_NOTICE_KIND, { from: 'Slack', text: 'You pinged bob a moment ago. Try again in 90 seconds.' });
    h.now.value += SLACK_PING_COOLDOWN_MS - 30_000;
    expect((await ping(h, 'bob@example.com')).status).toBe(200);
    expect(h.slackClient.postMessage).toHaveBeenCalledTimes(2);
  });

  it('limits each sender and target pair on its own', async () => {
    const h = await start();
    expect((await ping(h, 'bob@example.com')).status).toBe(200);
    expect((await ping(h, 'bob@example.com', 'carol@example.com')).status).toBe(200);
    expect((await ping(h, 'bob@example.com')).status).toBe(429);
  });

  it('is 502 when Slack fails, and lets the sender try again at once', async () => {
    const h = await start();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.slackClient.postMessage.mockRejectedValueOnce(new Error('ratelimited'));
    expect((await ping(h, 'bob@example.com')).status).toBe(502);
    expect((await ping(h, 'bob@example.com')).status).toBe(200);
  });
});

describe('POST /api/slack/interactions', () => {
  const reply = { officeId: ID, senderLogin: 'a@example.com', senderName: 'Alice', targetLogin: 'bob@example.com', targetName: 'bob' };
  const interaction = (overrides: Record<string, unknown> = {}) =>
    new URLSearchParams({
      payload: JSON.stringify({
        type: 'block_actions',
        user: { id: 'U_BOB' },
        response_url: 'https://hooks.slack.com/actions/T1/B1/xyz',
        actions: [{ action_id: 'be_there_in_5', value: JSON.stringify(reply) }],
        ...overrides,
      }),
    }).toString();
  const sign = (timestamp: string, body: string, secret = SIGNING_SECRET) => `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
  const post = (h: Harness, body: string, { timestamp = String(h.now.value / 1000), signature }: { timestamp?: string; signature?: string } = {}) =>
    fetch(`${h.base}/api/slack/interactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature ?? sign(timestamp, body) },
      body,
    });

  it('tells the live pinger "will be there in 5 minutes" and updates the Slack message', async () => {
    const h = await start();
    const res = await post(h, interaction());
    expect(res.status).toBe(200);
    expect(h.presence.notifyLogin).toHaveBeenCalledExactlyOnceWith(ID, 'a@example.com', INTEGRATION_NOTICE_KIND, { from: 'bob', text: 'will be there in 5 minutes' });
    expect(h.slackClient.postMessage).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.fetchCalls).toHaveLength(1));
    expect(h.fetchCalls[0].url).toBe('https://hooks.slack.com/actions/T1/B1/xyz');
    expect(JSON.parse(h.fetchCalls[0].body)).toMatchObject({ replace_original: true, text: 'You told Alice you will be there in 5 minutes.' });
  });

  it('DMs the pinger on Slack when they have left the office', async () => {
    const h = await start();
    h.presence.notifyLogin.mockReturnValue(false);
    expect((await post(h, interaction())).status).toBe(200);
    expect(h.slackClient.postMessage).toHaveBeenCalledExactlyOnceWith({ channel: 'D_U_ALICE', text: 'bob will be there in 5 minutes.' });
  });

  it('rejects a bad signature, a missing signature and a stale timestamp, and acts on none', async () => {
    const h = await start();
    const body = interaction();
    expect((await post(h, body, { signature: sign(String(h.now.value / 1000), body, 'other') })).status).toBe(401);
    expect((await post(h, body, { signature: 'v0=' })).status).toBe(401);
    const stale = String(h.now.value / 1000 - 6 * 60);
    const old = await post(h, body, { timestamp: stale });
    expect(old.status).toBe(401);
    expect(await old.json()).toEqual({ error: 'Stale request' });
    const bare = await fetch(`${h.base}/api/slack/interactions`, { method: 'POST', body });
    expect(bare.status).toBe(401);
    expect(h.presence.notifyLogin).not.toHaveBeenCalled();
    expect(h.fetchCalls).toEqual([]);
  });

  it('acknowledges the "Open office" link click and any unknown action without doing anything', async () => {
    const h = await start();
    expect((await post(h, interaction({ actions: [{ action_id: 'open_office' }] }))).status).toBe(200);
    expect((await post(h, interaction({ actions: [{ action_id: 'be_there_in_5', value: 'tampered' }] }))).status).toBe(200);
    expect((await post(h, 'payload=not-json')).status).toBe(200);
    expect(h.presence.notifyLogin).not.toHaveBeenCalled();
  });

  it('acts once on a replayed signed request', async () => {
    const h = await start();
    const body = interaction();
    const timestamp = String(h.now.value / 1000);
    const signature = sign(timestamp, body);
    for (let i = 0; i < 3; i++) {
      expect((await post(h, body, { timestamp, signature })).status).toBe(200);
    }
    expect(h.presence.notifyLogin).toHaveBeenCalledTimes(1);
    h.now.value += 60_000;
    const later = String(h.now.value / 1000);
    await post(h, body, { timestamp: later, signature: sign(later, body) });
    expect(h.presence.notifyLogin).toHaveBeenCalledTimes(2);
  });

  it('ignores a click from a Slack user who is not the ping target', async () => {
    const h = await start();
    expect((await post(h, interaction({ user: { id: 'U_SOMEONE_ELSE' } }))).status).toBe(200);
    expect((await post(h, interaction({ user: undefined }))).status).toBe(200);
    expect(h.presence.notifyLogin).not.toHaveBeenCalled();
    expect(h.fetchCalls).toEqual([]);
  });

  it('never calls a response_url that is not on hooks.slack.com', async () => {
    const h = await start();
    expect((await post(h, interaction({ response_url: 'https://evil.example/hook' }))).status).toBe(200);
    expect(h.presence.notifyLogin).toHaveBeenCalled();
    expect(h.fetchCalls).toEqual([]);
  });

  it('is 413 for an oversized body', async () => {
    const h = await start();
    const res = await fetch(`${h.base}/api/slack/interactions`, { method: 'POST', body: 'x'.repeat(70 * 1024) });
    expect(res.status).toBe(413);
  });
});

describe('claimantDecorator', () => {
  const claimants: Record<string, DeskClaimant> = { 'a@example.com': { characterId: 'Mage' }, 'b@example.com': {}, 'c@example.com': {} };

  it('is off when neither integration is configured', () => {
    expect(claimantDecorator({})).toBeUndefined();
  });

  it('adds the calendar status, and the Slack status only for claimants with no calendar status', async () => {
    const statuses = vi.fn(async () => ({ 'a@example.com': { busy: true, until: '2026-11-20T15:00:00.000Z' } }));
    const slackStatuses = vi.fn(async () => ({ 'a@example.com': { text: 'ignored' }, 'b@example.com': { text: 'Out sick', emoji: ':face_with_thermometer:' } }));
    const decorate = claimantDecorator({
      calendar: { service: { statuses } as unknown as CalendarService, config: CONFIG },
      slack: { signingSecret: 's', client: createSlackClient('t'), directory: { userIdForEmail: vi.fn(), statuses: slackStatuses } },
    })!;
    expect(await decorate(claimants)).toEqual({
      'a@example.com': { characterId: 'Mage', calendar: { busy: true, until: '2026-11-20T15:00:00.000Z' } },
      'b@example.com': { slack: { text: 'Out sick', emoji: ':face_with_thermometer:' } },
      'c@example.com': {},
    });
    expect(slackStatuses).toHaveBeenCalledWith(['b@example.com', 'c@example.com']);
  });

  it('leaves the claimants as they were when a lookup fails', async () => {
    const decorate = claimantDecorator({ calendar: { service: { statuses: async () => Promise.reject(new Error('down')) } as unknown as CalendarService, config: CONFIG } })!;
    expect(await decorate(claimants)).toBe(claimants);
  });

  describe('when a lookup hangs', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('gives up after 3 seconds and returns the claimants as they were', async () => {
      const decorate = claimantDecorator({ calendar: { service: { statuses: () => new Promise(() => undefined) } as unknown as CalendarService, config: CONFIG } })!;
      const result = decorate(claimants);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await result).toBe(claimants);
    });
  });
});
