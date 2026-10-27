import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { InMemoryMapStorage, emptyMapDocument } from '@officexr/world/scenes';
import { useMapDocument } from '../useMapDocument.ts';

/**
 * Tier 2 integration test: drives the real `useMapDocument` hook against
 * an in-memory MapStorage. Catches taxonomy types B (closure-stale batch
 * state), C (hardcoded fallbacks), and E (cross-mutation desync) in the
 * document layer without mounting a canvas.
 */

function makeStorage() {
  return new InMemoryMapStorage({
    seed: [{ name: 'default', doc: emptyMapDocument('default', 'Default') }],
  });
}

beforeEach(() => {
  // The hook remembers the last-opened map in localStorage; clear it so
  // each test starts from the seeded 'default' map.
  globalThis.localStorage?.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMapDocument', () => {
  it('loads the seeded document on mount', async () => {
    const storage = makeStorage();
    const { result } = renderHook(() => useMapDocument({ storage }));
    await waitFor(() => expect(result.current.doc.name).toBe('default'));
    expect(result.current.doc.rooms).toHaveLength(0);
  });

  it('addRoom appends an instance and selects it', async () => {
    const storage = makeStorage();
    const { result } = renderHook(() => useMapDocument({ storage }));
    await waitFor(() => expect(result.current.doc.name).toBe('default'));

    let id = '';
    act(() => {
      id = result.current.addRoom('snap-room');
    });

    expect(result.current.doc.rooms).toHaveLength(1);
    expect(result.current.doc.rooms[0].roomName).toBe('snap-room');
    expect(result.current.selection).toEqual({ kind: 'room', id });
  });

  it('addSpawn stores the exact position (no y=0 fallback)', async () => {
    // Taxonomy C: the spawn position must be preserved verbatim, not
    // collapsed to y=0.
    const storage = makeStorage();
    const { result } = renderHook(() => useMapDocument({ storage }));
    await waitFor(() => expect(result.current.doc.name).toBe('default'));

    act(() => {
      result.current.addSpawn([1.5, 2.25, -3]);
    });

    expect(result.current.doc.spawnPoints).toHaveLength(1);
    expect(result.current.doc.spawnPoints[0].position).toEqual([1.5, 2.25, -3]);
  });

  it('removing the selected room clears the selection', async () => {
    const storage = makeStorage();
    const { result } = renderHook(() => useMapDocument({ storage }));
    await waitFor(() => expect(result.current.doc.name).toBe('default'));

    let id = '';
    act(() => {
      id = result.current.addRoom('snap-room');
    });
    expect(result.current.selection).toEqual({ kind: 'room', id });

    act(() => {
      result.current.removeRoom(id);
    });
    expect(result.current.doc.rooms).toHaveLength(0);
    expect(result.current.selection).toBeNull();
  });

  it('persists mutations through the storage (debounced save round-trip)', async () => {
    const storage = makeStorage();
    const saveSpy = vi.spyOn(storage, 'save');
    const { result } = renderHook(() => useMapDocument({ storage }));
    await waitFor(() => expect(result.current.doc.name).toBe('default'));

    act(() => {
      result.current.addRoom('snap-room');
    });

    // Autosave is debounced 500ms; wait for it to flush, then confirm the
    // persisted doc reflects the mutation.
    await waitFor(() => expect(saveSpy).toHaveBeenCalled(), { timeout: 2000 });
    const persisted = await storage.load('default');
    expect(persisted?.rooms).toHaveLength(1);
  });

  it('setRoomVoiceZone persists voiceZone: true, and turning it off removes the field', async () => {
    const storage = makeStorage();
    const { result } = renderHook(() => useMapDocument({ storage }));
    await waitFor(() => expect(result.current.doc.name).toBe('default'));

    let id = '';
    act(() => {
      id = result.current.addRoom('snap-room');
    });
    act(() => {
      result.current.setRoomVoiceZone(id, true);
    });
    await waitFor(
      async () => expect((await storage.load('default'))?.rooms[0].voiceZone).toBe(true),
      { timeout: 2000 },
    );

    act(() => {
      result.current.setRoomVoiceZone(id, false);
    });
    await waitFor(
      async () => expect((await storage.load('default'))?.rooms[0]).not.toHaveProperty('voiceZone'),
      { timeout: 2000 },
    );
  });

  describe('pending autosave', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function renderLoaded() {
      const storage = new InMemoryMapStorage({
        seed: [
          { name: 'default', doc: emptyMapDocument('default') },
          { name: 'other', doc: emptyMapDocument('other') },
        ],
      });
      const view = renderHook(() => useMapDocument({ storage }));
      await waitFor(() => expect(view.result.current.doc.name).toBe('default'));
      vi.useFakeTimers();
      return { storage, ...view };
    }

    it('flushes an edit to the old map when the map is switched within the debounce', async () => {
      const { storage, result } = await renderLoaded();
      const save = vi.spyOn(storage, 'save');

      act(() => {
        result.current.addRoom('snap-room');
      });
      await act(async () => {
        await result.current.loadMap('other');
      });

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][0]).toBe('default');
      expect(save.mock.calls[0][1].rooms).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(save).toHaveBeenCalledTimes(1);
      expect((await storage.load('other'))?.rooms).toHaveLength(0);
    });

    it('flushes an edit to the old storage when the storage changes', async () => {
      const first = makeStorage();
      const second = makeStorage();
      const { result, rerender } = renderHook(
        ({ storage }) => useMapDocument({ storage }),
        { initialProps: { storage: first } },
      );
      await waitFor(() => expect(result.current.doc.name).toBe('default'));
      const firstSave = vi.spyOn(first, 'save');
      const secondSave = vi.spyOn(second, 'save');

      act(() => {
        result.current.addRoom('snap-room');
      });
      rerender({ storage: second });

      expect(firstSave).toHaveBeenCalledTimes(1);
      expect(firstSave.mock.calls[0][1].rooms).toHaveLength(1);
      expect(secondSave).not.toHaveBeenCalled();
    });

    it('reloads a map only after its flushed save has landed (A -> B -> A)', async () => {
      const { storage, result } = await renderLoaded();
      vi.useRealTimers();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const realSave = storage.save.bind(storage);
      vi.spyOn(storage, 'save').mockImplementation(async (name, doc) => {
        await gate;
        return realSave(name, doc);
      });
      const load = vi.spyOn(storage, 'load');

      act(() => {
        result.current.addRoom('snap-room');
      });
      await act(async () => {
        await result.current.loadMap('other');
      });
      await act(async () => {
        await result.current.loadMap('default');
      });
      expect(load).not.toHaveBeenCalled();

      await act(async () => {
        release();
      });
      await waitFor(() => expect(result.current.doc.rooms).toHaveLength(1));
    });

    it('flushes an edit when the hook unmounts within the debounce', async () => {
      const { storage, result, unmount } = await renderLoaded();
      const save = vi.spyOn(storage, 'save');

      act(() => {
        result.current.addRoom('snap-room');
      });
      unmount();

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][0]).toBe('default');
      expect(save.mock.calls[0][1].rooms).toHaveLength(1);
    });

    it('debounces rapid edits into one save 500 ms after the last', async () => {
      const { storage, result } = await renderLoaded();
      const save = vi.spyOn(storage, 'save');

      act(() => {
        result.current.addRoom('a');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      act(() => {
        result.current.addRoom('b');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(save).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][1].rooms).toHaveLength(2);
    });
  });
});
