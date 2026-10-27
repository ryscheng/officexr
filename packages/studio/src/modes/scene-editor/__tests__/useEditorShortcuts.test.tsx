import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { StudioHarness, createTestApi } from '../../../test-harness/index.ts';
import { useEditorShortcuts, type ShortcutDoc } from '../useEditorShortcuts.ts';
import { useStagedObject } from '../useStagedObject.ts';
import type { Tool } from '../tools.ts';

function fakeDoc(selection: Iterable<string> = []): ShortcutDoc {
  return {
    selection: new Set(selection),
    lookup: { groupMembers: new Map() },
    clearSelection: vi.fn(),
    groupCommands: vi.fn(),
    ungroupCommands: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    deleteSelection: vi.fn(),
    rotateSelection: vi.fn(),
  };
}

function setup(opts: { doc: ShortcutDoc; tool?: Tool; stagedKindId?: string | null }) {
  const api = createTestApi();
  api.catalog.patchKind('colored_block_blue', { rotationStepDeg: 45 });
  const setTool = vi.fn();
  const setBuildHeight = vi.fn();
  const { result } = renderHook(
    () => {
      const staged = useStagedObject();
      useEditorShortcuts({
        doc: opts.doc,
        tool: opts.tool ?? 'select',
        stagedKindId: opts.stagedKindId ?? null,
        setTool,
        setBuildHeight,
        setStagedYawDeg: staged.setStagedYawDeg,
      });
      return staged;
    },
    { wrapper: ({ children }) => <StudioHarness api={api}>{children}</StudioHarness> },
  );
  return { result, setTool, setBuildHeight };
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

describe('useEditorShortcuts', () => {
  it('R rotates the selection outside the Add tool', () => {
    const doc = fakeDoc(['a']);
    const { result } = setup({ doc, tool: 'select', stagedKindId: 'colored_block_blue' });
    press('r');
    expect(doc.rotateSelection).toHaveBeenCalledTimes(1);
    expect(result.current.stagedYawDeg).toBe(0);
  });

  it('R with Add and nothing selected turns the staged object by its kind step', () => {
    const doc = fakeDoc();
    const { result } = setup({ doc, tool: 'add', stagedKindId: 'colored_block_blue' });
    press('r');
    press('R');
    expect(result.current.stagedYawDeg).toBe(90);
    expect(doc.rotateSelection).not.toHaveBeenCalled();
  });

  it('R with Add turns the staged object even while the last placement is selected', () => {
    const doc = fakeDoc(['just-placed']);
    const { result } = setup({ doc, tool: 'add', stagedKindId: 'colored_block_blue' });
    press('r');
    expect(result.current.stagedYawDeg).toBe(45);
    expect(doc.rotateSelection).not.toHaveBeenCalled();
  });

  it('ignores keys typed into an input, and bare-letter keys held with Shift or Alt', () => {
    const doc = fakeDoc(['a']);
    const { setBuildHeight } = setup({ doc });
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('r', {}, input);
    press('r', { shiftKey: true });
    press('e', { altKey: true });
    input.remove();
    expect(doc.rotateSelection).not.toHaveBeenCalled();
    expect(setBuildHeight).not.toHaveBeenCalled();
  });

  it('Ctrl+Z undoes and Ctrl+Shift+Z redoes', () => {
    const doc = fakeDoc();
    setup({ doc });
    press('z', { ctrlKey: true });
    expect(doc.undo).toHaveBeenCalledTimes(1);
    expect(doc.redo).not.toHaveBeenCalled();
    press('Z', { ctrlKey: true, shiftKey: true });
    expect(doc.redo).toHaveBeenCalledTimes(1);
    expect(doc.undo).toHaveBeenCalledTimes(1);
  });
});

describe('useStagedObject', () => {
  it('staging another kind resets the staged yaw', () => {
    const { result } = renderHook(() => useStagedObject());
    act(() => result.current.stageKind('desk'));
    act(() => result.current.setStagedYawDeg(90));
    act(() => result.current.stageKind('chair'));
    expect(result.current).toMatchObject({ stagedKindId: 'chair', stagedYawDeg: 0 });
  });
});
