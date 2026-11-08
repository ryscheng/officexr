import { describe, expect, it } from 'vitest';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InMemoryOAuthStore, newOpaqueToken, type CodeGrant, type Grant, type OAuthStore } from './store.ts';

const HOUR = 3_600_000;
const client: OAuthClientInformationFull = { client_id: 'c1', client_secret: 's3cret', redirect_uris: ['http://localhost/cb'] };
const grant = (expiresInMs = HOUR): Grant => ({
  clientId: 'c1',
  login: 'a@example.com',
  scopes: ['studio'],
  resource: 'https://studio.example/mcp',
  expiresAt: new Date(Date.now() + expiresInMs),
});
const codeGrant = (expiresInMs = HOUR): CodeGrant => ({ ...grant(expiresInMs), codeChallenge: 'chal', redirectUri: 'http://localhost/cb' });

/** Run against every `OAuthStore` implementation; add `PgOAuthStore` here once the repo has a Postgres test harness. */
function oauthStoreContract(name: string, create: () => OAuthStore) {
  describe(`${name} contract`, () => {
    async function seeded() {
      const store = create();
      await store.registerClient(client);
      return store;
    }

    it('returns a client without its secret and checks the secret', async () => {
      const store = await seeded();
      expect(await store.getClient('c1')).toEqual({ client_id: 'c1', redirect_uris: ['http://localhost/cb'] });
      expect(await store.getClient('nope')).toBeNull();
      expect(await store.verifyClientSecret('c1', 's3cret')).toBe(true);
      expect(await store.verifyClientSecret('c1', 'wrong')).toBe(false);
      expect(await store.verifyClientSecret('nope', 's3cret')).toBe(false);
    });

    it('rejects a duplicate client and a secretless client never verifies', async () => {
      const store = await seeded();
      await expect(store.registerClient(client)).rejects.toThrow();
      await store.registerClient({ client_id: 'public', redirect_uris: ['http://localhost/cb'] });
      expect(await store.verifyClientSecret('public', '')).toBe(false);
    });

    it('consumes a code once with its grant', async () => {
      const store = await seeded();
      const expected = codeGrant();
      await store.saveCode('code', expected);
      expect(await store.consumeCode('code')).toEqual(expected);
      expect(await store.consumeCode('code')).toBeNull();
    });

    it('does not consume an expired or unknown code', async () => {
      const store = await seeded();
      await store.saveCode('old', codeGrant(-HOUR));
      expect(await store.consumeCode('old')).toBeNull();
      expect(await store.consumeCode('unknown')).toBeNull();
    });

    it('omits resource when none was granted', async () => {
      const store = await seeded();
      const { resource: _, ...noResource } = codeGrant();
      await store.saveCode('code', noResource);
      expect(await store.consumeCode('code')).toEqual(noResource);
    });

    it('rejects codes and tokens for an unknown client', async () => {
      const store = create();
      await expect(store.saveCode('code', codeGrant())).rejects.toThrow();
      await expect(store.saveToken('t', 'access', grant())).rejects.toThrow();
    });

    it('finds live tokens only', async () => {
      const store = await seeded();
      await store.saveToken('live', 'access', grant());
      await store.saveToken('expired', 'access', grant(-HOUR));
      await store.saveToken('revoked', 'access', grant());
      await store.revokeToken('revoked');
      expect(await store.findToken('live')).toEqual({ ...grant(), expiresAt: expect.any(Date), kind: 'access' });
      expect(await store.findToken('expired')).toBeNull();
      expect(await store.findToken('revoked')).toBeNull();
      expect(await store.findToken('unknown')).toBeNull();
    });

    it('revokes a refresh token once, and never an access token', async () => {
      const store = await seeded();
      await store.saveToken('refresh', 'refresh', grant());
      await store.saveToken('access', 'access', grant());
      expect(await store.revokeRefreshToken('access')).toBe(false);
      expect(await store.findToken('access')).not.toBeNull();
      expect(await store.revokeRefreshToken('refresh')).toBe(true);
      expect(await store.revokeRefreshToken('refresh')).toBe(false);
      expect(await store.findToken('refresh')).toBeNull();
    });
  });
}

oauthStoreContract('InMemoryOAuthStore', () => new InMemoryOAuthStore());

describe('InMemoryOAuthStore', () => {
  it('uses its clock for expiry', async () => {
    let now = new Date(0);
    const store = new InMemoryOAuthStore(() => now);
    await store.registerClient(client);
    await store.saveToken('t', 'access', { ...grant(), expiresAt: new Date(1000) });
    expect(await store.findToken('t')).not.toBeNull();
    now = new Date(1000);
    expect(await store.findToken('t')).toBeNull();
  });
});

describe('newOpaqueToken', () => {
  it('is unguessable base64url', () => {
    expect(newOpaqueToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newOpaqueToken()).not.toBe(newOpaqueToken());
  });
});
