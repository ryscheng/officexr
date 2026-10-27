import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  InMemoryRoomStorage,
  emptyRoomDocument,
  type RoomDocument,
} from '@officexr/world/scenes';
import { StudioHarness, createTestApi } from '../../../test-harness/index.ts';
import { useRoomDocument } from '../useRoomDocument.ts';
import { BEAM } from './yawedKinds.ts';

/**
 * Tier 2 integration test for `useRoomDocument`. Wrapped in
 * `StudioHarness` because the hook reads `useApplication` (geometry +
 * catalog for the compiled WorldObjects). Catches taxonomy B (the
 * placeMany+groupCommands closure bug) and E (setLayoutName dropped on
 * history rebuild).
 */

function makeStorage() {
  return new InMemoryRoomStorage({
    seed: [{ name: 'default-v2', doc: emptyRoomDocument('default-v2', 'Default') }],
  });
}

beforeEach(() => {
  globalThis.localStorage?.clear();
});

describe('useRoomDocument', () => {
  it('placeObject appends a command; undo/redo walk it', async () => {
    const storage = makeStorage();
    const { result } = renderHook(() => useRoomDocument({ storage }), {
      wrapper: StudioHarness,
    });
    await waitFor(() => expect(result.current.roomName).toBe('default-v2'));

    act(() => {
      result.current.placeObject('colored_block_blue', [0, 0, 0]);
    });
    expect(result.current.doc.commands).toHaveLength(1);

    act(() => result.current.undo());
    expect(result.current.doc.commands).toHaveLength(0);

    act(() => result.current.redo());
    expect(result.current.doc.commands).toHaveLength(1);
  });

  it('rotateSelection turns each selected object by its kind step in one undo step', async () => {
    const api = createTestApi();
    api.catalog.patchKind('colored_block_blue', { rotationStepDeg: 45 });
    const { result } = renderHook(() => useRoomDocument({ storage: makeStorage() }), {
      wrapper: ({ children }) => <StudioHarness api={api}>{children}</StudioHarness>,
    });
    await waitFor(() => expect(result.current.roomName).toBe('default-v2'));

    const ids: string[] = [];
    act(() => {
      ids.push(result.current.placeObject('colored_block_blue', [0, 0, 0], 315));
    });
    act(() => {
      ids.push(result.current.placeObject('unknown-kind', [8, 0, 0]));
    });
    act(() => result.current.setSelection(ids));
    act(() => result.current.rotateSelection());
    const yaws = () =>
      result.current.doc.commands.map((c) => (c.op === 'placeObject' ? c.yawDeg : null));
    expect(yaws()).toEqual([0, 90]);

    act(() => result.current.undo());
    expect(yaws()).toEqual([315, undefined]);
  });

  it('rotateSelection lands an off-step yaw on the kind grid', async () => {
    const { result } = renderHook(() => useRoomDocument({ storage: makeStorage() }), {
      wrapper: StudioHarness,
    });
    await waitFor(() => expect(result.current.roomName).toBe('default-v2'));

    act(() => {
      result.current.placeObject('__primitive_blue', [0, 0, 0], 45);
    });
    act(() => result.current.rotateSelection());
    const cmd = result.current.doc.commands[0];
    expect(cmd.op === 'placeObject' && cmd.yawDeg).toBe(90);

    const nodes = result.current.historyNodes.length;
    act(() => result.current.setYawForCommand(cmd.id, 450));
    expect(result.current.historyNodes).toHaveLength(nodes);
  });

  it('rotateSelection refuses a turn that would overlap an unselected object', async () => {
    const api = createTestApi();
    api.catalog.replaceCatalog({ schemaVersion: 1, updatedAt: 0, kinds: [BEAM] });
    const { result } = renderHook(() => useRoomDocument({ storage: makeStorage() }), {
      wrapper: ({ children }) => <StudioHarness api={api}>{children}</StudioHarness>,
    });
    await waitFor(() => expect(result.current.roomName).toBe('default-v2'));

    // The 4×2-voxel beam only touches the block behind it; a quarter turn
    // about its centre makes it 2×4 and pushes it into the block.
    act(() => {
      result.current.placeMany('__primitive_blue', [[1, 0, 2]]);
    });
    act(() => {
      result.current.placeObject('beam', [0, 0, 0]);
    });
    const before = result.current.historyNodes.length;
    act(() => result.current.rotateSelection());
    expect(result.current.historyNodes).toHaveLength(before);

    act(() => result.current.undo());
    act(() => result.current.undo());
    act(() => {
      result.current.placeObject('beam', [0, 0, 0]);
    });
    act(() => result.current.rotateSelection());
    const beam = result.current.doc.commands[0];
    expect(beam.op === 'placeObject' && beam.yawDeg).toBe(90);
  });

  it('placeMany then groupCommands in one tick groups every placed command', async () => {
    // Taxonomy B: the tile tool calls placeMany + groupCommands
    // synchronously. The bug was groupCommands reading a stale doc
    // snapshot, dropping the freshly-placed cubes from the group.
    const storage = makeStorage();
    const { result } = renderHook(() => useRoomDocument({ storage }), {
      wrapper: StudioHarness,
    });
    await waitFor(() => expect(result.current.roomName).toBe('default-v2'));

    let groupId: string | null = null;
    act(() => {
      const ids = result.current.placeMany('colored_block_blue', [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ]);
      groupId = result.current.groupCommands(ids);
    });

    expect(groupId).not.toBeNull();
    const group = result.current.doc.groups[groupId!];
    expect(group).toBeDefined();
    expect(group.commandIds).toHaveLength(3);
    // Every placed command must be a member.
    const placedIds = result.current.doc.commands.map((c) => c.id);
    for (const id of placedIds) {
      expect(group.commandIds).toContain(id);
    }
  });

  it('setLayoutName survives a subsequent mutation', async () => {
    // Taxonomy E: setLayoutName updated React state but the history
    // rebuild dropped it on the next mutator.
    const storage = makeStorage();
    const { result } = renderHook(() => useRoomDocument({ storage }), {
      wrapper: StudioHarness,
    });
    await waitFor(() => expect(result.current.roomName).toBe('default-v2'));

    act(() => result.current.setLayoutName('lobby-layout'));
    expect(result.current.doc.layoutName).toBe('lobby-layout');

    act(() => {
      result.current.placeObject('colored_block_blue', [0, 0, 0]);
    });
    expect(result.current.doc.layoutName).toBe('lobby-layout');
  });

  describe('pending autosave', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function renderLoaded(afterSave?: (name: string, doc: RoomDocument) => void) {
      const storage = new InMemoryRoomStorage({
        seed: [
          { name: 'default-v2', doc: emptyRoomDocument('default-v2') },
          { name: 'other', doc: emptyRoomDocument('other') },
        ],
      });
      const view = renderHook(() => useRoomDocument({ storage, afterSave }), {
        wrapper: StudioHarness,
      });
      await waitFor(() => expect(view.result.current.roomName).toBe('default-v2'));
      vi.useFakeTimers();
      return { storage, ...view };
    }

    it('flushes an edit to the old room when the room is switched within the debounce', async () => {
      const afterSave = vi.fn();
      const { storage, result } = await renderLoaded(afterSave);
      const save = vi.spyOn(storage, 'save');

      act(() => {
        result.current.placeObject('colored_block_blue', [0, 0, 0]);
      });
      await act(async () => {
        await result.current.loadRoom('other');
      });

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][0]).toBe('default-v2');
      expect(save.mock.calls[0][1].commands).toHaveLength(1);
      expect(afterSave).toHaveBeenCalledTimes(1);
      expect(afterSave).toHaveBeenCalledWith('default-v2', save.mock.calls[0][1]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(save).toHaveBeenCalledTimes(1);
      expect((await storage.load('other'))?.commands).toHaveLength(0);
    });

    it('flushes an edit when the hook unmounts within the debounce', async () => {
      const { storage, result, unmount } = await renderLoaded();
      const save = vi.spyOn(storage, 'save');

      act(() => {
        result.current.placeObject('colored_block_blue', [0, 0, 0]);
      });
      unmount();

      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][0]).toBe('default-v2');
      expect(save.mock.calls[0][1].commands).toHaveLength(1);
    });

    it('debounces rapid edits into one save 500 ms after the last', async () => {
      const { storage, result } = await renderLoaded();
      const save = vi.spyOn(storage, 'save');

      act(() => {
        result.current.placeObject('colored_block_blue', [0, 0, 0]);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      act(() => {
        result.current.placeObject('colored_block_blue', [1, 0, 0]);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(save).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][1].commands).toHaveLength(2);
    });
  });
});
