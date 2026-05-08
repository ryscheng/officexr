import { describe, it, expect, afterEach } from 'vitest';
import { createLiveHarness, type LiveHarness } from './_helpers.ts';
import type { NetEvent } from '../../realtime/protocol.ts';
import type { GameEvent } from '../../game-state/types.ts';

let harness: LiveHarness;

afterEach(async () => {
  await harness?.cleanup();
});

describe('live: version-mismatch', () => {
  it('a wrong-v event surfaces realtime:version-warning exactly once per kind', async () => {
    harness = await createLiveHarness();
    const A = await harness.add('alice');
    const B = await harness.add('bob');

    const warnings: GameEvent[] = [];
    B.bus.on('realtime:version-warning', (e) => warnings.push(e));

    const bad: NetEvent = {
      kind: 'chat:message',
      v: 99,
      actorId: 'alice',
      seq: 1,
      t: Date.now(),
      text: 'wrong-v',
    } as unknown as NetEvent;

    await A.channel.send(bad);
    await A.channel.send({ ...bad, seq: 2, text: 'still-wrong-v' } as unknown as NetEvent);

    await harness.waitFor(() => warnings.length >= 1);
    // Allow a small window for a duplicate warning that shouldn't arrive
    await new Promise((r) => setTimeout(r, 300));
    expect(warnings).toHaveLength(1);
    expect((warnings[0] as any).eventKind).toBe('chat:message');

    // And valid messages still flow
    A.actions.appendChat({ id: 'a-ok', authorId: 'alice', text: 'ok', t: Date.now() });
    await harness.waitFor(() =>
      B.store.getState().chat.some((m) => m.text === 'ok'),
    );
  });
});
