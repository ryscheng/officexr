import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BE_THERE_ACTION, createSlackClient, createSlackDirectory, OPEN_OFFICE_ACTION, parsePingReply, pingMessage, verifySlackSignature, type SlackClient } from './slack';

const SECRET = 'slack-signing-secret';
const NOW_MS = Date.parse('2026-11-20T14:20:00Z');
const NOW_S = String(NOW_MS / 1000);
const sign = (timestamp: string, body: string, secret = SECRET) => `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;

describe('verifySlackSignature', () => {
  const body = 'payload=%7B%7D';
  const check = (overrides: Partial<Parameters<typeof verifySlackSignature>[0]> = {}) =>
    verifySlackSignature({ signingSecret: SECRET, timestamp: NOW_S, signature: sign(NOW_S, body), body, now: NOW_MS, ...overrides });

  it('accepts a valid signature', () => {
    expect(check()).toBe('ok');
  });

  it('rejects a wrong secret, a changed body and a malformed or missing signature', () => {
    expect(check({ signature: sign(NOW_S, body, 'other') })).toBe('invalid');
    expect(check({ body: `${body}x` })).toBe('invalid');
    expect(check({ signature: 'v0=abc' })).toBe('invalid');
    expect(check({ signature: undefined })).toBe('invalid');
    expect(check({ timestamp: undefined })).toBe('invalid');
    expect(check({ timestamp: 'soon', signature: sign('soon', body) })).toBe('invalid');
  });

  it('rejects a valid signature on a request more than 5 minutes old or from the future', () => {
    const old = String(NOW_MS / 1000 - 301);
    const future = String(NOW_MS / 1000 + 301);
    expect(check({ timestamp: old, signature: sign(old, body) })).toBe('stale');
    expect(check({ timestamp: future, signature: sign(future, body) })).toBe('stale');
  });

  it('accepts a request right at the edge of the window', () => {
    const edge = String(NOW_MS / 1000 - 300);
    expect(check({ timestamp: edge, signature: sign(edge, body) })).toBe('ok');
  });

  it('checks the signature before the age, so a stale forgery is invalid', () => {
    const old = String(NOW_MS / 1000 - 1000);
    expect(check({ timestamp: old, signature: sign(old, body, 'other') })).toBe('invalid');
  });
});

describe('pingMessage', () => {
  const reply = { officeId: '11111111-1111-4111-8111-111111111111', senderLogin: 'a@example.com', senderName: 'Alice', targetLogin: 'bob@example.com', targetName: 'bob' };
  const message = pingMessage({ senderName: 'Alice', officeName: 'HQ', officeUrl: `https://office.test/room/${reply.officeId}`, reply });

  it('has the plain-text fallback the owner asked for', () => {
    expect(message.text).toBe('Alice is looking for you in HQ — Open office');
  });

  it('has a section with the link and an actions block with both buttons', () => {
    const [section, actions] = message.blocks as { type: string; text?: { text: string }; elements?: Record<string, unknown>[] }[];
    expect(section.type).toBe('section');
    expect(section.text?.text).toBe(`*Alice* is looking for you in *HQ* — <https://office.test/room/${reply.officeId}|Open office>`);
    expect(actions.type).toBe('actions');
    expect(actions.elements).toEqual([
      { type: 'button', text: { type: 'plain_text', text: 'Open office' }, url: `https://office.test/room/${reply.officeId}`, action_id: OPEN_OFFICE_ACTION, style: 'primary' },
      { type: 'button', text: { type: 'plain_text', text: "I'll be there in 5" }, action_id: BE_THERE_ACTION, value: JSON.stringify(reply) },
    ]);
  });

  it('keeps names from injecting Slack markup', () => {
    const { blocks } = pingMessage({ senderName: '<!channel> & co', officeName: '<@U1>', officeUrl: 'https://office.test/room/x', reply });
    const text = (blocks[0] as { text: { text: string } }).text.text;
    expect(text).toContain('&lt;!channel&gt; &amp; co');
    expect(text).toContain('&lt;@U1&gt;');
  });

  it('does not carry a Slack link from a sender name, in the fallback text or the section', () => {
    const evil = pingMessage({ senderName: '<https://evil.example/login|IT Security>', officeName: 'see https://evil.example now', officeUrl: 'https://office.test/room/x', reply });
    expect(evil.text).not.toContain('<https://evil.example');
    expect(evil.text).not.toContain('https://evil.example');
    const section = (evil.blocks[0] as { text: { text: string } }).text.text;
    expect(section).not.toContain('<https://evil.example');
    expect(section).not.toContain('https://evil.example');
    expect(section).toContain('<https://office.test/room/x|Open office>');
  });

  it('reads the reply back from the button value, and nothing else', () => {
    expect(parsePingReply(JSON.stringify(reply))).toEqual(reply);
    expect(parsePingReply('{"officeId":1}')).toBeNull();
    expect(parsePingReply('nope')).toBeNull();
    expect(parsePingReply(undefined)).toBeNull();
  });
});

describe('createSlackClient', () => {
  const slackResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  function fake(handler: (method: string, params: Record<string, unknown>) => unknown) {
    const calls: { method: string; params: Record<string, unknown>; contentType: string | null; authorization: string | null }[] = [];
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const method = String(input).replace('https://slack.com/api/', '');
      const raw = String(init?.body);
      const params = headers.get('content-type')?.startsWith('application/json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
      calls.push({ method, params, contentType: headers.get('content-type'), authorization: headers.get('authorization') });
      return slackResponse(handler(method, params));
    });
    return { calls, client: createSlackClient('xoxb-test-token', fetchFn as unknown as typeof fetch) };
  }

  it('looks a user up by email with the bot token', async () => {
    const { client, calls } = fake(() => ({ ok: true, user: { id: 'U123' } }));
    expect(await client.lookupUserByEmail('bob@example.com')).toBe('U123');
    expect(calls[0]).toMatchObject({ method: 'users.lookupByEmail', params: { email: 'bob@example.com' }, authorization: 'Bearer xoxb-test-token' });
  });

  it('is null for an email Slack does not know and throws for other errors', async () => {
    expect(await fake(() => ({ ok: false, error: 'users_not_found' })).client.lookupUserByEmail('x@example.com')).toBeNull();
    await expect(fake(() => ({ ok: false, error: 'invalid_auth' })).client.lookupUserByEmail('x@example.com')).rejects.toThrow('invalid_auth');
  });

  it('opens a DM and posts the message to it as JSON with blocks', async () => {
    const { client, calls } = fake((method) => (method === 'conversations.open' ? { ok: true, channel: { id: 'D1' } } : { ok: true }));
    const channel = await client.openDm('U123');
    await client.postMessage({ channel, text: 'hi', blocks: [{ type: 'section' }] });
    expect(calls.map((c) => [c.method, c.params])).toEqual([
      ['conversations.open', { users: 'U123' }],
      ['chat.postMessage', { channel: 'D1', text: 'hi', blocks: [{ type: 'section' }] }],
    ]);
    expect(calls[1].contentType).toContain('application/json');
  });

  it('cuts a long status to the limits the claimants payload allows', async () => {
    const status = await fake(() => ({ ok: true, profile: { status_text: 'x'.repeat(500), status_emoji: `:${'e'.repeat(300)}:` } })).client.userStatus('U1');
    expect(status?.text).toHaveLength(200);
    expect(status?.emoji).toHaveLength(100);
  });

  it('reads a status, and treats an empty status or a missing scope as none', async () => {
    expect(await fake(() => ({ ok: true, profile: { status_text: ' On vacation ', status_emoji: ':palm_tree:' } })).client.userStatus('U1')).toEqual({ text: 'On vacation', emoji: ':palm_tree:' });
    expect(await fake(() => ({ ok: true, profile: { status_text: '', status_emoji: '' } })).client.userStatus('U1')).toBeNull();
    expect(await fake(() => ({ ok: false, error: 'missing_scope' })).client.userStatus('U1')).toBeNull();
  });
});

describe('createSlackDirectory', () => {
  const stub = (lookup: SlackClient['lookupUserByEmail'], status: SlackClient['userStatus'] = async () => null): SlackClient => ({
    lookupUserByEmail: vi.fn(lookup),
    openDm: vi.fn(),
    postMessage: vi.fn(),
    userStatus: vi.fn(status),
  });

  it('caches a found user for an hour, case-insensitively', async () => {
    let now = 0;
    const client = stub(async () => 'U1');
    const directory = createSlackDirectory({ client, now: () => now });
    expect(await directory.userIdForEmail('Bob@Example.com')).toBe('U1');
    expect(await directory.userIdForEmail('bob@example.com')).toBe('U1');
    expect(client.lookupUserByEmail).toHaveBeenCalledTimes(1);
    expect(client.lookupUserByEmail).toHaveBeenCalledWith('bob@example.com');
    now = 60 * 60_000;
    await directory.userIdForEmail('bob@example.com');
    expect(client.lookupUserByEmail).toHaveBeenCalledTimes(2);
  });

  it('remembers a missing user for 10 minutes', async () => {
    let now = 0;
    const client = stub(async () => null);
    const directory = createSlackDirectory({ client, now: () => now });
    expect(await directory.userIdForEmail('x@example.com')).toBeNull();
    now = 9 * 60_000;
    await directory.userIdForEmail('x@example.com');
    expect(client.lookupUserByEmail).toHaveBeenCalledTimes(1);
    now = 10 * 60_000;
    await directory.userIdForEmail('x@example.com');
    expect(client.lookupUserByEmail).toHaveBeenCalledTimes(2);
  });

  it('remembers a failed lookup for only a minute, and reports no user', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let now = 0;
    const client = stub(async () => {
      throw new Error('boom');
    });
    const directory = createSlackDirectory({ client, now: () => now });
    expect(await directory.userIdForEmail('x@example.com')).toBeNull();
    now = 61_000;
    await directory.userIdForEmail('x@example.com');
    expect(client.lookupUserByEmail).toHaveBeenCalledTimes(2);
  });

  it('reads statuses by email and caches them for 2 minutes', async () => {
    let now = 0;
    const client = stub(
      async (email) => (email === 'bob@example.com' ? 'U1' : null),
      async () => ({ text: 'Focus time', emoji: ':headphones:' }),
    );
    const directory = createSlackDirectory({ client, now: () => now });
    expect(await directory.statuses(['bob@example.com', 'nobody@example.com'])).toEqual({ 'bob@example.com': { text: 'Focus time', emoji: ':headphones:' } });
    now = 119_000;
    await directory.statuses(['bob@example.com']);
    expect(client.userStatus).toHaveBeenCalledTimes(1);
    now = 121_000;
    await directory.statuses(['bob@example.com']);
    expect(client.userStatus).toHaveBeenCalledTimes(2);
  });
});
