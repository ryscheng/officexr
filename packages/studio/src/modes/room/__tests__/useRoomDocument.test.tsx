import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { InMemoryRoomStorage, emptyRoomDocument } from '@officexr/world/scenes';
import { StudioHarness } from '../../../test-harness/index.ts';
import { useRoomDocument } from '../useRoomDocument.ts';

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
});
