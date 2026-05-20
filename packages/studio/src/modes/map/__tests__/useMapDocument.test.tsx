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
});
