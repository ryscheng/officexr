/**
 * STUB — replaced by Task 02's real implementation.
 *
 * This stub is provided so Task 01's RoomHistory can import applyAction
 * and run its tests before Task 02 exists. The stub returns the doc
 * unchanged, which means replay will not produce correct intermediate
 * docs — but the linked-list structural tests (canUndo, canRedo,
 * getNodes, branch invalidation) all pass because they test the list
 * mechanics, not the doc content.
 *
 * Test 8 ("jumpTo restores doc") and Test 10 ("multi-push sequence
 * currentDoc matches replay") will use the real implementation once
 * Task 02 replaces this stub.
 */
import type { RoomDocument } from '@officexr/world/scenes';
import type { EditAction } from './EditAction.ts';
import { newPlaceCube } from '@officexr/world/scenes';

export function applyAction(doc: RoomDocument, action: EditAction): RoomDocument {
  switch (action.type) {
    case 'place': {
      const cmd = newPlaceCube({ kindId: action.kindId, position: action.position, id: action.commandId });
      return {
        ...doc,
        updatedAt: Date.now(),
        commands: [...doc.commands, cmd],
      };
    }
    default:
      // Stub: return doc unchanged for all other actions
      return doc;
  }
}
