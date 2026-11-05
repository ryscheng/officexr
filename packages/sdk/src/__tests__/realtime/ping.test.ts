import { describe, expect, it } from 'vitest';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';
import type { GameEvent } from '../../game-state/types.ts';
import type { NetEvent } from '../../realtime/protocol.ts';

describe('ping', () => {
  it('reaches only the target, which emits ping:received', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');
    const c = await h.add('C');
    const atC: NetEvent[] = [];
    c.channel.on((e) => atC.push(e));
    const bBus: GameEvent[] = [];
    const cBus: GameEvent[] = [];
    b.bus.on('ping:received', (e) => bBus.push(e));
    c.bus.on('ping:received', (e) => cBus.push(e));

    h.clock.advance(5);
    a.sync.sendPing('B');

    expect(bBus).toEqual([{ kind: 'ping:received', fromId: 'A', at: 5 }]);
    expect(cBus).toEqual([]);
    expect(atC).toEqual([]);
  });

  it('delivers nowhere when the target is the sender or not attached', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');
    const received: NetEvent[] = [];
    a.channel.on((e) => received.push(e));
    b.channel.on((e) => received.push(e));

    a.sync.sendPing('A');
    a.sync.sendPing('nobody');

    expect(received).toEqual([]);
  });
});
