import { describe, expect, it } from 'vitest';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';
import type { GameEvent } from '../../game-state/types.ts';
import { validateNetEvent } from '../../realtime/protocol.ts';

describe('presence:pose', () => {
  it('shows a peer swimming, then on foot again', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');

    a.actions.setSelfPose('swim');
    expect(b.store.getState().players['A']?.pose).toBe('swim');

    a.actions.setSelfPose(null);
    expect(b.store.getState().players['A']?.pose).toBeNull();
  });

  it('carries a ride pose and ignores a repeated one', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');
    const seen: string[] = [];
    b.channel.on((e) => seen.push(e.kind));

    a.actions.setSelfPose('scooter');
    a.actions.setSelfPose('scooter');

    expect(b.store.getState().players['A']?.pose).toBe('scooter');
    expect(seen.filter((k) => k === 'presence:pose')).toHaveLength(1);
  });

  it('tells peers which rack a rider took the vehicle from, and clears it on dismount', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');

    a.actions.setSelfPose('tricycle', 'rack-7');
    expect(b.store.getState().players['A']).toMatchObject({ pose: 'tricycle', poseRack: 'rack-7' });

    a.actions.setSelfPose(null);
    expect(b.store.getState().players['A']).toMatchObject({ pose: null, poseRack: null });
  });

  it('rejects a pose the protocol does not know', () => {
    const base = { kind: 'presence:pose', v: 1, actorId: 'A', seq: 1, t: 0 };
    expect(validateNetEvent({ ...base, pose: 'hoverboard' }).ok).toBe(false);
    expect(validateNetEvent({ ...base, pose: 'tricycle' }).ok).toBe(true);
    expect(validateNetEvent({ ...base, pose: null }).ok).toBe(true);
  });
});

describe('poke', () => {
  it('reaches every peer, naming the target', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');
    const c = await h.add('C');
    const atB: GameEvent[] = [];
    const atC: GameEvent[] = [];
    b.bus.on('poke:received', (e) => atB.push(e));
    c.bus.on('poke:received', (e) => atC.push(e));

    h.clock.advance(7);
    a.sync.sendPoke('B');

    const expected = { kind: 'poke:received', fromId: 'A', targetId: 'B', at: 7 };
    expect(atB).toEqual([expected]);
    expect(atC).toEqual([expected]);
  });

  it('allows a poke that reached nobody', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');
    const atB: GameEvent[] = [];
    b.bus.on('poke:received', (e) => atB.push(e));

    a.sync.sendPoke(null);

    expect(atB).toEqual([expect.objectContaining({ fromId: 'A', targetId: null })]);
  });
});
