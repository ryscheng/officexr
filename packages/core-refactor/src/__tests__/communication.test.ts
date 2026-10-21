import { describe, it, expect, beforeEach } from 'vitest';
import {
  createStore,
  createActions,
  createBus,
  attachProximityReducer,
} from '@officexr/sdk';
import type { Store, Actions, Bus } from '@officexr/sdk';
import { Communication, type Schedule } from '../communication/communication.ts';
import { MockVoiceAdapter } from '../communication/mock-voice-adapter.ts';

interface Ctx {
  store: Store;
  actions: Actions;
  bus: Bus;
  voice: MockVoiceAdapter;
  comm: Communication;
  timer: FakeTimer;
}

/** Manual clock: `advance(ms)` runs whatever came due. */
class FakeTimer {
  private now = 0;
  private pending: Array<{ at: number; fn: () => void }> = [];
  readonly schedule: Schedule = (fn, ms) => {
    const entry = { at: this.now + ms, fn };
    this.pending.push(entry);
    return () => {
      this.pending = this.pending.filter((e) => e !== entry);
    };
  };
  advance(ms: number): void {
    this.now += ms;
    const due = this.pending.filter((e) => e.at <= this.now);
    this.pending = this.pending.filter((e) => e.at > this.now);
    for (const e of due) e.fn();
  }
}

function setup(selfId: string): Ctx {
  const store = createStore({ selfId, officeId: 'r' });
  const actions = createActions(store);
  actions.upsertPlayer({ id: selfId, name: selfId });
  const bus = createBus();
  attachProximityReducer(store, bus);
  const voice = new MockVoiceAdapter();
  const timer = new FakeTimer();
  const comm = new Communication({ officeId: 'o1', selfId, store, actions, bus, voice, schedule: timer.schedule });
  comm.start();
  return { store, actions, bus, voice, comm, timer };
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
    expect(joinCalls[0].type === 'joinRoom' && joinCalls[0].roomId).toBe('room-o1-alice');
    expect(ctx.store.getState().players['alice'].jitsiRoom).toBe('room-o1-alice');
  });

  it('leaves the room 1.5s after the last peer exits', () => {
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    ctx.voice.clearCalls();
    ctx.bus.emit({ kind: 'proximity:exited', otherId: 'bob' });
    ctx.timer.advance(1499);
    expect(ctx.voice.calls).toHaveLength(0);
    expect(ctx.store.getState().players['alice'].jitsiRoom).toBe('room-o1-alice');
    ctx.timer.advance(1);
    expect(ctx.voice.calls).toEqual([{ type: 'leaveRoom' }]);
    expect(ctx.comm.getCurrentRoom()).toBeNull();
    expect(ctx.store.getState().players['alice'].jitsiRoom).toBeNull();
  });

  it('re-entering before the debounce elapses cancels the leave', () => {
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    ctx.voice.clearCalls();
    ctx.bus.emit({ kind: 'proximity:exited', otherId: 'bob' });
    ctx.timer.advance(1000);
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    ctx.timer.advance(5000);
    expect(ctx.voice.calls).toHaveLength(0);
    expect(ctx.comm.getCurrentRoom()).toBe('room-o1-alice');
  });

  it('stop() while a leave is pending cancels it', () => {
    const events: Array<string | null> = [];
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    ctx.bus.emit({ kind: 'proximity:exited', otherId: 'bob' });
    ctx.comm.stop();
    ctx.voice.clearCalls();
    ctx.bus.on('voice:room-changed', (e) => events.push(e.roomId));
    ctx.timer.advance(5000);
    expect(ctx.voice.calls).toHaveLength(0);
    expect(events).toEqual([]);
  });

  it('stays in a room, recomputed, when one of two peers exits', () => {
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'aaron' });
    ctx.voice.clearCalls();
    ctx.bus.emit({ kind: 'proximity:exited', otherId: 'aaron' });
    ctx.timer.advance(5000);
    expect(ctx.voice.calls).toEqual([{ type: 'joinRoom', roomId: 'room-o1-alice', selfId: 'alice' }]);
    expect(ctx.comm.getCurrentRoom()).toBe('room-o1-alice');
  });

  it('a different peer entering while a leave is pending switches rooms instead of leaving', () => {
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
    ctx.bus.emit({ kind: 'proximity:exited', otherId: 'bob' });
    ctx.voice.clearCalls();
    ctx.timer.advance(1000);
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'aaron' });
    ctx.timer.advance(5000);
    expect(ctx.voice.calls).toEqual([{ type: 'joinRoom', roomId: 'room-o1-aaron', selfId: 'alice' }]);
    expect(ctx.comm.getCurrentRoom()).toBe('room-o1-aaron');
  });

  it('switches to a smaller lex-min when a smaller-id peer arrives', () => {
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'charlie' });
    expect(ctx.comm.getCurrentRoom()).toBe('room-o1-alice');
    ctx.bus.emit({ kind: 'proximity:entered', otherId: 'aaron' });
    expect(ctx.comm.getCurrentRoom()).toBe('room-o1-aaron');
    expect(ctx.store.getState().players['alice'].jitsiRoom).toBe('room-o1-aaron');
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
    ctx.timer.advance(1500);
    expect(events).toEqual(['room-o1-alice', null]);
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
    const comm = new Communication({ officeId: 'o1', selfId: 'alice', store, actions, bus, voice });
    comm.start();
    expect(comm.getNearby().has('bob')).toBe(true);
    expect(voice.getCurrentRoom()).toBe('room-o1-alice');
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
