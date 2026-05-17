import React from 'react';
import { CUBE_KINDS } from '@officexr/world';

import { Button } from '../../components/ui/button.tsx';
import {
  Panel,
  Readonly,
  Section,
  SelectInput,
  Vector3Input,
} from '../../ui/controls/index.ts';
import type { useRoomDocument } from './useRoomDocument.ts';

type RoomDoc = ReturnType<typeof useRoomDocument>;
type RoomCommand = RoomDoc['doc']['commands'][number];

const KIND_OPTIONS = CUBE_KINDS.map((k) => k.id);

interface InspectorPanelProps {
  roomDoc: RoomDoc;
}

/**
 * Right-hand panel for the Room editor. Replaces the previous Leva-
 * driven `useRoomInspector` hook. Renders one of four branches
 * based on the current selection:
 *
 *   - empty selection      → tip
 *   - multi-selection (>1) → count + "delete all" + "group"
 *   - single placeCube     → kind dropdown, position vec3,
 *                            optional ungroup row if the cube is in
 *                            a group
 *   - unrecognised op      → fallback tip
 *
 * Each control is fully controlled; edits flow straight to the
 * roomDoc mutators with no shared store.
 */
export function InspectorPanel({ roomDoc }: InspectorPanelProps) {
  const selectionSize = roomDoc.selection.size;
  const onlyId =
    selectionSize === 1 ? roomDoc.selection.values().next().value : null;
  const command: RoomCommand | null =
    onlyId != null
      ? roomDoc.doc.commands.find((c) => c.id === onlyId) ?? null
      : null;

  if (selectionSize === 0) {
    return (
      <Panel>
        <div className="px-3 py-3 text-xs text-muted-foreground leading-relaxed">
          Pick the Add tool + click the floor to place a cube. Click
          an existing cube with the Select tool to edit it here. Hold
          Ctrl/Cmd to multi-select.
        </div>
      </Panel>
    );
  }

  if (selectionSize > 1) {
    return (
      <Panel>
        <Section title={`Multi-selection (${selectionSize})`}>
          <Readonly label="selected" value={`${selectionSize} commands`} />
          <div className="flex flex-col gap-1.5 px-3 py-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => roomDoc.deleteSelection()}
            >
              Delete all
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => roomDoc.groupCommands(roomDoc.selection)}
            >
              Group
            </Button>
          </div>
        </Section>
      </Panel>
    );
  }

  if (command?.op === 'placeObject') {
    return <PlaceObjectInspector command={command} roomDoc={roomDoc} />;
  }
  // Defensive: a single-selection with an unrecognised op (e.g. legacy
  // extrude commands in historical maps — they still exist in doc.commands
  // for backward compat but the UI no longer shows an editor for them).
  return (
    <Panel>
      <div className="px-3 py-3 text-xs text-muted-foreground">
        Selected command is unrecognised (legacy op: {command?.op ?? 'unknown'}).
      </div>
    </Panel>
  );
}

interface PlaceObjectProps {
  command: Extract<RoomCommand, { op: 'placeObject' }>;
  roomDoc: RoomDoc;
}

function PlaceObjectInspector({ command, roomDoc }: PlaceObjectProps) {
  const groupId = roomDoc.lookup.groupOf(command.id);

  return (
    <Panel>
      <Section title="placeObject">
        <Readonly label="id" value={command.id} />
        <SelectInput
          label="kind"
          value={command.kindId}
          options={KIND_OPTIONS}
          onChange={(kind) => roomDoc.setKindForCommand(command.id, kind)}
        />
        <Vector3Input
          label="position"
          value={command.position}
          step={1}
          digits={0}
          onChange={(pos) =>
            roomDoc.setPositionForCommand(command.id, [
              Math.round(pos[0]),
              Math.round(pos[1]),
              Math.round(pos[2]),
            ])
          }
        />
      </Section>

      {groupId ? (
        <Section title="Group">
          <Readonly label="member of" value={groupId} />
          <div className="px-3 py-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => roomDoc.ungroupCommands(groupId)}
            >
              Ungroup
            </Button>
          </div>
        </Section>
      ) : null}
    </Panel>
  );
}
