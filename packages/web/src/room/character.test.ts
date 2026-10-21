import { createInMemoryChannelHub } from '@officexr/sdk';
import { createPersistentLocalState, createStack, startOfficeSync, type OfficeSync } from '@officexr/core-refactor';
import { pickCharacterForPlayer } from '@officexr/world/characters';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseCharacter, loadCharacter } from './character';

const OFFICE = '11111111-1111-4111-8111-111111111111';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('loadCharacter', () => {
  it('returns the stored character', async () => {
    const fetchFn = vi.fn(async () => json(200, { characterId: 'Mage' }));
    expect(await loadCharacter(OFFICE, 'a@example.com', fetchFn)).toBe('Mage');
    expect(fetchFn).toHaveBeenCalledWith(`/api/offices/${OFFICE}/character`);
  });

  it('falls back to the login default when nothing is stored', async () => {
    const fetchFn = async () => json(200, { characterId: null });
    expect(await loadCharacter(OFFICE, 'a@example.com', fetchFn)).toBe(
      pickCharacterForPlayer('a@example.com'),
    );
  });
});

describe('chooseCharacter', () => {
  const syncs: OfficeSync[] = [];
  afterEach(() => syncs.splice(0).forEach((s) => s.stop()));

  async function join(hub: ReturnType<typeof createInMemoryChannelHub>, selfId: string) {
    const local = createPersistentLocalState({ selfId, officeId: OFFICE });
    const { channel, voiceAdapter } = createStack({ mode: 'local', hub, selfId });
    syncs.push(await startOfficeSync({ local, channel, voice: voiceAdapter }));
    return local;
  }

  it("updates the peer's view of the player and saves the choice", async () => {
    const hub = createInMemoryChannelHub();
    const a = await join(hub, 'a@example.com');
    const b = await join(hub, 'b@example.com');
    const fetchFn = vi.fn(async () => json(200, { characterId: 'Knight' }));

    await chooseCharacter(a, 'Knight', fetchFn);

    await vi.waitFor(() => expect(b.store.getState().players['a@example.com']?.avatar.model).toBe('Knight'));
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/offices/${OFFICE}/character`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ characterId: 'Knight' }) }),
    );
  });

  it('rejects when the save fails', async () => {
    const a = await join(createInMemoryChannelHub(), 'a@example.com');
    await expect(chooseCharacter(a, 'Knight', async () => json(500, {}))).rejects.toThrow('HTTP 500');
  });
});
