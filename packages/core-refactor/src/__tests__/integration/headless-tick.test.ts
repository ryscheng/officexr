import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMultiClientHarness, type ClientHandle } from '@officexr/sdk/test-harness';
import { PairTracker, tickProximity, tickSession } from '@officexr/sdk';
import { Communication, MockVoiceAdapter } from '../../communication/index.ts';

const still = { x: 0, y: 0, z: 0 };
const zone = { id: 'lounge', label: 'Lounge', min: { x: 0, z: 0 }, max: { x: 100, z: 100 } };

function headless(client: ClientHandle) {
  const voice = new MockVoiceAdapter();
  const comm = new Communication({
    officeId: 'o1',
    selfId: client.id,
    store: client.store,
    actions: client.actions,
    bus: client.bus,
    voice,
  });
  comm.start();
  const entered: string[] = [];
  client.bus.on('proximity:entered', ({ otherId }) => entered.push(otherId));
  const tracker = new PairTracker();
  let prevState = client.store.getState();
  const frame = (nowMs: number, dtSec: number) => {
    prevState = tickSession({ ...client, prevState, nowMs });
    const state = client.store.getState();
    tickProximity(tracker, {
      players: state.players,
      selfId: client.id,
      bus: client.bus,
      settings: state.worldSettings,
      nowMs,
      dtSec,
    });
  };
  return { client, voice, frame, entered, comm };
}

const CAPSULE_CENTER_Y = 1.5; // 3D renderer reports the physics body's centre
const FLOOR_Y = 0; // a 2D ghost reports floor height

const open: ReturnType<typeof headless>[] = [];

async function approach(h: ReturnType<typeof createMultiClientHarness>, a: string, b: string) {
  const A = headless(await h.add(a));
  const B = headless(await h.add(b));
  open.push(A, B);
  h.flush();
  h.ensureMutualPresence();
  const walking = { x: 0, y: 0, z: 1 };
  A.client.actions.setSelfPosition({ x: 50, y: CAPSULE_CENTER_Y, z: 50 }, walking, 0, false);
  B.client.actions.setSelfPosition({ x: 51, y: FLOOR_Y, z: 50 }, still, 0, false);
  for (let i = 0; i < 40; i++) {
    h.clock.advance(100);
    A.frame(h.clock.now(), 0.1);
    B.frame(h.clock.now(), 0.1);
    h.flush();
    vi.advanceTimersByTime(100);
  }
  return { A, B };
}

describe('integration: headless session + proximity ticks', () => {
  afterEach(() => {
    open.splice(0).forEach((c) => c.comm.stop());
    vi.useRealTimers();
  });

  it.each([
    ['3D (capsule y, moving) <-> 2D (floor y)', 'alice', 'bob'],
    ['2D<->2D', 'carol', 'dave'],
  ])('%s: both clients enter proximity and share a voice room', async (_name, a, b) => {
    vi.useFakeTimers();
    const h = createMultiClientHarness();
    const { A, B } = await approach(h, a, b);

    expect(A.entered).toEqual([b]);
    expect(B.entered).toEqual([a]);
    const room = A.voice.getCurrentRoom();
    expect(room).toBeTruthy();
    expect(B.voice.getCurrentRoom()).toBe(room);
  });

  it('entering a voiceZone rect routes the client to the zone room', async () => {
    vi.useFakeTimers();
    const h = createMultiClientHarness();
    const A = headless(await h.add('alice'));
    open.push(A);
    A.client.actions.setVoiceZones([zone]);
    A.client.actions.setSelfPosition({ x: 1, y: 0, z: 1 }, still, 0, false);
    A.frame(h.clock.now(), 0.1);
    vi.advanceTimersByTime(500);
    expect(A.voice.getCurrentRoom()).toBe('zone-o1-lounge');
  });
});
