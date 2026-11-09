import { describe, expect, it } from 'vitest';
import { InMemoryAgentTokenRequestStore, type AgentTokenRequestStore } from './store.ts';

const T0 = new Date('2030-01-01T00:00:00Z').getTime();
const sec = (n: number) => n * 1000;
const base = { id: 'r1', login: 'a@example.com', clientId: 'c1', purpose: 'bake', expiresAt: new Date(T0 + sec(600)) };

/** Run against every `AgentTokenRequestStore` implementation; add `PgAgentTokenRequestStore` once the repo has a Postgres test harness. */
function agentTokenRequestStoreContract(name: string, create: (now: () => Date) => AgentTokenRequestStore) {
  describe(`${name} contract`, () => {
    function setup() {
      const clock = { t: T0 };
      const store = create(() => new Date(clock.t));
      return { store, clock };
    }

    it('creates a pending request that listPending returns', async () => {
      const { store } = setup();
      await store.create(base);
      expect(await store.get('r1')).toMatchObject({ status: 'pending', decidedAt: null });
      expect((await store.listPending(base.login)).map((r) => r.id)).toEqual(['r1']);
      expect(await store.get('nope')).toBeNull();
    });

    it('refuses to decide as the wrong login', async () => {
      const { store } = setup();
      await store.create(base);
      expect(await store.decide('r1', 'b@example.com', 'approved')).toBe(false);
      expect(await store.decide('r1', 'b@example.com', 'denied')).toBe(false);
      expect((await store.get('r1'))?.status).toBe('pending');
    });

    it('refuses to decide after expiry', async () => {
      const { store, clock } = setup();
      await store.create(base);
      clock.t = T0 + sec(600);
      expect(await store.decide('r1', base.login, 'approved')).toBe(false);
    });

    it('refuses a double decision', async () => {
      const { store } = setup();
      await store.create(base);
      expect(await store.decide('r1', base.login, 'approved')).toBe(true);
      expect(await store.decide('r1', base.login, 'approved')).toBe(false);
      expect(await store.decide('r1', base.login, 'denied')).toBe(false);
    });

    it('claims once', async () => {
      const { store } = setup();
      await store.create(base);
      await store.decide('r1', base.login, 'approved');
      expect(await store.claim('r1', base.login, 'c1')).toBe(true);
      expect(await store.claim('r1', base.login, 'c1')).toBe(false);
      expect(await store.get('r1')).toMatchObject({ status: 'claimed' });
    });

    it('refuses to claim a pending or denied request', async () => {
      const { store } = setup();
      await store.create(base);
      expect(await store.claim('r1', base.login, 'c1')).toBe(false);
      await store.decide('r1', base.login, 'denied');
      expect(await store.claim('r1', base.login, 'c1')).toBe(false);
    });

    it('refuses to claim as the wrong login or client', async () => {
      const { store } = setup();
      await store.create(base);
      await store.decide('r1', base.login, 'approved');
      expect(await store.claim('r1', 'b@example.com', 'c1')).toBe(false);
      expect(await store.claim('r1', base.login, 'other')).toBe(false);
      expect(await store.claim('r1', base.login, 'c1')).toBe(true);
    });

    it('refuses to claim 60 seconds after approval', async () => {
      const { store, clock } = setup();
      await store.create(base);
      await store.decide('r1', base.login, 'approved');
      clock.t = T0 + sec(60);
      expect(await store.claim('r1', base.login, 'c1')).toBe(false);
    });

    it('lists only live pending requests of the login', async () => {
      const { store, clock } = setup();
      await store.create(base);
      await store.create({ ...base, id: 'decided' });
      await store.create({ ...base, id: 'other', login: 'b@example.com' });
      await store.create({ ...base, id: 'short', expiresAt: new Date(T0 + sec(10)) });
      await store.decide('decided', base.login, 'approved');
      clock.t = T0 + sec(20);
      expect((await store.listPending(base.login)).map((r) => r.id)).toEqual(['r1']);
    });
  });
}

agentTokenRequestStoreContract('InMemoryAgentTokenRequestStore', (now) => new InMemoryAgentTokenRequestStore(now));
