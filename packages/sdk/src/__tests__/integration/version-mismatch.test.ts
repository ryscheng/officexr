import { describe, it, expect } from 'vitest';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';
import type { NetEvent } from '../../realtime/protocol.ts';
import type { GameEvent } from '../../game-state/types.ts';

describe('integration: version-mismatch', () => {
  it('an event with the wrong v emits realtime:version-warning exactly once per kind', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();

    const warnings: GameEvent[] = [];
    B.bus.on('realtime:version-warning', (e) => warnings.push(e));

    const badChat = (text: string): NetEvent =>
      ({
        kind: 'chat:message',
        v: 99,
        actorId: 'alice',
        seq: Math.floor(Math.random() * 1_000_000),
        t: 0,
        text,
      } as unknown as NetEvent);

    await A.channel.send(badChat('x'));
    await A.channel.send(badChat('y'));
    await A.channel.send(badChat('z'));

    expect(warnings).toHaveLength(1);
    expect((warnings[0] as any).eventKind).toBe('chat:message');

    // Subsequent valid events still flow
    A.actions.appendChat({ id: 'a1', authorId: 'alice', text: 'ok', t: 0 });
    expect(B.store.getState().chat.map((m) => m.text)).toContain('ok');
  });

  it('a different kind with wrong v emits its own (one-time) warning', async () => {
    const h = createMultiClientHarness();
    const A = await h.add('alice');
    const B = await h.add('bob');
    h.ensureMutualPresence();

    const warnings: GameEvent[] = [];
    B.bus.on('realtime:version-warning', (e) => warnings.push(e));

    await A.channel.send({
      kind: 'chat:message',
      v: 99,
      actorId: 'alice',
      seq: 1,
      t: 0,
      text: 'x',
    } as unknown as NetEvent);
    await A.channel.send({
      kind: 'whiteboard:stroke',
      v: 99,
      actorId: 'alice',
      seq: 2,
      t: 0,
      stroke: {
        id: 's',
        authorId: 'alice',
        points: [{ x: 0, y: 0 }],
        color: '#000',
        width: 1,
        t: 0,
      },
    } as unknown as NetEvent);

    const kinds = warnings.map((w) => (w as any).eventKind).sort();
    expect(kinds).toEqual(['chat:message', 'whiteboard:stroke']);
  });
});
