import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createStore,
  createActions,
  createBus,
  createRuleRegistry,
  attachProximityReducer,
  proximityInnerRule,
  proximityOuterRule,
  BUBBLE_RADIUS,
  serializeOfficeState,
  SyncEngine,
  SnapshotHandshake,
  createInMemoryChannelHub,
  InMemoryChannel,
} from '@officexr/sdk';
import { FakeClock } from '@officexr/sdk/test-harness';
import { Communication, createStack, LocalVoiceAdapter } from '@officexr/core-refactor';
import { BotDriver } from '../bot/BotDriver.ts';

const SELF_ID = 'local-player';
const BOT_ID = 'bot-001';

describe('local-stack integration', () => {
  let hub: ReturnType<typeof createInMemoryChannelHub>;
  let clock: FakeClock;
  let localStore: ReturnType<typeof createStore>;
  let localActions: ReturnType<typeof createActions>;
  let localBus: ReturnType<typeof createBus>;
  let localChannel: InMemoryChannel;
  let localSync: SyncEngine;
  let localHandshake: SnapshotHandshake;
  let localRules: ReturnType<typeof createRuleRegistry>;
  let localVoiceAdapter: LocalVoiceAdapter;
  let communication: Communication;
  let botDriver: BotDriver;

  beforeEach(async () => {
    hub = createInMemoryChannelHub();
    clock = new FakeClock(0);

    // --- Local client bootstrap ---
    localStore = createStore({ selfId: SELF_ID, officeId: 'debug-office' });
    localBus = createBus();
    localActions = createActions(localStore, localBus);
    localActions.upsertPlayer({
      id: SELF_ID,
      name: 'You',
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
    });

    localRules = createRuleRegistry();
    localRules.addRule(proximityOuterRule);
    localRules.addRule(proximityInnerRule);
    attachProximityReducer(localStore, localBus);

    const { channel, voiceAdapter } = createStack({
      mode: 'local',
      hub,
      selfId: SELF_ID,
      participantJoinDelay: 0,
    });
    localChannel = channel as InMemoryChannel;
    localVoiceAdapter = voiceAdapter as LocalVoiceAdapter;

    localSync = new SyncEngine({
      store: localStore,
      actions: localActions,
      bus: localBus,
      channel: localChannel,
      clock,
    });

    localHandshake = new SnapshotHandshake({
      selfId: SELF_ID,
      store: localStore,
      actions: localActions,
      sync: localSync,
      channel: localChannel,
      clock,
      serialize: () => serializeOfficeState(localStore.getState()),
    });

    communication = new Communication({
      selfId: SELF_ID,
      store: localStore,
      actions: localActions,
      bus: localBus,
      voice: localVoiceAdapter,
    });

    await localChannel.subscribe();
    localChannel.trackPresence({});
    localSync.start();
    localHandshake.start();
    communication.start();

    // --- Bot client ---
    botDriver = new BotDriver({
      hub,
      localPlayerPosGetter: () => localStore.getState().players[SELF_ID]?.pos ?? { x: 0, y: 0, z: 0 },
      botId: BOT_ID,
      startPos: { x: 10, y: 0, z: 0 },
      clock,
    });
    await botDriver.start();

    // Ensure both clients know about each other
    localActions.upsertPlayer({
      id: BOT_ID,
      name: 'Bot',
      pos: { x: 10, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
    });
  });

  afterEach(() => {
    communication.stop();
    localSync.stop();
    localHandshake.stop();
    localChannel.close();
    botDriver.stop();
  });

  it('bot walks to local player → Communication joins a room', async () => {
    botDriver.setMode('walk-to-local');

    let prevState = localStore.getState();
    let converged = false;
    const MAX_STEPS = 100;

    for (let i = 0; i < MAX_STEPS; i++) {
      clock.advance(100);

      // Local client ticks
      localSync.flushPosition();
      localHandshake.tickTimers();

      // Bot ticks
      botDriver.tick(100);

      // Apply proximity rule on local client
      const current = localStore.getState();
      localRules.tick(current, prevState, localBus);
      prevState = localStore.getState();

      // Flush any pending timers from LocalVoiceAdapter (participantJoinDelay: 0)
      await new Promise((r) => setTimeout(r, 0));

      // Check if bot is within bubble radius of local player
      const botPos = botDriver.getBotPos();
      const localPos = localStore.getState().players[SELF_ID]?.pos ?? { x: 0, y: 0, z: 0 };
      const dist = Math.sqrt(
        (botPos.x - localPos.x) ** 2 + (botPos.z - localPos.z) ** 2
      );

      if (dist <= BUBBLE_RADIUS) {
        // Give proximity reducers time to update
        await new Promise((r) => setTimeout(r, 0));
        converged = true;
        break;
      }
    }

    expect(converged).toBe(true);

    // After proximity is established, Communication should have joined a room
    // Allow one more async flush for the voice adapter
    await new Promise((r) => setTimeout(r, 0));

    expect(communication.getCurrentRoom()).not.toBeNull();
    expect(localVoiceAdapter.getCurrentRoom()).not.toBeNull();
  });

  it('bot leaves → Communication leaves room', async () => {
    // First: walk bot into proximity
    botDriver.setMode('walk-to-local');

    let prevState = localStore.getState();
    const MAX_STEPS = 100;

    for (let i = 0; i < MAX_STEPS; i++) {
      clock.advance(100);
      localSync.flushPosition();
      localHandshake.tickTimers();
      botDriver.tick(100);
      const current = localStore.getState();
      localRules.tick(current, prevState, localBus);
      prevState = localStore.getState();
      await new Promise((r) => setTimeout(r, 0));

      const botPos = botDriver.getBotPos();
      const localPos = localStore.getState().players[SELF_ID]?.pos ?? { x: 0, y: 0, z: 0 };
      const dist = Math.sqrt(
        (botPos.x - localPos.x) ** 2 + (botPos.z - localPos.z) ** 2
      );
      if (dist <= BUBBLE_RADIUS) break;
    }

    // Let communication join room
    await new Promise((r) => setTimeout(r, 0));
    expect(communication.getCurrentRoom()).not.toBeNull();

    // Now walk bot away
    botDriver.setMode('walk-away');

    for (let i = 0; i < MAX_STEPS; i++) {
      clock.advance(100);
      localSync.flushPosition();
      localHandshake.tickTimers();
      botDriver.tick(100);
      const current = localStore.getState();
      localRules.tick(current, prevState, localBus);
      prevState = localStore.getState();
      await new Promise((r) => setTimeout(r, 0));

      const botPos = botDriver.getBotPos();
      const localPos = localStore.getState().players[SELF_ID]?.pos ?? { x: 0, y: 0, z: 0 };
      const dist = Math.sqrt(
        (botPos.x - localPos.x) ** 2 + (botPos.z - localPos.z) ** 2
      );
      // `proximity:exited` (which drives Communication's room leave) only
      // fires once the body fully clears the OUTER sensor (default 6 m) +
      // body radius + slack. Run until the bot is comfortably past that.
      if (dist > 7) break;
    }

    // Let communication leave room
    await new Promise((r) => setTimeout(r, 0));

    expect(communication.getCurrentRoom()).toBeNull();
    expect(localVoiceAdapter.getCurrentRoom()).toBeNull();
  });
});
