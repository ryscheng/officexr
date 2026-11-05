import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StudioHarness } from '../../../test-harness/index.ts';
import { HttpSoundLibraryStorage, InMemorySoundLibraryStorage } from '../soundLibraryStorage.ts';
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

  it('rejects a non-mp3 file without a suggestion', () => {
    expect(soundNameFromFile('ding.wav')).toMatchObject({ type: 'invalid', suggestion: '' });
  });

  it('rejects invalid characters and suggests a sanitized name', () => {
    expect(soundNameFromFile('my ping!.mp3')).toMatchObject({ type: 'invalid', suggestion: 'my-ping' });
  });
});

describe('useSoundLibrary errors', () => {
  it('keeps the list and reports a rejected put', async () => {
    const storage = new InMemorySoundLibraryStorage({ seed: [{ name: 'ding', bytes: [1] }] });
    storage.put = async () => {
      throw new Error('boom');
    };
    const { result } = render(storage);
    await waitFor(() => expect(result.current.sounds).toHaveLength(1));

    await act(() => result.current.upload('other', new Uint8Array([1])));
    expect(result.current.error).toBe('boom');
    expect(result.current.sounds.map((s) => s.name)).toEqual(['ding']);
  });
});

describe('HttpSoundLibraryStorage', () => {
  it('turns a 400 body into a readable message', async () => {
    const fakeFetch = async () => new Response(JSON.stringify({ error: 'invalid resource name' }), { status: 400 });
    const storage = new HttpSoundLibraryStorage({ basePath: '/api/sounds', fetch: fakeFetch });
    await expect(storage.put('bad', new Uint8Array([1]))).rejects.toThrow('save bad: 400 invalid resource name');
  });
});
