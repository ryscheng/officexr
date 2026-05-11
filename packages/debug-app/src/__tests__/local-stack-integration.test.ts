import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createStore,
  createActions,
  createBus,
  attachProximityReducer,
  createInMemoryChannelHub,
} from '@officexr/sdk';
import { Communication, createStack, LocalVoiceAdapter } from '@officexr/core-refactor';

const SELF_ID = 'local-player';
const PEER_ID = 'peer-001';

/**
 * Exercises the Communication ↔ proximity-bus integration that used
 * to be driven by the SDK's collision-rule pass. Now that proximity
 * events come from a Rapier sensor bridge (see
 * `packages/debug-app/src/physics/bridge.ts`), this suite emits the
 * same bus events directly to verify the downstream consumers
 * (Communication's joinRoom / leaveRoom, the proximity reducer)
 * still fire the way they used to.
 *
 * Physics behaviour itself (bot movement, sensor crossings) is
 * verified manually via the Playwright smoke described in the plan,
 * because driving Rapier in vitest would require WASM init + a much
 * bigger fixture for negligible extra coverage of the SDK side.
 */
describe('local-stack proximity → Communication integration', () => {
  let store: ReturnType<typeof createStore>;
  let actions: ReturnType<typeof createActions>;
  let bus: ReturnType<typeof createBus>;
  let voiceAdapter: LocalVoiceAdapter;
  let communication: Communication;

  beforeEach(() => {
    store = createStore({ selfId: SELF_ID, officeId: 'debug-office' });
    bus = createBus();
    actions = createActions(store, bus);
    actions.upsertPlayer({
      id: SELF_ID,
      name: 'You',
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
    });
    actions.upsertPlayer({
      id: PEER_ID,
      name: 'Peer',
      pos: { x: 1, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
    });

    attachProximityReducer(store, bus);

    const hub = createInMemoryChannelHub();
    const stack = createStack({
      mode: 'local',
      hub,
      selfId: SELF_ID,
      participantJoinDelay: 0,
    });
    voiceAdapter = stack.voiceAdapter as LocalVoiceAdapter;

    communication = new Communication({
      selfId: SELF_ID,
      store,
      actions,
      bus,
      voice: voiceAdapter,
    });
    communication.start();
  });

  afterEach(() => {
    communication.stop();
  });

  it('proximity:entered → Communication joins a room', async () => {
    bus.emit({ kind: 'proximity:entered', otherId: PEER_ID });
    // Allow LocalVoiceAdapter's microtask join callback to flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(communication.getCurrentRoom()).not.toBeNull();
    expect(voiceAdapter.getCurrentRoom()).not.toBeNull();
  });

  it('proximity:exited → Communication leaves the room', async () => {
    bus.emit({ kind: 'proximity:entered', otherId: PEER_ID });
    await new Promise((r) => setTimeout(r, 0));
    expect(communication.getCurrentRoom()).not.toBeNull();

    bus.emit({ kind: 'proximity:exited', otherId: PEER_ID });
    await new Promise((r) => setTimeout(r, 0));
    expect(communication.getCurrentRoom()).toBeNull();
    expect(voiceAdapter.getCurrentRoom()).toBeNull();
  });
});
