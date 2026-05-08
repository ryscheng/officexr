import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createStore, type Store } from '../../game-state/store.ts';
import { createActions, type Actions } from '../../game-state/actions.ts';
import { createBus, type Bus } from '../../game-state/bus.ts';
import { createRuleRegistry, type RuleRegistry } from '../../game-state/rules.ts';
import { proximityRule } from '../../game-state/rules/proximity.ts';
import { attachProximityReducer } from '../../game-state/reducers/proximity.ts';
import { SyncEngine } from '../../realtime/sync.ts';
import { SnapshotHandshake } from '../../realtime/snapshot-handshake.ts';
import { SupabaseChannel } from '../../realtime/supabase-channel.ts';
import { serializeOfficeState } from '../../game-state/snapshot.ts';
import { FakeClock } from '../../test-harness/time.ts';
import type { PlayerId } from '../../game-state/types.ts';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export function makeSupabase(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 100 } },
    auth: { persistSession: false },
  });
}

export interface LiveClient {
  id: PlayerId;
  store: Store;
  actions: Actions;
  bus: Bus;
  channel: SupabaseChannel;
  rules: RuleRegistry;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  detachProximity: () => void;
  supabase: SupabaseClient;
}

export interface LiveHarness {
  officeId: string;
  clock: FakeClock;
  clients: Map<PlayerId, LiveClient>;
  add(id: PlayerId): Promise<LiveClient>;
  remove(id: PlayerId): void;
  /** Wait for a condition to become true, polling every 50ms up to timeoutMs. */
  waitFor(predicate: () => boolean, timeoutMs?: number): Promise<void>;
  flush(): void;
  cleanup(): Promise<void>;
}

export function uniqueOfficeId(prefix = 'live'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export async function createLiveHarness(opts?: {
  officeId?: string;
}): Promise<LiveHarness> {
  const officeId = opts?.officeId ?? uniqueOfficeId();
  const clock = new FakeClock(Date.now());
  const clients = new Map<PlayerId, LiveClient>();

  async function add(id: PlayerId): Promise<LiveClient> {
    const supabase = makeSupabase();
    const store = createStore({ selfId: id, officeId });
    const actions = createActions(store);
    actions.upsertPlayer({ id, name: id });
    const bus = createBus();
    const channel = new SupabaseChannel({ supabase, officeId, userId: id });
    const rules = createRuleRegistry();
    rules.addRule(proximityRule);
    const detachProximity = attachProximityReducer(store, bus);
    const sync = new SyncEngine({ store, actions, bus, channel, clock });
    const handshake = new SnapshotHandshake({
      selfId: id,
      store,
      actions,
      sync,
      channel,
      clock,
      serialize: () => serializeOfficeState(store.getState()),
    });

    await channel.subscribe();
    channel.trackPresence({});
    sync.start();
    handshake.start();

    const handle: LiveClient = {
      id,
      store,
      actions,
      bus,
      channel,
      rules,
      sync,
      handshake,
      detachProximity,
      supabase,
    };
    clients.set(id, handle);
    return handle;
  }

  function remove(id: PlayerId): void {
    const c = clients.get(id);
    if (!c) return;
    c.sync.stop();
    c.handshake.stop();
    c.detachProximity();
    c.channel.close();
    void c.supabase.removeAllChannels();
    clients.delete(id);
  }

  function flush(): void {
    for (const c of clients.values()) {
      c.sync.flushPosition();
      c.handshake.tickTimers();
    }
  }

  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 5_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('waitFor: predicate did not become true within timeout');
  }

  async function cleanup(): Promise<void> {
    for (const id of [...clients.keys()]) remove(id);
  }

  return { officeId, clock, clients, add, remove, flush, waitFor, cleanup };
}

export function tickClock(harness: LiveHarness, ms: number): void {
  harness.clock.advance(ms);
}
