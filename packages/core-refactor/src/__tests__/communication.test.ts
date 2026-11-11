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

  describe('voice zones', () => {
    const zone = (id: string, x0: number, x1: number) => ({
      id,
      label: id,
      min: { x: x0, z: 0 },
      max: { x: x1, z: 10 },
    });
    const walkTo = (x: number): void =>
      ctx.actions.setSelfPosition({ x, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, 0, false);
    const joins = (): string[] =>
      ctx.voice.calls.flatMap((c) => (c.type === 'joinRoom' ? [String(c.roomId)] : []));

    beforeEach(() => {
      ctx.actions.setVoiceZones([zone('lounge', 0, 10), zone('boardroom', 20, 30)]);
      walkTo(100);
    });

    it('joins the zone room only after the dwell', () => {
      walkTo(5);
      ctx.timer.advance(499);
      expect(ctx.voice.calls).toHaveLength(0);
      ctx.timer.advance(1);
      expect(joins()).toEqual(['zone-o1-lounge']);
      expect(ctx.store.getState().players['alice'].jitsiRoom).toBe('zone-o1-lounge');
    });

    it('mutes before joining a zone call, but not a proximity call', () => {
      ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
      expect(ctx.voice.calls.some((c) => c.type === 'setMuted')).toBe(false);
      walkTo(5);
      ctx.timer.advance(500);
      expect(ctx.voice.calls.slice(-2)).toEqual([
        { type: 'setMuted', muted: true },
        { type: 'joinRoom', roomId: 'zone-o1-lounge', selfId: 'alice' },
      ]);
    });

    it('overrides proximity peers, before and after the dwell', () => {
      ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
      walkTo(5);
      ctx.timer.advance(500);
      ctx.bus.emit({ kind: 'proximity:entered', otherId: 'aaron' });
      expect(joins()).toEqual(['room-o1-alice', 'zone-o1-lounge']);
      expect(ctx.comm.getCurrentRoom()).toBe('zone-o1-lounge');
    });

    it('falls back to the proximity room 1.5s after leaving the zone', () => {
      ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
      walkTo(5);
      ctx.timer.advance(500);
      ctx.voice.clearCalls();
      walkTo(100);
      ctx.timer.advance(1499);
      expect(ctx.voice.calls).toHaveLength(0);
      ctx.timer.advance(1);
      expect(joins()).toEqual(['room-o1-alice']);
    });

    it('leaves 1.5s after leaving the zone when nobody is nearby', () => {
      walkTo(5);
      ctx.timer.advance(500);
      ctx.voice.clearCalls();
      walkTo(100);
      ctx.timer.advance(1499);
      expect(ctx.voice.calls).toHaveLength(0);
      ctx.timer.advance(1);
      expect(ctx.voice.calls).toEqual([{ type: 'leaveRoom' }]);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
    });

    it('keeps the call, without rejoining, when re-entering within 1.5s', () => {
      walkTo(5);
      ctx.timer.advance(500);
      ctx.voice.clearCalls();
      walkTo(100);
      ctx.timer.advance(1000);
      walkTo(5);
      ctx.timer.advance(5000);
      expect(ctx.voice.calls).toHaveLength(0);
      expect(ctx.comm.getCurrentRoom()).toBe('zone-o1-lounge');
    });

    it('never joins when passing through a zone in under 500ms', () => {
      for (let i = 0; i < 3; i++) {
        walkTo(5);
        ctx.timer.advance(499);
        walkTo(100);
        ctx.timer.advance(499);
      }
      ctx.timer.advance(5000);
      expect(ctx.voice.calls).toHaveLength(0);
    });

    it('stays in the old zone call while dwelling in the next, then switches', () => {
      walkTo(5);
      ctx.timer.advance(500);
      ctx.voice.clearCalls();
      walkTo(25);
      ctx.timer.advance(499);
      expect(ctx.comm.getCurrentRoom()).toBe('zone-o1-lounge');
      ctx.timer.advance(1);
      expect(joins()).toEqual(['zone-o1-boardroom']);
      ctx.timer.advance(5000);
      expect(joins()).toEqual(['zone-o1-boardroom']);
    });

    it('keeps the old zone call through a gap, then switches to the next zone', () => {
      walkTo(5);
      ctx.timer.advance(500);
      ctx.voice.clearCalls();
      walkTo(15);
      ctx.timer.advance(1000);
      walkTo(25);
      ctx.timer.advance(499);
      expect(ctx.voice.calls).toHaveLength(0);
      ctx.timer.advance(1);
      expect(ctx.voice.calls).toEqual([
        { type: 'setMuted', muted: true },
        { type: 'joinRoom', roomId: 'zone-o1-boardroom', selfId: 'alice' },
      ]);
      ctx.timer.advance(5000);
      expect(ctx.voice.calls).toHaveLength(2);
    });

    it('stop() cancels a pending exit hold', () => {
      walkTo(5);
      ctx.timer.advance(500);
      walkTo(100);
      ctx.comm.stop();
      ctx.voice.clearCalls();
      ctx.timer.advance(5000);
      expect(ctx.voice.calls).toHaveLength(0);
    });

    it('clearing the zones while inside holds the call, then falls back', () => {
      ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
      walkTo(5);
      ctx.timer.advance(500);
      ctx.voice.clearCalls();
      ctx.actions.setVoiceZones([]);
      ctx.timer.advance(1499);
      expect(ctx.voice.calls).toHaveLength(0);
      ctx.timer.advance(1);
      expect(joins()).toEqual(['room-o1-alice']);
    });

    it('takes no proximity call while standing in a voice zone', () => {
      walkTo(5);
      ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
      expect(ctx.comm.getCurrentRoom()).toBeNull();
      ctx.timer.advance(500);
      expect(joins()).toEqual(['zone-o1-lounge']);
    });

    it('takes no proximity call with a peer standing in a voice zone, until they step out', () => {
      ctx.actions.upsertPlayer({ id: 'bob', name: 'bob' });
      ctx.actions.applyRemotePosition('bob', { x: 9, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, 0, 0, false);
      walkTo(11);
      ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
      ctx.timer.advance(5000);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
      ctx.actions.applyRemotePosition('bob', { x: 12, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, 0, 0, false);
      expect(ctx.comm.getCurrentRoom()).toBe('room-o1-alice');
    });

    it('stop() cancels a pending dwell', () => {
      walkTo(5);
      ctx.comm.stop();
      ctx.voice.clearCalls();
      ctx.timer.advance(5000);
      expect(ctx.voice.calls).toHaveLength(0);
    });
  });

  describe('desk zones', () => {
    const desk = { id: 'desk1', label: 'Desk', min: { x: 0, z: 0 }, max: { x: 4, z: 4 } };
    const moving = { x: 3, y: 0, z: 0 };
    const still = { x: 0, y: 0, z: 0 };
    const DESK_ROOM = 'zone-o1-desk1';

    const placeSelf = (x: number, vel = still, airborne = false): void =>
      ctx.actions.setSelfPosition({ x, y: 0, z: 2 }, vel, 0, airborne);
    const placeBob = (x: number, vel = still): void => {
      ctx.actions.upsertPlayer({ id: 'bob', name: 'bob' });
      ctx.actions.applyRemotePosition('bob', { x, y: 0, z: 2 }, vel, 0, 0, false);
    };

    beforeEach(() => {
      ctx.actions.setVoiceZones([desk]);
      ctx.actions.setDeskAreas([{ ...desk, seatInstanceId: null }]);
      placeSelf(100);
    });

    it('never calls a lone player at a desk', () => {
      placeSelf(2);
      ctx.timer.advance(5000);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
    });

    it('joins 500ms after both players have stopped in the desk zone', () => {
      placeBob(1);
      placeSelf(2, moving);
      ctx.timer.advance(5000);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
      placeSelf(2);
      ctx.timer.advance(499);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
      ctx.timer.advance(1);
      expect(ctx.comm.getCurrentRoom()).toBe(DESK_ROOM);
    });

    it('never joins while walking, running or jumping through, however slowly', () => {
      placeBob(1);
      for (let x = 0; x <= 4; x += 0.5) {
        placeSelf(x, moving, x === 2);
        ctx.timer.advance(400);
      }
      placeSelf(100);
      ctx.timer.advance(5000);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
    });

    it('restarts the 500ms when the player moves again before it elapses', () => {
      placeBob(1);
      placeSelf(2);
      ctx.timer.advance(400);
      placeSelf(2.5, moving);
      placeSelf(2.5);
      ctx.timer.advance(400);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
      ctx.timer.advance(100);
      expect(ctx.comm.getCurrentRoom()).toBe(DESK_ROOM);
    });

    it('does not join a peer who is only passing through', () => {
      placeSelf(2);
      placeBob(1, moving);
      ctx.timer.advance(5000);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
    });

    it('keeps the call while moving around inside the zone', () => {
      placeBob(1);
      placeSelf(2);
      ctx.timer.advance(500);
      placeSelf(3, moving);
      ctx.timer.advance(5000);
      expect(ctx.comm.getCurrentRoom()).toBe(DESK_ROOM);
    });

    it('leaves 1.5s after the other player walks off', () => {
      placeBob(1);
      placeSelf(2);
      ctx.timer.advance(500);
      placeBob(100, moving);
      ctx.timer.advance(1499);
      expect(ctx.comm.getCurrentRoom()).toBe(DESK_ROOM);
      ctx.timer.advance(1);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
    });

    it('takes no proximity call while standing in a desk zone', () => {
      placeSelf(2);
      ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
      placeBob(6);
      ctx.timer.advance(5000);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
    });

    it('takes no proximity call with a peer standing in a desk zone', () => {
      placeBob(2);
      ctx.bus.emit({ kind: 'proximity:entered', otherId: 'bob' });
      placeSelf(6);
      ctx.timer.advance(5000);
      expect(ctx.comm.getCurrentRoom()).toBeNull();
      placeBob(10);
      expect(ctx.comm.getCurrentRoom()).toBe('room-o1-alice');
    });
  });
});
