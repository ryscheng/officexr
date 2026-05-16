/**
 * TDD tests for applyAction — RED phase written before full implementation.
 */
import { describe, it, expect } from 'vitest';
import { applyAction } from './applyAction.ts';
import { emptyRoomDocument, newPlaceCube } from '@officexr/world/scenes';
import type { RoomDocument, PlaceCubeCommand } from '@officexr/world/scenes';
import type { EditAction } from './EditAction.ts';

function makeDoc(overrides?: Partial<RoomDocument>): RoomDocument {
  return { ...emptyRoomDocument('test'), ...overrides };
}

function makePlaceCmd(id: string, kindId = 'block-grass', position: [number, number, number] = [0, 0, 0]): PlaceCubeCommand {
  return { id, op: 'placeCube', kindId, position };
}

describe('applyAction', () => {
  // 1. place
  it('place — returns doc with exactly one new command at the specified position and kindId', () => {
    const doc = makeDoc();
    const result = applyAction(doc, {
      type: 'place',
      commandId: 'cmd-x',
      kindId: 'block-grass',
      position: [1, 0, 1],
    });
    expect(result.commands).toHaveLength(1);
    const cmd = result.commands[0] as PlaceCubeCommand;
    expect(cmd.id).toBe('cmd-x');
    expect(cmd.kindId).toBe('block-grass');
    expect(cmd.position).toEqual([1, 0, 1]);
    expect(cmd.op).toBe('placeCube');
  });

  // 2. placeMany no group
  it('placeMany no group — all commands added; no group created', () => {
    const doc = makeDoc();
    const result = applyAction(doc, {
      type: 'placeMany',
      commandIds: ['c1', 'c2'],
      kindId: 'block-stone',
      positions: [[0, 0, 0], [1, 0, 0]],
      groupId: null,
    });
    expect(result.commands).toHaveLength(2);
    expect(Object.keys(result.groups)).toHaveLength(0);
    const ids = result.commands.map((c) => c.id);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
  });

  // 3. placeMany with groupId — group created
  it('placeMany with groupId — all commands added; group in doc.groups contains all new commandIds', () => {
    const doc = makeDoc();
    const result = applyAction(doc, {
      type: 'placeMany',
      commandIds: ['c1', 'c2', 'c3'],
      kindId: 'block-grass',
      positions: [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
      groupId: 'g-1',
    });
    expect(result.commands).toHaveLength(3);
    expect(result.groups['g-1']).toBeDefined();
    expect(result.groups['g-1'].commandIds).toEqual(expect.arrayContaining(['c1', 'c2', 'c3']));
  });

  // 3b. placeMany with groupId — group already exists, append
  it('placeMany with existing groupId — appends to existing group', () => {
    const doc = makeDoc({
      commands: [makePlaceCmd('existing-1')],
      groups: { 'g-1': { id: 'g-1', commandIds: ['existing-1'] } },
    });
    const result = applyAction(doc, {
      type: 'placeMany',
      commandIds: ['c1', 'c2'],
      kindId: 'block-grass',
      positions: [[1, 0, 0], [2, 0, 0]],
      groupId: 'g-1',
    });
    expect(result.groups['g-1'].commandIds).toContain('existing-1');
    expect(result.groups['g-1'].commandIds).toContain('c1');
    expect(result.groups['g-1'].commandIds).toContain('c2');
  });

  // 4. delete single
  it('delete single — named command absent from result doc', () => {
    const doc = makeDoc({ commands: [makePlaceCmd('cmd-a'), makePlaceCmd('cmd-b')] });
    const result = applyAction(doc, {
      type: 'delete',
      commandIds: ['cmd-a'],
      deletedCommands: [makePlaceCmd('cmd-a')],
      groupsAffected: {},
    });
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].id).toBe('cmd-b');
  });

  // 5. delete cleans group
  it('delete — last member of 2-member group: group is removed', () => {
    const doc = makeDoc({
      commands: [makePlaceCmd('a'), makePlaceCmd('b')],
      groups: { 'g-1': { id: 'g-1', commandIds: ['a', 'b'] } },
    });
    const result = applyAction(doc, {
      type: 'delete',
      commandIds: ['b'],
      deletedCommands: [makePlaceCmd('b')],
      groupsAffected: { 'g-1': ['a', 'b'] },
    });
    // Group 'g-1' should be removed because only 1 member ('a') remains — singleton invalid
    expect(result.groups['g-1']).toBeUndefined();
  });

  it('delete — one of 3-member group: group is updated to 2 members', () => {
    const doc = makeDoc({
      commands: [makePlaceCmd('a'), makePlaceCmd('b'), makePlaceCmd('c')],
      groups: { 'g-1': { id: 'g-1', commandIds: ['a', 'b', 'c'] } },
    });
    const result = applyAction(doc, {
      type: 'delete',
      commandIds: ['c'],
      deletedCommands: [makePlaceCmd('c')],
      groupsAffected: { 'g-1': ['a', 'b', 'c'] },
    });
    expect(result.groups['g-1']).toBeDefined();
    expect(result.groups['g-1'].commandIds).toEqual(expect.arrayContaining(['a', 'b']));
    expect(result.groups['g-1'].commandIds).not.toContain('c');
  });

  // 6. setKind
  it('setKind — only the named command\'s kindId changes; all others unchanged', () => {
    const doc = makeDoc({
      commands: [makePlaceCmd('cmd-a', 'block-grass'), makePlaceCmd('cmd-b', 'block-stone')],
    });
    const result = applyAction(doc, {
      type: 'setKind',
      commandId: 'cmd-a',
      kindId: 'block-dirt',
    });
    expect((result.commands[0] as PlaceCubeCommand).kindId).toBe('block-dirt');
    expect((result.commands[1] as PlaceCubeCommand).kindId).toBe('block-stone');
  });

  // 7. setPosition
  it('setPosition — only the named command\'s position changes', () => {
    const doc = makeDoc({
      commands: [makePlaceCmd('cmd-a', 'block-grass', [0, 0, 0]), makePlaceCmd('cmd-b', 'block-stone', [1, 0, 1])],
    });
    const result = applyAction(doc, {
      type: 'setPosition',
      commandId: 'cmd-a',
      position: [5, 0, 5],
    });
    expect((result.commands[0] as PlaceCubeCommand).position).toEqual([5, 0, 5]);
    expect((result.commands[1] as PlaceCubeCommand).position).toEqual([1, 0, 1]);
  });

  // 8. setPositionMany
  it('setPositionMany — multiple positions updated in one action', () => {
    const doc = makeDoc({
      commands: [
        makePlaceCmd('a', 'block-grass', [0, 0, 0]),
        makePlaceCmd('b', 'block-grass', [1, 0, 0]),
        makePlaceCmd('c', 'block-grass', [2, 0, 0]),
      ],
    });
    const result = applyAction(doc, {
      type: 'setPositionMany',
      moves: [
        { commandId: 'a', position: [10, 0, 10] },
        { commandId: 'b', position: [11, 0, 10] },
      ],
    });
    expect((result.commands[0] as PlaceCubeCommand).position).toEqual([10, 0, 10]);
    expect((result.commands[1] as PlaceCubeCommand).position).toEqual([11, 0, 10]);
    expect((result.commands[2] as PlaceCubeCommand).position).toEqual([2, 0, 0]); // unchanged
  });

  // 9. group
  it('group — new group appears in doc.groups with correct commandIds', () => {
    const doc = makeDoc({
      commands: [makePlaceCmd('a'), makePlaceCmd('b')],
    });
    const result = applyAction(doc, {
      type: 'group',
      groupId: 'g-1',
      commandIds: ['a', 'b'],
      label: 'My Group',
    });
    expect(result.groups['g-1']).toBeDefined();
    expect(result.groups['g-1'].commandIds).toEqual(expect.arrayContaining(['a', 'b']));
    expect(result.groups['g-1'].label).toBe('My Group');
  });

  // 10. ungroup
  it('ungroup — named group removed from doc.groups', () => {
    const doc = makeDoc({
      commands: [makePlaceCmd('a'), makePlaceCmd('b')],
      groups: { 'g-1': { id: 'g-1', commandIds: ['a', 'b'] } },
    });
    const result = applyAction(doc, {
      type: 'ungroup',
      groupId: 'g-1',
      commandIds: ['a', 'b'],
    });
    expect(result.groups['g-1']).toBeUndefined();
  });

  // 11. addToGroup
  it('addToGroup — existing group gains new commandIds without duplication', () => {
    const doc = makeDoc({
      commands: [makePlaceCmd('a'), makePlaceCmd('b'), makePlaceCmd('c')],
      groups: { 'g-1': { id: 'g-1', commandIds: ['a'] } },
    });
    const result = applyAction(doc, {
      type: 'addToGroup',
      groupId: 'g-1',
      commandIds: ['b', 'c', 'a'], // 'a' is already in, should not duplicate
    });
    expect(result.groups['g-1'].commandIds).toHaveLength(3);
    expect(result.groups['g-1'].commandIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  // 12. sequence replay
  it('sequence replay — place X, place Y, delete X from base = doc with only Y', () => {
    const base = makeDoc();
    let doc = applyAction(base, { type: 'place', commandId: 'x', kindId: 'block-grass', position: [0, 0, 0] });
    doc = applyAction(doc, { type: 'place', commandId: 'y', kindId: 'block-stone', position: [1, 0, 0] });
    doc = applyAction(doc, {
      type: 'delete',
      commandIds: ['x'],
      deletedCommands: [makePlaceCmd('x')],
      groupsAffected: {},
    });
    expect(doc.commands).toHaveLength(1);
    expect(doc.commands[0].id).toBe('y');
  });

  // 13. immutability
  it('immutability — original doc object not mutated by any action', () => {
    const doc = makeDoc({ commands: [makePlaceCmd('a')] });
    const originalCommands = doc.commands;
    const originalCommandsLength = doc.commands.length;
    applyAction(doc, { type: 'place', commandId: 'new-cmd', kindId: 'block-grass', position: [5, 0, 5] });
    expect(doc.commands).toBe(originalCommands); // same reference
    expect(doc.commands).toHaveLength(originalCommandsLength); // same length
  });
});
