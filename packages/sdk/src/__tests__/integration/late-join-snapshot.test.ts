import { describe, it, expect } from 'vitest';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';

async function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

describe('integration: late-join snapshot', () => {
  it('late joiner receives a snapshot from the lex-min leader and converges', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();

    // Build pre-existing state
    A.actions.appendChat({ id: 'a1', authorId: 'alice', text: 'pre-1', t: 1 });
    B.actions.appendChat({ id: 'b1', authorId: 'bob', text: 'pre-2', t: 2 });
    A.actions.appendStroke({
      id: 's1',
      authorId: 'alice',
      points: [{ x: 0, y: 0 }],
      color: '#a',
      width: 1,
      t: 0,
    });

    // Charlie joins (late). lex-min leader excluding self is 'alice'.
    const C = await h.add('charlie');
    const requestPromise = C.handshake.requestSnapshot();

    // While snapshot in flight, Alice sends a live chat (queued by Charlie)
    A.actions.appendChat({ id: 'a2', authorId: 'alice', text: 'during-snapshot', t: 3 });

    await requestPromise;
    await flush();

    expect(C.store.getState().realtime.status).toBe('live');
    const charlieChat = C.store.getState().chat.map((m) => m.text);
    expect(charlieChat).toContain('pre-1');
    expect(charlieChat).toContain('pre-2');
    expect(charlieChat).toContain('during-snapshot');
    expect(C.store.getState().whiteboard.strokes.map((s) => s.id)).toContain('s1');

    // After snapshot, a new live event should be observed by all three
    B.actions.appendChat({ id: 'b2', authorId: 'bob', text: 'post', t: 4 });
    await flush();
    expect(A.store.getState().chat.map((m) => m.text)).toContain('post');
    expect(B.store.getState().chat.map((m) => m.text)).toContain('post');
    expect(C.store.getState().chat.map((m) => m.text)).toContain('post');
  });

  it('snapshot-window events are not duplicated nor lost', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    h.ensureMutualPresence();

    A.actions.appendChat({ id: 'a1', authorId: 'alice', text: 'x', t: 0 });

    const C = await h.add('charlie');
    const requestPromise = C.handshake.requestSnapshot();
    // Live event during snapshot window
    A.actions.appendChat({ id: 'a2', authorId: 'alice', text: 'during', t: 1 });
    await requestPromise;
    await flush();

    const cChat = C.store.getState().chat;
    const xCount = cChat.filter((m) => m.text === 'x').length;
    const dCount = cChat.filter((m) => m.text === 'during').length;
    expect(xCount).toBe(1);
    expect(dCount).toBe(1);
  });
});
