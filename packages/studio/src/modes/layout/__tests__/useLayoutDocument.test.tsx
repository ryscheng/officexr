import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { InMemoryLayoutStorage, emptyLayoutDocument } from '@officexr/world/scenes';
import { StudioHarness } from '../../../test-harness/index.ts';
import { useLayoutDocument } from '../useLayoutDocument.ts';

// Stub the bake scheduler so a save in a test doesn't kick off a real
// (debounced, GLB-producing) bake. createDefaultApi / createBrowserBakeDeps
// stay real via the spread of the original module.
vi.mock('@officexr/world/app', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@officexr/world/app')>();
  return { ...actual, scheduleBake: vi.fn() };
});

/**
 * Tier 2 integration test for `useLayoutDocument`. The hook wraps
 * `useRoomDocument` with a LayoutStorage↔RoomStorage adapter; this test
 * confirms the adapter round-trips and that the layout-only `optimizer`
 * ride-along persists through a save (a cross-hook state path, taxonomy E).
 */

function makeStorage() {
  return new InMemoryLayoutStorage({
    seed: [{ name: 'default', doc: emptyLayoutDocument('default', 'Default') }],
  });
}

beforeEach(() => {
  globalThis.localStorage?.clear();
});

describe('useLayoutDocument', () => {
  it('loads the seeded layout and places objects', async () => {
    const layoutStorage = makeStorage();
    const { result } = renderHook(() => useLayoutDocument({ layoutStorage }), {
      wrapper: StudioHarness,
    });
    await waitFor(() => expect(result.current.layoutName).toBe('default'));

    act(() => {
      result.current.placeObject('colored_block_blue', [0, 0, 0]);
    });
    expect(result.current.doc.commands).toHaveLength(1);

    act(() => result.current.undo());
    expect(result.current.doc.commands).toHaveLength(0);
    act(() => result.current.redo());
    expect(result.current.doc.commands).toHaveLength(1);
  });

  it('folds the optimizer choice into the saved layout document', async () => {
    // The optimizer is layout-only metadata held outside the command
    // history. The storage adapter (roomToLayout) must ride it along on
    // every save. Drive a real scene mutation to force an autosave, then
    // confirm the persisted LayoutDocument carries both the command and
    // the chosen optimizer.
    const layoutStorage = makeStorage();
    const { result } = renderHook(() => useLayoutDocument({ layoutStorage }), {
      wrapper: StudioHarness,
    });
    await waitFor(() => expect(result.current.layoutName).toBe('default'));

    act(() => result.current.setOptimizer('greedy-mesh'));
    expect(result.current.optimizer).toBe('greedy-mesh');

    act(() => {
      result.current.placeObject('colored_block_blue', [0, 0, 0]);
    });

    await waitFor(
      async () => {
        const persisted = await layoutStorage.load('default');
        expect(persisted?.commands).toHaveLength(1);
        expect(persisted?.optimizer).toBe('greedy-mesh');
      },
      { timeout: 2000 },
    );
  });
});
