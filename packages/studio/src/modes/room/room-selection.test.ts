import { describe, it, expect } from 'vitest';
import {
  atomicSelectionFor,
  selectionFromClick,
  selectionFromToggle,
  selectionIsExactlyOneGroup,
  type GroupLookup,
} from './room-selection.ts';

function makeLookup(groups: Record<string, string[]>): GroupLookup {
  const commandToGroup = new Map<string, string>();
  for (const [gid, members] of Object.entries(groups)) {
    for (const m of members) commandToGroup.set(m, gid);
  }
  return {
    groupOf: (cid) => commandToGroup.get(cid) ?? null,
    groupMembers: (gid) => groups[gid] ?? [],
  };
}

describe('atomicSelectionFor', () => {
  it('returns just the command when it is not in a group', () => {
    const lookup = makeLookup({});
    expect(atomicSelectionFor('cmd-1', lookup)).toEqual(['cmd-1']);
  });

  it('returns every member of the group when the command IS in a group', () => {
    const lookup = makeLookup({ 'g-1': ['cmd-1', 'cmd-2', 'cmd-3'] });
    expect([...atomicSelectionFor('cmd-2', lookup)].sort()).toEqual([
      'cmd-1',
      'cmd-2',
      'cmd-3',
    ]);
  });

  it('falls back to the command when its group has no members (corrupt state)', () => {
    const lookup: GroupLookup = {
      groupOf: () => 'g-ghost',
      groupMembers: () => [],
    };
    expect(atomicSelectionFor('cmd-1', lookup)).toEqual(['cmd-1']);
  });
});

describe('selectionFromClick (plain click)', () => {
  it('replaces selection with the single clicked command', () => {
    const lookup = makeLookup({});
    const next = selectionFromClick('cmd-a', lookup);
    expect(Array.from(next).sort()).toEqual(['cmd-a']);
  });

  it('replaces selection with the whole group when clicking a group member', () => {
    const lookup = makeLookup({ 'g-1': ['cmd-1', 'cmd-2', 'cmd-3'] });
    const next = selectionFromClick('cmd-2', lookup);
    expect(Array.from(next).sort()).toEqual(['cmd-1', 'cmd-2', 'cmd-3']);
  });
});

describe('selectionFromToggle (Ctrl/Cmd-click)', () => {
  const lookup = makeLookup({ 'g-1': ['cmd-1', 'cmd-2'] });

  it('adds an ungrouped command when it is not already selected', () => {
    const next = selectionFromToggle(new Set(['cmd-a']), 'cmd-b', lookup);
    expect(Array.from(next).sort()).toEqual(['cmd-a', 'cmd-b']);
  });

  it('removes an ungrouped command when it is already selected', () => {
    const next = selectionFromToggle(
      new Set(['cmd-a', 'cmd-b']),
      'cmd-b',
      lookup,
    );
    expect(Array.from(next).sort()).toEqual(['cmd-a']);
  });

  it('adds the WHOLE group when clicking a group member that is not selected', () => {
    const next = selectionFromToggle(new Set(['cmd-a']), 'cmd-1', lookup);
    expect(Array.from(next).sort()).toEqual(['cmd-1', 'cmd-2', 'cmd-a']);
  });

  it('removes the whole group when all members are already selected', () => {
    const next = selectionFromToggle(
      new Set(['cmd-1', 'cmd-2', 'cmd-a']),
      'cmd-2',
      lookup,
    );
    expect(Array.from(next).sort()).toEqual(['cmd-a']);
  });

  it('adds missing members when only SOME of a group is selected', () => {
    const next = selectionFromToggle(new Set(['cmd-1']), 'cmd-1', lookup);
    expect(Array.from(next).sort()).toEqual(['cmd-1', 'cmd-2']);
  });
});

describe('selectionIsExactlyOneGroup', () => {
  const groups = new Map<string, readonly string[]>([
    ['g-1', ['cmd-1', 'cmd-2']],
    ['g-2', ['cmd-x', 'cmd-y', 'cmd-z']],
  ]);

  it('returns the group id when selection matches its membership exactly', () => {
    expect(selectionIsExactlyOneGroup(new Set(['cmd-1', 'cmd-2']), groups)).toBe(
      'g-1',
    );
  });

  it('is order-independent (compares as sets)', () => {
    expect(
      selectionIsExactlyOneGroup(new Set(['cmd-z', 'cmd-x', 'cmd-y']), groups),
    ).toBe('g-2');
  });

  it('returns null when selection is empty', () => {
    expect(selectionIsExactlyOneGroup(new Set(), groups)).toBeNull();
  });

  it('returns null when selection is a strict subset of a group', () => {
    expect(selectionIsExactlyOneGroup(new Set(['cmd-x', 'cmd-y']), groups)).toBeNull();
  });

  it('returns null when selection has extra commands beyond a group', () => {
    expect(
      selectionIsExactlyOneGroup(new Set(['cmd-1', 'cmd-2', 'extra']), groups),
    ).toBeNull();
  });

  it('returns null when no group matches', () => {
    expect(selectionIsExactlyOneGroup(new Set(['extra']), groups)).toBeNull();
  });
});
