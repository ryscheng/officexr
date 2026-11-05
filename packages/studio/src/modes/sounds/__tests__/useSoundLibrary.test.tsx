import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StudioHarness } from '../../../test-harness/index.ts';
import { InMemorySoundLibraryStorage } from '../soundLibraryStorage.ts';
import { soundNameFromFile } from '../soundName.ts';
import { useSoundLibrary } from '../useSoundLibrary.ts';

const render = (storage = new InMemorySoundLibraryStorage()) =>
  renderHook(() => useSoundLibrary({ storage }), { wrapper: StudioHarness });

describe('useSoundLibrary', () => {
  it('lists seeded sounds', async () => {
    const { result } = render(new InMemorySoundLibraryStorage({ seed: [{ name: 'ding', bytes: [1, 2, 3] }] }));
    await waitFor(() => expect(result.current.sounds.map((s) => s.name)).toEqual(['ding']));
    expect(result.current.sounds[0].size).toBe(3);
  });

  it('uploads, overwrites and deletes', async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.upload('ding', new Uint8Array([1])));
    expect(result.current.sounds).toHaveLength(1);

    await act(() => result.current.upload('ding', new Uint8Array([1, 2])));
    expect(result.current.sounds).toHaveLength(1);
    expect(result.current.sounds[0].size).toBe(2);

    await act(() => result.current.remove('ding'));
    expect(result.current.sounds).toEqual([]);
  });
});

describe('soundNameFromFile', () => {
  it('strips the .mp3 extension', () => {
    expect(soundNameFromFile('ding.mp3')).toEqual({ type: 'ok', name: 'ding' });
  });

  it('rejects remaining dots and suggests a sanitized name', () => {
    expect(soundNameFromFile('x.mp3.mp3')).toMatchObject({ type: 'invalid', suggestion: 'x-mp3' });
  });

  it('rejects invalid characters and suggests a sanitized name', () => {
    expect(soundNameFromFile('my ping!.mp3')).toMatchObject({ type: 'invalid', suggestion: 'my-ping' });
  });
});
