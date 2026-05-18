/**
 * `<LayoutEditorCanvas>` — thin adapter between `useLayoutDocument` and
 * `SceneEditorCanvas`.
 *
 * `SceneEditorCanvas` requires a `RoomDocument` for the move-tool
 * occupancy checks.  `LayoutDocument` has the same `commands` list but no
 * `groups` or `schemaVersion: 5`.  This wrapper builds the minimal shim so
 * the canvas can be reused without forking.
 *
 * SRP note: this file deliberately does nothing but adapt types.  All editor
 * logic lives in `SceneEditorCanvas`; all state lives in `useLayoutDocument`.
 *
 * DIP note: the dependency on `RoomDocument` here is a backwards-compat shim
 * forced by `SceneEditorCanvas`'s prop type.  Once `SceneEditorCanvas` is
 * refactored to accept `{ commands: SceneCommand[] }` this adapter becomes a
 * one-liner and can be inlined.
 */

import React from 'react';
import type { LayoutDocument } from '@officexr/world/scenes';
import type { RoomDocument } from '@officexr/world/scenes';
import type { WorldObjects } from '@officexr/sdk';
import { SceneEditorCanvas } from '../room/SceneEditorCanvas.tsx';
import type { Tool } from '../room/tools.ts';

interface LayoutEditorCanvasProps {
  doc: LayoutDocument;
  compiled: WorldObjects;
  selection: ReadonlySet<string>;
  tool: Tool;
  stagedKindId: string | null;
  buildHeight: number;
  onPlaceAt: (position: [number, number, number]) => void;
  onSelectInstance: (commandId: string, modKey: boolean) => void;
  onDeleteCommand: (commandId: string) => void;
  onSetTool: (tool: Tool) => void;
  onClickEmpty: () => void;
  onMoveSelection: (
    moves: Array<{ commandId: string; position: [number, number, number] }>,
  ) => void;
}

/** Convert a `LayoutDocument` to the minimal `RoomDocument` shape that
 * `SceneEditorCanvas` needs.  Groups are empty because layouts don't use them.
 */
function asRoomDoc(doc: LayoutDocument): RoomDocument {
  return {
    schemaVersion: 5,
    name: doc.name,
    title: doc.title,
    updatedAt: doc.updatedAt,
    commands: doc.commands,
    groups: {},
  };
}

export function LayoutEditorCanvas({
  doc,
  compiled,
  selection,
  tool,
  stagedKindId,
  buildHeight,
  onPlaceAt,
  onSelectInstance,
  onDeleteCommand,
  onSetTool,
  onClickEmpty,
  onMoveSelection,
}: LayoutEditorCanvasProps) {
  const roomDoc = asRoomDoc(doc);

  return (
    <SceneEditorCanvas
      compiled={compiled}
      selection={selection}
      tool={tool}
      stagedKindId={stagedKindId}
      buildHeight={buildHeight}
      commandToGroup={new Map()}
      groupMembers={new Map()}
      onPlaceAt={onPlaceAt}
      onSelectInstance={onSelectInstance}
      onDeleteCommand={onDeleteCommand}
      onPlaceMany={() => []}
      onCreateGroup={() => null}
      onSetTool={onSetTool}
      onClickEmpty={onClickEmpty}
      onContextMenuRequest={() => undefined}
      doc={roomDoc}
      onMoveSelection={onMoveSelection}
    />
  );
}
