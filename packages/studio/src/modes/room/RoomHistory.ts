import type { RoomDocument } from '@officexr/world/scenes';
import { applyAction } from './applyAction.ts';
import { actionLabel, type EditAction, type HistoryNode } from './EditAction.ts';

let nextNodeSeq = 1;
function mintNodeId(): string {
  return `hn-${(nextNodeSeq++).toString(36)}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * Headless doubly-linked list history engine for the Room editor.
 *
 * Stores EditAction nodes; replays them via `applyAction` to compute
 * the document at any point in time. Designed to be held in a `useRef`
 * in `useRoomDocument` so its mutable linked-list state survives
 * React re-renders without triggering extra renders itself.
 *
 * No imports from `react`, `three`, or `@officexr/world/renderer`.
 */
export class RoomHistory {
  /** The document used as the base for replay. Cleared on reset(). */
  private _baseDoc: RoomDocument;

  /** Oldest node in the list, or null if empty. */
  private _head: HistoryNode | null = null;

  /** Newest node in the list, or null if empty. */
  private _tail: HistoryNode | null = null;

  /**
   * The currently "applied" node. null means we are at the base doc
   * (nothing has been applied yet, or everything has been undone).
   */
  private _current: HistoryNode | null = null;

  /** The document at the current pointer position. */
  private _currentDoc: RoomDocument;

  constructor(baseDoc: RoomDocument) {
    this._baseDoc = baseDoc;
    this._currentDoc = baseDoc;
  }

  get currentDoc(): RoomDocument {
    return this._currentDoc;
  }

  get canUndo(): boolean {
    return this._current !== null;
  }

  get canRedo(): boolean {
    if (this._current === null) {
      // At base — can redo if there are any nodes
      return this._head !== null;
    }
    return this._current.next !== null;
  }

  get currentNodeId(): string | null {
    return this._current?.id ?? null;
  }

  /**
   * Push a new action onto the history.
   *
   * If the current pointer is not at the tail (i.e. we undid and then
   * pushed), this severs the "future" branch and replaces it with the
   * new action.
   */
  push(action: EditAction): void {
    // Sever any "future" branch after current
    if (this._current !== null && this._current !== this._tail) {
      // There are nodes after current — drop them
      this._current.next = null;
      this._tail = this._current;
    } else if (this._current === null && this._head !== null) {
      // We are at base but there are nodes — drop them all
      this._head = null;
      this._tail = null;
    }

    const node: HistoryNode = {
      id: mintNodeId(),
      action,
      label: actionLabel(action),
      prev: this._tail,
      next: null,
    };

    if (this._tail !== null) {
      this._tail.next = node;
    } else {
      this._head = node;
    }
    this._tail = node;
    this._current = node;

    // Apply the action to advance currentDoc
    this._currentDoc = applyAction(this._currentDoc, action);
  }

  /**
   * Undo: move the current pointer back one step. Recompute currentDoc
   * by replaying from baseDoc up to (but not including) the current node.
   */
  undo(): void {
    if (!this.canUndo) return;

    const prev = this._current!.prev;
    this._current = prev;

    // Recompute currentDoc by replaying from base
    this._currentDoc = this._replayTo(prev);
  }

  /**
   * Redo: advance the current pointer forward one step and apply that
   * node's action to currentDoc.
   */
  redo(): void {
    if (!this.canRedo) return;

    const next =
      this._current === null ? this._head! : this._current.next!;
    this._current = next;

    // Apply the next action to currentDoc
    this._currentDoc = applyAction(this._currentDoc, next.action);
  }

  /**
   * Jump to any node in the history by id. If found, sets current to
   * that node and recomputes currentDoc by replaying from baseDoc.
   */
  jumpTo(nodeId: string): void {
    let node = this._head;
    while (node !== null) {
      if (node.id === nodeId) {
        this._current = node;
        this._currentDoc = this._replayTo(node);
        return;
      }
      node = node.next;
    }
    // Node not found — no-op
  }

  /**
   * Returns a flat array of all nodes in order (oldest first),
   * with prev/next stripped to avoid circular references in React rendering.
   */
  getNodes(): ReadonlyArray<Omit<HistoryNode, 'prev' | 'next'>> {
    const result: Array<Omit<HistoryNode, 'prev' | 'next'>> = [];
    let node = this._head;
    while (node !== null) {
      result.push({ id: node.id, action: node.action, label: node.label });
      node = node.next;
    }
    return result;
  }

  /**
   * Reset to a new base document, clearing all history.
   * Used by loadRoom/newRoom.
   */
  reset(newBaseDoc: RoomDocument): void {
    this._baseDoc = newBaseDoc;
    this._head = null;
    this._tail = null;
    this._current = null;
    this._currentDoc = newBaseDoc;
  }

  /**
   * Apply a metadata-only patch (e.g. `{ layoutName: 'lobby' }`) to
   * BOTH `_baseDoc` and `_currentDoc` without recording a history
   * node. Used by mutators that live outside the command history —
   * `setLayoutName`, `title` edits, etc.
   *
   * Why both: subsequent `push`es apply on top of `_currentDoc`, and
   * `undo` / `jumpTo` replay from `_baseDoc`. If the patch were
   * applied only to `_currentDoc`, an undo would lose the metadata.
   * If applied only to `_baseDoc`, the next `push` would overwrite
   * `_currentDoc` from the old version on top of new action → metadata
   * lost. So both must be patched in lockstep.
   *
   * SRP escape hatch: metadata is intentionally NOT in the action
   * history (see `setLayoutName`'s comment in `useRoomDocument`).
   * This method is the side-channel that keeps the metadata coherent
   * with the history-managed `commands` / `groups` without making it
   * a history step.
   */
  patchBaseDoc(patch: Partial<RoomDocument>): void {
    this._baseDoc = { ...this._baseDoc, ...patch };
    this._currentDoc = { ...this._currentDoc, ...patch };
  }

  /**
   * Replay all nodes from head up to and including `targetNode`
   * (or stop before it if targetNode is null, returning baseDoc).
   */
  private _replayTo(targetNode: HistoryNode | null): RoomDocument {
    if (targetNode === null) {
      return this._baseDoc;
    }

    let doc = this._baseDoc;
    let node = this._head;
    while (node !== null) {
      doc = applyAction(doc, node.action);
      if (node === targetNode) break;
      node = node.next;
    }
    return doc;
  }
}
