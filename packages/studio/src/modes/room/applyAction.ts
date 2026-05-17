/**
 * Pure reducer: applies one EditAction to a RoomDocument and returns
 * a new RoomDocument. No React, no side effects, no mutations.
 *
 * This is the replay engine: running a sequence of actions from an
 * empty base document through `reduce(applyAction, baseDoc)` produces
 * the current room state.
 *
 * Each action's semantics mirror the corresponding mutator in
 * `useRoomDocument.ts` exactly.
 */
import type { RoomDocument, PlaceObjectCommand, RoomGroup } from '@officexr/world/scenes';
import { newPlaceObject } from '@officexr/world/scenes';
import type { EditAction } from './EditAction.ts';

export function applyAction(doc: RoomDocument, action: EditAction): RoomDocument {
  switch (action.type) {
    case 'place': {
      const cmd = newPlaceObject({
        kindId: action.kindId,
        position: action.position,
        id: action.commandId,
      });
      return {
        ...doc,
        updatedAt: Date.now(),
        commands: [...doc.commands, cmd],
      };
    }

    case 'placeMany': {
      const cmds: PlaceObjectCommand[] = action.commandIds.map((id, i) =>
        newPlaceObject({
          kindId: action.kindId,
          position: action.positions[i],
          id,
        }),
      );

      const groups: Record<string, RoomGroup> = { ...doc.groups };
      if (action.groupId !== null) {
        const existing = groups[action.groupId];
        if (existing) {
          // Append to existing group
          groups[action.groupId] = {
            ...existing,
            commandIds: [...existing.commandIds, ...cmds.map((c) => c.id)],
          };
        } else {
          // Create new group
          groups[action.groupId] = {
            id: action.groupId,
            commandIds: cmds.map((c) => c.id),
          };
        }
      }

      return {
        ...doc,
        updatedAt: Date.now(),
        commands: [...doc.commands, ...cmds],
        groups,
      };
    }

    case 'delete': {
      const toDelete = new Set(action.commandIds);
      const commands = doc.commands.filter((c) => !toDelete.has(c.id));

      // Reconstruct groups: for each affected group, keep only surviving commandIds.
      // If fewer than 2 survive, drop the group.
      const groups: Record<string, RoomGroup> = {};
      for (const g of Object.values(doc.groups)) {
        if (action.groupsAffected[g.id] !== undefined) {
          // This group is affected by the delete — recompute membership
          const remaining = g.commandIds.filter((cid) => !toDelete.has(cid));
          if (remaining.length >= 2) {
            groups[g.id] = { ...g, commandIds: remaining };
          }
          // If remaining.length < 2, group is dropped
        } else {
          // Group unaffected — keep as-is
          groups[g.id] = g;
        }
      }

      return {
        ...doc,
        updatedAt: Date.now(),
        commands,
        groups,
      };
    }

    case 'setKind': {
      return {
        ...doc,
        updatedAt: Date.now(),
        commands: doc.commands.map((c) =>
          c.id === action.commandId && c.op === 'placeCube'
            ? { ...c, kindId: action.kindId }
            : c,
        ),
      };
    }

    case 'setPosition': {
      return {
        ...doc,
        updatedAt: Date.now(),
        commands: doc.commands.map((c) =>
          c.id === action.commandId && c.op === 'placeCube'
            ? { ...c, position: action.position }
            : c,
        ),
      };
    }

    case 'setPositionMany': {
      const moveMap = new Map(action.moves.map((m) => [m.commandId, m.position]));
      return {
        ...doc,
        updatedAt: Date.now(),
        commands: doc.commands.map((c) => {
          if (c.op === 'placeCube' && moveMap.has(c.id)) {
            return { ...c, position: moveMap.get(c.id)! };
          }
          return c;
        }),
      };
    }

    case 'group': {
      // Only add if none of the commandIds are already in another group.
      // (Mirror the "free" check in useRoomDocument.groupCommands.)
      const alreadyGrouped = action.commandIds.some((cid) =>
        Object.values(doc.groups).some((g) => g.commandIds.includes(cid)),
      );
      if (alreadyGrouped) return doc;

      return {
        ...doc,
        updatedAt: Date.now(),
        groups: {
          ...doc.groups,
          [action.groupId]: {
            id: action.groupId,
            commandIds: action.commandIds,
            label: action.label,
          },
        },
      };
    }

    case 'ungroup': {
      if (!doc.groups[action.groupId]) return doc;
      const { [action.groupId]: _drop, ...rest } = doc.groups;
      void _drop;
      return {
        ...doc,
        updatedAt: Date.now(),
        groups: rest,
      };
    }

    case 'addToGroup': {
      const g = doc.groups[action.groupId];
      if (!g) return doc;
      const incoming = action.commandIds.filter(
        (cid) => !g.commandIds.includes(cid),
      );
      if (incoming.length === 0) return doc;
      return {
        ...doc,
        updatedAt: Date.now(),
        groups: {
          ...doc.groups,
          [action.groupId]: {
            ...g,
            commandIds: [...g.commandIds, ...incoming],
          },
        },
      };
    }
  }
}
