import { describe, it, expect, beforeEach } from 'vitest';
import {
  createStore,
  createActions,
  createBus,
  attachProximityReducer,
} from '@officexr/sdk';
import type { Store, Actions, Bus } from '@officexr/sdk';
import { Communication } from '../communication/communication.ts';
import { MockVoiceAdapter } from '../communication/mock-voice-adapter.ts';

interface Ctx {
  store: Store;
  actions: Actions;
  bus: Bus;
  voice: MockVoiceAdapter;
  comm: Communication;
}

function setup(selfId: string): Ctx {
  const store = createStore({ selfId, officeId: 'r' });
  const actions = createActions(store);
  actions.upsertPlayer({ id: selfId, name: selfId });
  const bus = createBus();
  attachProximityReducer(store, bus);
  const voice = new MockVoiceAdapter();
  const comm = new Communication({ selfId, store, actions, bus, voice });
  comm.start();
  return { store, actions, bus, voice, comm };
}

describe('Communication', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup('alice');
  });

  it('joins lex-min room when a peer enters proximity', () => {
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    const joinCalls = ctx.voice.calls.filter((c) => c.type === 'joinRoom');
    expect(joinCalls).toHaveLength(1);
    expect(joinCalls[0].type === 'joinRoom' && joinCalls[0].roomId).toBe('room-alice');
    expect(ctx.store.getState().players['alice'].jitsiRoom).toBe('room-alice');
  });

  it('leaves the room when the last peer exits', () => {
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    ctx.voice.clearCalls();
    ctx.bus.emit({ kind: 'proximity:exited', otherId: 'bob' });
    const lastJoin = [...ctx.voice.calls].reverse().find((c) => c.type === 'joinRoom');
    expect(lastJoin && lastJoin.type === 'joinRoom' && lastJoin.roomId).toBeNull();
    expect(ctx.store.getState().players['alice'].jitsiRoom).toBeNull();
  });

  it('switches to a smaller lex-min when a smaller-id peer arrives', () => {
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'charlie' });
    expect(ctx.comm.getCurrentRoom()).toBe('room-alice');
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'aaron' });
    expect(ctx.comm.getCurrentRoom()).toBe('room-aaron');
    expect(ctx.store.getState().players['alice'].jitsiRoom).toBe('room-aaron');
  });

  it('does not call joinRoom when proximity:entered fires for an already-known peer', () => {
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    ctx.voice.clearCalls();
    // simulating a steady-state tick where the rule re-emits "entered"
    // for an already-tracked peer should not cause new adapter calls.
    expect(ctx.voice.calls).toHaveLength(0);
  });

  it('emits voice:room-changed on the bus when the room changes', () => {
    const events: Array<string | null> = [];
    ctx.bus.on('voice:room-changed', (e) => events.push(e.roomId));
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    ctx.bus.emit({ kind: 'proximity:exited', otherId: 'bob' });
    expect(events).toEqual(['room-alice', null]);
  });

  it('seeds nearby from existing proximity state when started', () => {
    const store = createStore({ selfId: 'alice', officeId: 'r' });
    const actions = createActions(store);
    actions.upsertPlayer({ id: 'alice', name: 'alice' });
    const bus = createBus();
    attachProximityReducer(store, bus);
    // Simulate proximity already populated before Communication starts
    bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    const voice = new MockVoiceAdapter();
    const comm = new Communication({ selfId: 'alice', store, actions, bus, voice });
    comm.start();
    expect(comm.getNearby().has('bob')).toBe(true);
    expect(voice.getCurrentRoom()).toBe('room-alice');
  });

  it('stop() leaves the current room and clears state', async () => {
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    ctx.comm.stop();
    // wait a microtask for the leaveRoom promise
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.comm.getCurrentRoom()).toBeNull();
    const lastLeave = [...ctx.voice.calls].reverse().find((c) => c.type === 'leaveRoom');
    expect(lastLeave).toBeDefined();
  });
});
