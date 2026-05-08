import { describe, it, expect, afterEach } from 'vitest';
import { createLiveHarness, type LiveHarness } from './_helpers.ts';

let harness: LiveHarness;

afterEach(async () => {
  await harness?.cleanup();
});

describe('live: late-join snapshot over Supabase Realtime', () => {
  it('late joiner receives snapshot from lex-min leader', async () => {
    harness = await createLiveHarness();
    const A = await harness.add('alice');
    const B = await harness.add('bob');

    A.actions.appendChat({ id: 'a1', authorId: 'alice', text: 'pre-1', t: 1 });
    B.actions.appendChat({ id: 'b1', authorId: 'bob', text: 'pre-2', t: 2 });

    // Let A and B see each other's chat first
    await harness.waitFor(() =>
      A.store.getState().chat.some((m) => m.text === 'pre-2') &&
      B.store.getState().chat.some((m) => m.text === 'pre-1'),
    );

    // Charlie joins late
    const C = await harness.add('charlie');

    // Wait until Charlie sees both alice and bob in presence list
    await harness.waitFor(
      () => C.channel.listPresent().includes('alice') && C.channel.listPresent().includes('bob'),
    );

    // Charlie kicks off snapshot request
    const snapshotPromise = C.handshake.requestSnapshot();

    // Send a live event during the window
    A.actions.appendChat({ id: 'a2', authorId: 'alice', text: 'during', t: 3 });

    await snapshotPromise;

    expect(C.store.getState().realtime.status).toBe('live');
    const cChat = C.store.getState().chat.map((m) => m.text);
    expect(cChat).toContain('pre-1');
    expect(cChat).toContain('pre-2');

    // Live event eventually arrives (either through the queue or post-drain)
    await harness.waitFor(() =>
      C.store.getState().chat.some((m) => m.text === 'during'),
    );
    expect(C.store.getState().chat.map((m) => m.text)).toContain('during');
  });
});
