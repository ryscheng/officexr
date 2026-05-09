import { describe, it, expect, afterEach } from 'vitest';
import { createLiveHarness, isSupabaseAvailable, type LiveHarness } from './_helpers.ts';
import { POSITION_CONSTANTS } from '../../realtime/sync.ts';

const supabaseUp = await isSupabaseAvailable();

let harness: LiveHarness;

afterEach(async () => {
  await harness?.cleanup();
});

describe.skipIf(!supabaseUp)('integration: state-sync over Supabase Realtime', () => {
  it('chat round-trips both directions', async () => {
    harness = await createLiveHarness();
    const A = await harness.add('alice');
    const B = await harness.add('bob');

    A.actions.appendChat({ id: 'a1', authorId: 'alice', text: 'hello bob', t: 1 });
    B.actions.appendChat({ id: 'b1', authorId: 'bob', text: 'hi alice', t: 2 });

    await harness.waitFor(() =>
      A.store.getState().chat.some((m) => m.text === 'hi alice') &&
      B.store.getState().chat.some((m) => m.text === 'hello bob'),
    );

    expect(A.store.getState().chat.map((m) => m.text)).toContain('hi alice');
    expect(B.store.getState().chat.map((m) => m.text)).toContain('hello bob');
  });

  it('whiteboard strokes converge', async () => {
    harness = await createLiveHarness();
    const A = await harness.add('alice');
    const B = await harness.add('bob');

    A.actions.appendStroke({
      id: 'sa1',
      authorId: 'alice',
      points: [{ x: 0, y: 0 }],
      color: '#a',
      width: 1,
      t: 1,
    });
    B.actions.appendStroke({
      id: 'sb1',
      authorId: 'bob',
      points: [{ x: 1, y: 1 }],
      color: '#b',
      width: 1,
      t: 2,
    });

    await harness.waitFor(
      () =>
        A.store.getState().whiteboard.strokes.length === 2 &&
        B.store.getState().whiteboard.strokes.length === 2,
    );

    const aIds = A.store.getState().whiteboard.strokes.map((s) => s.id).sort();
    const bIds = B.store.getState().whiteboard.strokes.map((s) => s.id).sort();
    expect(aIds).toEqual(['sa1', 'sb1']);
    expect(bIds).toEqual(['sa1', 'sb1']);
  });

  it('presence:position throttling: A walks then stops; B sees A at the stop point', async () => {
    harness = await createLiveHarness();
    const A = await harness.add('alice');
    const B = await harness.add('bob');

    // Make sure B knows A exists in players map
    B.actions.upsertPlayer({ id: 'alice', name: 'alice' });

    // Walk Alice in 6 steps
    const stepDx = POSITION_CONSTANTS.deltaP * 2;
    let x = 0;
    for (let i = 0; i < 6; i++) {
      harness.clock.advance(50);
      x += stepDx;
      A.actions.setSelfPosition({ x, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0);
      harness.flush();
    }

    // Stop
    A.actions.setSelfPosition({ x, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    harness.clock.advance(POSITION_CONSTANTS.stopGraceMs + 20);
    harness.flush();

    await harness.waitFor(() => {
      const r = B.store.getState().players['alice'];
      return !!r && Math.abs(r.pos.x - x) < 0.01 && r.vel.x === 0;
    });

    const r = B.store.getState().players['alice'];
    expect(Math.abs(r.pos.x - x)).toBeLessThan(0.01);
    expect(r.vel).toEqual({ x: 0, y: 0, z: 0 });
  });
});
