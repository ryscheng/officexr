import { createStore, type Store } from '../game-state/store.ts';
import { createActions, type Actions } from '../game-state/actions.ts';
import { createBus, type Bus } from '../game-state/bus.ts';
import { createRuleRegistry, type RuleRegistry } from '../game-state/rules.ts';
import { proximityRule } from '../game-state/rules/proximity.ts';
import { attachProximityReducer } from '../game-state/reducers/proximity.ts';
import { SyncEngine } from '../realtime/sync.ts';
import {
  createInMemoryChannelHub,
  InMemoryChannel,
} from '../realtime/channel.ts';
import { SnapshotHandshake } from '../realtime/snapshot-handshake.ts';
import { serializeOfficeState } from '../game-state/snapshot.ts';
import type { PlayerId } from '../game-state/types.ts';
import { FakeClock } from './time.ts';

export interface ClientHandle {
  id: PlayerId;
  store: Store;
  actions: Actions;
  bus: Bus;
  channel: InMemoryChannel;
  rules: RuleRegistry;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  detachProximity: () => void;
}

export interface MultiClientHarness {
  hub: ReturnType<typeof createInMemoryChannelHub>;
  clock: FakeClock;
  clients: Map<PlayerId, ClientHandle>;
  add(id: PlayerId, opts?: { seedSelf?: boolean }): Promise<ClientHandle>;
  remove(id: PlayerId): void;
  /** Run the per-client tick (rules) once on every client. */
  tick(): void;
  /** Advance time and tick once. */
  step(ms: number): void;
  /** Flush any pending throttled outbound (position) on every client. */
  flush(): void;
  /** Convenience: makes both clients see each other in their players map. */
  ensureMutualPresence(): void;
}

export function createTwoClientHarness(opts?: {
  ids?: [PlayerId, PlayerId];
  officeId?: string;
}): MultiClientHarness {
  const harness = createMultiClientHarness({ officeId: opts?.officeId });
  const ids = opts?.ids ?? ['alice', 'bob'];
  // pre-create both clients synchronously by kicking off promises;
  // callers should `await harness.add(...)` if they need the handle.
  void harness.add(ids[0]);
  void harness.add(ids[1]);
  return harness;
}

export function createMultiClientHarness(opts?: {
  officeId?: string;
}): MultiClientHarness {
  const officeId = opts?.officeId ?? 'office-test';
  const hub = createInMemoryChannelHub();
  const clock = new FakeClock(0);
  const clients = new Map<PlayerId, ClientHandle>();

  // Per-client snapshot of the previous tick's state, so tick() can pass a
  // real `prev` to rules. Kept here (not on the client) so add() can seed it
  // at the moment the client is created.
  const lastTickState = new Map<PlayerId, ReturnType<Store['getState']>>();

  async function add(id: PlayerId, addOpts?: { seedSelf?: boolean }): Promise<ClientHandle> {
    const seedSelf = addOpts?.seedSelf ?? true;
    const store = createStore({ selfId: id, officeId });
    const bus = createBus();
    const actions = createActions(store, bus);
    if (seedSelf) {
      actions.upsertPlayer({ id, name: id });
    }
    const channel = new InMemoryChannel(hub, id);
    const rules = createRuleRegistry();
    rules.addRule(proximityRule);
    const detachProximity = attachProximityReducer(store, bus);
    const sync = new SyncEngine({ store, actions, bus, channel, clock });
    lastTickState.set(id, store.getState());
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
    const handle: ClientHandle = {
      id,
      store,
      actions,
      bus,
      channel,
      rules,
      sync,
      handshake,
      detachProximity,
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
    clients.delete(id);
    lastTickState.delete(id);
  }

  function tick(): void {
    const now = clock.now();
    for (const c of clients.values()) {
      c.actions.tick(now);
      const current = c.store.getState();
      const prev = lastTickState.get(c.id) ?? current;
      c.rules.tick(current, prev, c.bus);
      // Capture post-rules state so that mutations applied by reducers
      // (which run synchronously off bus events emitted by rules) are
      // visible as `prev` on the next tick. Reading store.getState() again
      // here is the difference.
      lastTickState.set(c.id, c.store.getState());
    }
  }

  function step(ms: number): void {
    clock.advance(ms);
    flush();
    tick();
  }

  function flush(): void {
    for (const c of clients.values()) {
      c.sync.flushPosition();
      c.handshake.tickTimers();
    }
  }

  function ensureMutualPresence(): void {
    const ids = Array.from(clients.keys());
    for (const c of clients.values()) {
      for (const otherId of ids) {
        if (otherId === c.id) continue;
        if (!c.store.getState().players[otherId]) {
          c.actions.upsertPlayer({ id: otherId, name: otherId });
        }
      }
    }
  }

  return { hub, clock, clients, add, remove, tick, step, flush, ensureMutualPresence };
}
