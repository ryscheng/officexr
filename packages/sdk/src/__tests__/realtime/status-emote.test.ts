import { describe, expect, it } from 'vitest';
import { createMultiClientHarness } from '../../test-harness/two-client.ts';
import { EMOTE_IDS, STATUS_TEXT_MAX, type GameEvent } from '../../game-state/types.ts';
import { validateNetEvent } from '../../realtime/protocol.ts';

describe('rich status', () => {
  it('shows a peer the custom status, emoji and focus flag, and their removal', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');

    a.actions.setSelfRichStatus({ statusText: 'Writing the spec', statusEmoji: '📝', focus: true });
    expect(b.store.getState().players['A']).toMatchObject({
      statusText: 'Writing the spec',
      statusEmoji: '📝',
      focus: true,
    });

    a.actions.setSelfRichStatus({ statusText: null, statusEmoji: null, focus: false });
    expect(b.store.getState().players['A']).toMatchObject({ statusText: null, statusEmoji: null, focus: false });
  });

  it('trims the text and caps it at the limit', async () => {
    const a = await createMultiClientHarness().add('A');
    a.actions.setSelfRichStatus({ statusText: `  ${'x'.repeat(STATUS_TEXT_MAX + 20)}  ` });
    expect(a.store.getState().players['A']?.statusText).toBe('x'.repeat(STATUS_TEXT_MAX));
    a.actions.setSelfRichStatus({ statusText: '   ' });
    expect(a.store.getState().players['A']?.statusText).toBeNull();
  });

  it('keeps the status through the next availability change', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');

    a.actions.setSelfRichStatus({ statusText: 'Heads down', focus: true });
    a.actions.setSelfPresence({ status: 'away' });

    expect(b.store.getState().players['A']).toMatchObject({ status: 'away', statusText: 'Heads down', focus: true });
  });

  it('reaches a peer who joins after the status was set, through the snapshot handshake', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    a.actions.setSelfRichStatus({ statusText: 'Out for lunch', statusEmoji: '🥪', focus: true });
    a.actions.setSelfHand(true);

    const late = await h.add('C');
    await late.handshake.requestSnapshot();

    expect(late.store.getState().players['A']).toMatchObject({
      statusText: 'Out for lunch',
      statusEmoji: '🥪',
      focus: true,
      handRaised: true,
    });
  });

  it('rejects an oversized status text and accepts a payload without the new fields', () => {
    const base = { kind: 'presence:status', v: 1, actorId: 'A', seq: 1, t: 0, status: 'available', mic: 'none' };
    expect(validateNetEvent(base).ok).toBe(true);
    expect(validateNetEvent({ ...base, statusText: 'x'.repeat(STATUS_TEXT_MAX + 1) }).ok).toBe(false);
    expect(validateNetEvent({ ...base, statusText: 'ok', statusEmoji: '🙂', focus: true }).ok).toBe(true);
  });
});

describe('raise hand', () => {
  it('raises and lowers for a peer, announcing once per change', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');
    const seen: string[] = [];
    b.channel.on((e) => seen.push(e.kind));

    a.actions.setSelfHand(true);
    a.actions.setSelfHand(true);
    expect(b.store.getState().players['A']?.handRaised).toBe(true);

    a.actions.setSelfHand(false);
    expect(b.store.getState().players['A']?.handRaised).toBe(false);
    expect(seen.filter((k) => k === 'presence:hand')).toHaveLength(2);
  });
});

describe('emote:send', () => {
  it('reaches every other peer with the sender and emote id, and not the sender', async () => {
    const h = createMultiClientHarness();
    const a = await h.add('A');
    const b = await h.add('B');
    const c = await h.add('C');
    const atA: GameEvent[] = [];
    const atB: GameEvent[] = [];
    const atC: GameEvent[] = [];
    a.bus.on('emote:received', (e) => atA.push(e));
    b.bus.on('emote:received', (e) => atB.push(e));
    c.bus.on('emote:received', (e) => atC.push(e));

    h.clock.advance(9);
    a.sync.sendEmote('clap');

    const expected = { kind: 'emote:received', fromId: 'A', emote: 'clap', at: 9 };
    expect(atB).toEqual([expected]);
    expect(atC).toEqual([expected]);
    expect(atA).toEqual([]);
  });

  it.each(EMOTE_IDS)('validates the %s emote', (emote) => {
    expect(validateNetEvent({ kind: 'emote:send', v: 1, actorId: 'A', seq: 1, t: 0, emote }).ok).toBe(true);
  });

  it('rejects an emote id outside the list', () => {
    expect(validateNetEvent({ kind: 'emote:send', v: 1, actorId: 'A', seq: 1, t: 0, emote: 'explode' }).ok).toBe(false);
  });
});
