import type { PlaceCubeCommand } from '@officexr/world/scenes';

/**
 * Discriminated union of all user edits that can be recorded in the
 * doubly-linked history list. One `EditAction` corresponds to one
 * logical user operation (undo-able step).
 *
 * Naming note: `EditAction` = a recorded user edit event.
 * `SceneCommand` / `PlaceCubeCommand` = a placed object in doc.commands.
 * These are completely different things.
 */
export type EditAction =
  | {
      type: 'place';
      commandId: string;
      kindId: string;
      position: [number, number, number];
    }
  | {
      type: 'placeMany';
      commandIds: string[];
      kindId: string;
      positions: [number, number, number][];
      groupId: string | null;
    }
  | {
      type: 'delete';
      commandIds: string[];
      /** Full PlaceCubeCommand objects so undo can restore them. */
      deletedCommands: PlaceCubeCommand[];
      /** Map from groupId → full commandIds array of affected groups, so undo can restore partial group membership. */
      groupsAffected: Record<string, string[]>;
    }
  | { type: 'setKind'; commandId: string; kindId: string }
  | { type: 'setPosition'; commandId: string; position: [number, number, number] }
  | {
      type: 'setPositionMany';
      moves: Array<{ commandId: string; position: [number, number, number] }>;
    }
  | { type: 'group'; groupId: string; commandIds: string[]; label?: string }
  | { type: 'ungroup'; groupId: string; commandIds: string[]; label?: string }
  | { type: 'addToGroup'; groupId: string; commandIds: string[] };

/**
 * A node in the doubly-linked history list.
 */
export interface HistoryNode {
  id: string;
  action: EditAction;
  label: string;
  prev: HistoryNode | null;
  next: HistoryNode | null;
}

/**
 * Returns a short human-readable label for a given EditAction.
 */
export function actionLabel(action: EditAction): string {
  switch (action.type) {
    case 'place':
      return `Place ${action.kindId}`;
    case 'placeMany':
      return `Place ${action.commandIds.length} ${action.kindId}`;
    case 'delete':
      return `Delete ${action.commandIds.length} object(s)`;
    case 'setKind':
      return `Change kind to ${action.kindId}`;
    case 'setPosition':
      return `Move to [${action.position.join(',')}]`;
    case 'setPositionMany':
      return `Move ${action.moves.length} objects`;
    case 'group':
      return `Group ${action.commandIds.length} objects`;
    case 'ungroup':
      return 'Ungroup';
    case 'addToGroup':
      return 'Add to group';
  }
}
