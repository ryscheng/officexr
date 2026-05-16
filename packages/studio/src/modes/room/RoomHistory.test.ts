/**
 * TDD tests for RoomHistory — RED phase.
 * These tests are written BEFORE the implementation files exist.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RoomHistory } from './RoomHistory.ts';
import { emptyRoomDocument, newPlaceCube } from '@officexr/world/scenes';
import type { EditAction } from './EditAction.ts';

function makeEmptyDoc() {
  return emptyRoomDocument('test-room');
}

function makePlaceAction(id = 'cmd-1', kindId = 'block-grass'): EditAction {
  return {
    type: 'place',
    commandId: id,
    kindId,
    position: [0, 0, 0],
  };
}

function makePlaceAction2(id = 'cmd-2', kindId = 'block-stone'): EditAction {
  return {
    type: 'place',
    commandId: id,
    kindId,
    position: [1, 0, 1],
  };
}

describe('RoomHistory', () => {
  let baseDoc: ReturnType<typeof makeEmptyDoc>;

  beforeEach(() => {
    baseDoc = makeEmptyDoc();
  });

  it('1. fresh history has no nodes', () => {
    const history = new RoomHistory(baseDoc);
    expect(history.getNodes()).toEqual([]);
  });

  it('2. canUndo/canRedo initial — both false on fresh history', () => {
    const history = new RoomHistory(baseDoc);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('3. push one action — getNodes().length === 1, canUndo === true, canRedo === false, currentNodeId is not null', () => {
    const history = new RoomHistory(baseDoc);
    history.push(makePlaceAction());
    expect(history.getNodes()).toHaveLength(1);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.currentNodeId).not.toBeNull();
  });

  it('4. undo after one push — canUndo === false, canRedo === true, currentNodeId === null (back to base)', () => {
    const history = new RoomHistory(baseDoc);
    history.push(makePlaceAction());
    history.undo();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.currentNodeId).toBeNull();
  });

  it('5. redo after undo — canRedo === false, canUndo === true, currentNodeId is the pushed node id', () => {
    const history = new RoomHistory(baseDoc);
    history.push(makePlaceAction());
    const nodeId = history.currentNodeId;
    history.undo();
    history.redo();
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(true);
    expect(history.currentNodeId).toBe(nodeId);
  });

  it('6. branch invalidation — push A, undo, push B → getNodes() has exactly one node (B); A is gone', () => {
    const history = new RoomHistory(baseDoc);
    history.push(makePlaceAction('cmd-A', 'block-grass'));
    history.undo();
    history.push(makePlaceAction('cmd-B', 'block-stone'));
    const nodes = history.getNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].action.type).toBe('place');
    // The remaining node should be the B action
    expect((nodes[0].action as { type: 'place'; kindId: string }).kindId).toBe('block-stone');
  });

  it('7. jumpTo — push A, push B; jumpTo A makes A current and canRedo === true', () => {
    const history = new RoomHistory(baseDoc);
    history.push(makePlaceAction('cmd-A', 'block-grass'));
    const nodeA_id = history.currentNodeId!;
    history.push(makePlaceAction2('cmd-B', 'block-stone'));
    const nodeB_id = history.currentNodeId!;

    // Jump to B (current) — no change
    history.jumpTo(nodeB_id);
    expect(history.currentNodeId).toBe(nodeB_id);
    expect(history.canRedo).toBe(false);

    // Jump to A — A is now current, B is in future
    history.jumpTo(nodeA_id);
    expect(history.currentNodeId).toBe(nodeA_id);
    expect(history.canRedo).toBe(true);
    expect(history.canUndo).toBe(true);
  });

  it('8. jumpTo restores doc — after push A then push B, jumpTo A produces doc state after A only', () => {
    const history = new RoomHistory(baseDoc);
    const actionA = makePlaceAction('cmd-A', 'block-grass');
    const actionB = makePlaceAction2('cmd-B', 'block-stone');
    history.push(actionA);
    const nodeA_id = history.currentNodeId!;
    history.push(actionB);

    // Both commands should be in currentDoc
    expect(history.currentDoc.commands).toHaveLength(2);

    history.jumpTo(nodeA_id);
    // Only A should be in the doc now
    expect(history.currentDoc.commands).toHaveLength(1);
    expect(history.currentDoc.commands[0].id).toBe('cmd-A');
  });

  it('9. reset — clears all nodes, sets canUndo/canRedo both false, currentDoc === newDoc', () => {
    const history = new RoomHistory(baseDoc);
    history.push(makePlaceAction());
    history.push(makePlaceAction2());

    const newDoc = emptyRoomDocument('new-room');
    history.reset(newDoc);

    expect(history.getNodes()).toHaveLength(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.currentNodeId).toBeNull();
    expect(history.currentDoc).toBe(newDoc);
  });

  it('10. multi-push sequence — push 5 actions; getNodes().length === 5; undo 3 times; currentDoc matches replay of first 2; redo once; back to 3', () => {
    const history = new RoomHistory(baseDoc);
    for (let i = 0; i < 5; i++) {
      history.push({ type: 'place', commandId: `cmd-${i}`, kindId: 'block-grass', position: [i, 0, 0] });
    }
    expect(history.getNodes()).toHaveLength(5);
    expect(history.canUndo).toBe(true);

    history.undo();
    history.undo();
    history.undo();

    // Should now be at node index 1 (0-based), meaning 2 commands in doc
    expect(history.currentDoc.commands).toHaveLength(2);
    expect(history.canRedo).toBe(true);
    expect(history.canUndo).toBe(true);

    history.redo();
    // Back to 3 commands
    expect(history.currentDoc.commands).toHaveLength(3);
  });

  it('getNodes() returns objects without prev/next circular references', () => {
    const history = new RoomHistory(baseDoc);
    history.push(makePlaceAction());
    const nodes = history.getNodes();
    expect(nodes[0]).not.toHaveProperty('prev');
    expect(nodes[0]).not.toHaveProperty('next');
    expect(nodes[0]).toHaveProperty('id');
    expect(nodes[0]).toHaveProperty('label');
    expect(nodes[0]).toHaveProperty('action');
  });
});
