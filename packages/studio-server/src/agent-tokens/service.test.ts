import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { AgentTokenServiceError } from '@officexr/studio-mcp/agent-tokens';
import { AgentTokenService } from './service.ts';
import { InMemoryAgentTokenRequestStore, type AgentTokenRequestStore } from './store.ts';

const T0 = new Date('2030-01-01T00:00:00Z').getTime();
const SECRET = 's'.repeat(32);
const ISSUER = 'https://studio.example';
const login = 'a@example.com';

function setup() {
  const clock = { t: T0 };
  const now = () => new Date(clock.t);
  const service = new AgentTokenService({
    store: new InMemoryAgentTokenRequestStore(now),
    secret: SECRET,
    issuer: ISSUER,
    studioAppUrl: 'https://app.example',
    now,
  });
  return { service, clock };
}

const requested = async (service: AgentTokenService) => (await service.request(login, { purpose: 'bake', clientId: 'c1' })).requestId;

describe('AgentTokenService', () => {
  it('builds the approval url and a 10 minute deadline', async () => {
    const { service } = setup();
    const result = await service.request('A@Example.com', { purpose: 'bake', clientId: 'c1' });
    expect(result.approvalUrl).toBe(`https://app.example/?agentTokenRequest=${result.requestId}`);
    expect(result.expiresAt).toBe(new Date(T0 + 600_000).toISOString());
    expect((await service.listPending(login)).map((r) => r.id)).toEqual([result.requestId]);
  });

  it('polls pending, approved once, then claimed', async () => {
    const { service } = setup();
    const id = await requested(service);
    expect((await service.poll(login, 'c1', id)).status).toBe('pending');
    await service.approve(login, id);
    const approved = await service.poll(login, 'c1', id);
    expect(approved).toMatchObject({ status: 'approved', apiBaseUrl: ISSUER, expiresAt: new Date(T0 + 3_600_000).toISOString() });
    expect(await service.poll(login, 'c1', id)).toEqual({ status: 'claimed' });
  });

  it('mints a token that verifies with the expected claims', async () => {
    const { service } = setup();
    const id = await requested(service);
    await service.approve(login, id);
    const polled = await service.poll(login, 'c1', id);
    if (polled.status !== 'approved') {
      throw new Error('expected approved');
    }
    expect(await service.verify(polled.token)).toEqual({ login });
    const claims = JSON.parse(Buffer.from(polled.token.split('.')[1] ?? '', 'base64url').toString());
    expect(claims).toMatchObject({ iss: ISSUER, aud: `${ISSUER}/api`, sub: login, jti: id, iat: T0 / 1000, exp: T0 / 1000 + 3600 });
  });

  it('expires an approved request that is not collected within 60 seconds', async () => {
    const { service, clock } = setup();
    const id = await requested(service);
    await service.approve(login, id);
    clock.t += 60_000;
    expect(await service.poll(login, 'c1', id)).toEqual({ status: 'expired' });
  });

  it('reports denied and expired', async () => {
    const { service, clock } = setup();
    const denied = await requested(service);
    await service.deny(login, denied);
    expect(await service.poll(login, 'c1', denied)).toEqual({ status: 'denied' });
    const stale = await requested(service);
    clock.t += 600_000;
    expect(await service.poll(login, 'c1', stale)).toEqual({ status: 'expired' });
  });

  it('throws not_found for an unknown id, another login or another client', async () => {
    const { service } = setup();
    const id = await requested(service);
    for (const poll of [service.poll(login, 'c1', 'nope'), service.poll('b@example.com', 'c1', id), service.poll(login, 'c2', id)]) {
      await expect(poll).rejects.toMatchObject({ error: { type: 'not_found' } });
    }
  });

  it('refuses approve and deny unless pending, unexpired and owned', async () => {
    const { service, clock } = setup();
    const id = await requested(service);
    await expect(service.approve('b@example.com', id)).rejects.toMatchObject({ error: { type: 'not_found' } });
    await service.approve(login, id);
    await expect(service.deny(login, id)).rejects.toMatchObject({ error: { type: 'not_pending' } });
    const stale = await requested(service);
    clock.t += 600_000;
    await expect(service.approve(login, stale)).rejects.toBeInstanceOf(AgentTokenServiceError);
    await expect(service.approve(login, stale)).rejects.toMatchObject({ error: { type: 'expired' } });
  });

  it('rejects an empty or over-long purpose', async () => {
    const { service } = setup();
    for (const purpose of ['  ', 'x'.repeat(201)]) {
      await expect(service.request(login, { purpose, clientId: 'c1' })).rejects.toMatchObject({ error: { type: 'validation' } });
    }
  });

  it('polls expired when the store refuses a claim that did not happen', async () => {
    const inner = new InMemoryAgentTokenRequestStore(() => new Date(T0));
    const store: AgentTokenRequestStore = {
      create: (r) => inner.create(r),
      get: (id) => inner.get(id),
      listPending: (l) => inner.listPending(l),
      decide: (id, l, o) => inner.decide(id, l, o),
      claim: async () => false,
    };
    const service = new AgentTokenService({ store, secret: SECRET, issuer: ISSUER, studioAppUrl: 'https://app.example', now: () => new Date(T0) });
    const id = await requested(service);
    await service.approve(login, id);
    expect(await service.poll(login, 'c1', id)).toEqual({ status: 'expired' });
  });

  describe('verify', () => {
    const claims = { iss: ISSUER, aud: `${ISSUER}/api`, sub: login };
    const sign = (key: string, over: Partial<typeof claims & { exp: number }> = {}, alg = 'HS256') =>
      new SignJWT({})
        .setProtectedHeader({ alg })
        .setIssuer(over.iss ?? claims.iss)
        .setAudience(over.aud ?? claims.aud)
        .setSubject(login)
        .setIssuedAt(T0 / 1000)
        .setExpirationTime(over.exp ?? T0 / 1000 + 3600)
        .sign(new TextEncoder().encode(key));

    it('accepts a valid token', async () => {
      expect(await setup().service.verify(await sign(SECRET))).toEqual({ login });
    });

    it('rejects another secret, the wrong aud or iss, an expired token, other algs and garbage', async () => {
      const { service } = setup();
      const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ ...claims, exp: T0 / 1000 + 3600 })).toString('base64url')}.`;
      const tokens = [
        await sign('x'.repeat(32)),
        await sign(SECRET, { aud: `${ISSUER}/mcp` }),
        await sign(SECRET, { iss: 'https://evil.example' }),
        await sign(SECRET, { exp: T0 / 1000 - 60 }),
        await sign(SECRET, {}, 'HS512'),
        none,
        'garbage',
      ];
      for (const token of tokens) {
        expect(await service.verify(token)).toBeNull();
      }
    });
  });
});
