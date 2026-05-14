import React, { useState } from 'react';
import { CUBE_FACES, CUBE_KINDS, type CubeFace } from '@officexr/world';

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
const EXTRUDE_COUNT_DEFAULT = 2;

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
 *   - single placeCube     → kind dropdown, position vec3, extrude
 *                            count + 6 per-face extrude buttons,
 *                            optional ungroup row if the cube is in
 *                            a group
 *   - single extrude       → face select, count slider, target id
 *
 * Each control is fully controlled; edits flow straight to the
 * roomDoc mutators with no shared store. The extrude count for the
 * placeCube branch lives in component state so the per-face buttons
 * can read the latest value at click time without re-keying.
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

  if (command?.op === 'placeCube') {
    return <PlaceCubeInspector command={command} roomDoc={roomDoc} />;
  }
  if (command?.op === 'extrude') {
    return <ExtrudeInspector command={command} roomDoc={roomDoc} />;
  }
  // Defensive: a single-selection with neither op (shouldn't happen
  // given the discriminated union). Render the empty tip.
  return (
    <Panel>
      <div className="px-3 py-3 text-xs text-muted-foreground">
        Selected command is unrecognised.
      </div>
    </Panel>
  );
}

interface PlaceCubeProps {
  command: Extract<RoomCommand, { op: 'placeCube' }>;
  roomDoc: RoomDoc;
}

function PlaceCubeInspector({ command, roomDoc }: PlaceCubeProps) {
  const [extrudeCount, setExtrudeCount] = useState(EXTRUDE_COUNT_DEFAULT);
  const groupId = roomDoc.lookup.groupOf(command.id);

  return (
    <Panel>
      <Section title="placeCube">
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

      <Section title="Extrude">
        <div className="flex items-center gap-2 px-3 py-1">
          <label className="w-[35%] shrink-0 text-[11px] text-muted-foreground">
            count
          </label>
          <input
            type="number"
            min={1}
            max={64}
            step={1}
            value={extrudeCount}
            onChange={(e) =>
              setExtrudeCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))
            }
            className="w-16 rounded-sm border border-input bg-secondary px-1.5 py-0.5 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
          />
        </div>
        <div className="grid grid-cols-3 gap-1 px-3 py-1.5">
          {CUBE_FACES.map((face) => (
            <Button
              key={face}
              variant="outline"
              size="sm"
              onClick={() =>
                roomDoc.extrudeFromFace(command.id, face, extrudeCount)
              }
            >
              {face}
            </Button>
          ))}
        </div>
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

interface ExtrudeProps {
  command: Extract<RoomCommand, { op: 'extrude' }>;
  roomDoc: RoomDoc;
}

function ExtrudeInspector({ command, roomDoc }: ExtrudeProps) {
  const targetIdx = roomDoc.doc.commands.findIndex(
    (c) => c.id === command.targetCommandId,
  );
  const targetLabel = targetIdx >= 0 ? `#${targetIdx + 1}` : '(missing)';

  return (
    <Panel>
      <Section title="extrude">
        <SelectInput
          label="face"
          value={command.face}
          options={CUBE_FACES as unknown as readonly CubeFace[]}
          onChange={(face) => roomDoc.setExtrudeFace(command.id, face)}
        />
        <div className="flex items-center gap-2 px-3 py-1">
          <label className="w-[35%] shrink-0 text-[11px] text-muted-foreground">
            count
          </label>
          <input
            type="number"
            min={1}
            max={64}
            step={1}
            value={command.count}
            onChange={(e) =>
              roomDoc.setExtrudeCount(
                command.id,
                Math.max(1, Math.floor(Number(e.target.value) || 1)),
              )
            }
            className="w-16 rounded-sm border border-input bg-secondary px-1.5 py-0.5 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
          />
        </div>
        <Readonly label="target" value={targetLabel} />
      </Section>
    </Panel>
  );
}
