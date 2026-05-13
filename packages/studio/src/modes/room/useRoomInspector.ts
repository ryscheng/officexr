import { useEffect, useRef } from 'react';
import { button, folder, useControls } from 'leva';
import {
  CUBE_FACES,
  CUBE_KINDS,
  type CubeFace,
} from '@officexr/world';
import type { useRoomDocument } from './useRoomDocument.ts';

type RoomDoc = ReturnType<typeof useRoomDocument>;
type RoomCommand = RoomDoc['doc']['commands'][number];

const KIND_OPTIONS = CUBE_KINDS.map((k) => k.id);
const EXTRUDE_COUNT_DEFAULT = 2;

/**
 * Mounts the Leva-driven inspector for the Room editor's current
 * selection.
 *
 * Three branches:
 *   - selection.size === 0 → a tip prompting the user to click.
 *   - selection.size > 1   → a "Multi-selection (N)" panel with
 *                            "delete all" and "group" buttons so the
 *                            common multi-cube actions are one click.
 *                            Per-cube fields are hidden in this
 *                            branch because they're command-specific.
 *   - selection.size === 1 → the existing placeCube / extrude
 *                            inspector, behaviour unchanged.
 *
 * Mirror Leva → store via effects keyed off the actual command so
 * stale closures from a prior selection don't write into the new one.
 */
export function useRoomInspector(roomDoc: RoomDoc): void {
  const selectionSize = roomDoc.selection.size;
  const onlyId =
    selectionSize === 1 ? roomDoc.selection.values().next().value : null;
  const command =
    onlyId != null
      ? roomDoc.doc.commands.find((c) => c.id === onlyId) ?? null
      : null;

  // Latest "extrude count" the per-face buttons should use. Held in
  // a ref so the field is `transient` in Leva (no re-render storm
  // while the user types) but the buttons still see the current
  // value on click.
  const extrudeCountRef = useRef<number>(EXTRUDE_COUNT_DEFAULT);

  // Selection key bumps whenever the user picks a different command
  // OR the multi-select count changes.
  const selectionKey = command
    ? `${command.id}:${command.op}`
    : selectionSize > 1
      ? `multi:${selectionSize}`
      : '__none__';

  const targetIdx =
    command?.op === 'extrude'
      ? roomDoc.doc.commands.findIndex(
          (c) => c.id === command.targetCommandId,
        )
      : -1;
  const targetLabel = targetIdx >= 0 ? `#${targetIdx + 1}` : '(none)';

  const values = useControls(
    'Inspector',
    (() =>
      buildSchema(
        command,
        selectionSize,
        targetLabel,
        extrudeCountRef,
        roomDoc,
      )) as () => Record<string, never>,
    [selectionKey, targetLabel],
  ) as InspectorValues;

  // --- Mirror Leva → store (single-selection only) --------------

  useEffect(() => {
    if (command?.op !== 'placeCube') return;
    if (values.kind && values.kind !== command.kindId) {
      roomDoc.setKindForCommand(command.id, values.kind);
    }
  }, [command, values.kind, roomDoc]);

  useEffect(() => {
    if (command?.op !== 'placeCube') return;
    const v = values.position;
    if (!v) return;
    const c = command.position;
    const next: [number, number, number] = [
      Math.round(v[0]),
      Math.round(v[1]),
      Math.round(v[2]),
    ];
    if (next[0] !== c[0] || next[1] !== c[1] || next[2] !== c[2]) {
      roomDoc.setPositionForCommand(command.id, next);
    }
  }, [command, values.position, roomDoc]);

  useEffect(() => {
    if (command?.op !== 'extrude') return;
    if (values.face && values.face !== command.face) {
      roomDoc.setExtrudeFace(command.id, values.face);
    }
  }, [command, values.face, roomDoc]);

  useEffect(() => {
    if (command?.op !== 'extrude') return;
    if (values.count != null && values.count !== command.count) {
      roomDoc.setExtrudeCount(command.id, values.count);
    }
  }, [command, values.count, roomDoc]);
}

interface InspectorValues {
  kind?: string;
  position?: [number, number, number];
  face?: CubeFace;
  count?: number;
  target?: string;
  tip?: string;
}

// Leva's `Schema` is internal — its public `useControls` accepts any
// shape compatible with its SchemaItem types. We cast at the call
// site; the value we read back is typed via `InspectorValues`
// separately.
function buildSchema(
  command: RoomCommand | null,
  selectionSize: number,
  targetLabel: string,
  extrudeCountRef: React.MutableRefObject<number>,
  roomDoc: RoomDoc,
): Record<string, unknown> {
  if (selectionSize > 1) {
    return {
      'selected commands': {
        value: `${selectionSize} commands`,
        editable: false,
      },
      'delete all': button(() => {
        roomDoc.deleteSelection();
      }),
      group: button(() => {
        roomDoc.groupCommands(roomDoc.selection);
      }),
    };
  }
  if (!command) {
    return {
      tip: {
        value:
          'Pick the Add tool + click the floor to place a cube. Click an existing cube with the Select tool to edit it here. Hold Ctrl/Cmd to multi-select.',
        editable: false,
      },
    };
  }
  if (command.op === 'placeCube') {
    const buttonEntries: Record<string, ReturnType<typeof button>> = {};
    for (const face of CUBE_FACES) {
      buttonEntries[`extrude ${face}`] = button(() => {
        roomDoc.extrudeFromFace(command.id, face, extrudeCountRef.current);
      });
    }
    const inGroup = roomDoc.lookup.groupOf(command.id);
    const groupRow: Record<string, unknown> = inGroup
      ? {
          group: { value: `member of ${inGroup}`, editable: false },
          ungroup: button(() => {
            roomDoc.ungroupCommands(inGroup);
          }),
        }
      : {};
    return {
      kind: {
        value: command.kindId,
        options: KIND_OPTIONS,
      },
      position: {
        value: [...command.position] as [number, number, number],
        step: 1,
        joystick: false,
      },
      Extrude: folder(
        {
          'extrude count': {
            value: extrudeCountRef.current,
            min: 1,
            max: 64,
            step: 1,
            transient: true,
            onChange: (v: number) => {
              extrudeCountRef.current = Math.max(1, Math.floor(v));
            },
          },
          ...buttonEntries,
        },
        { collapsed: false },
      ),
      ...groupRow,
    };
  }
  return {
    face: {
      value: command.face,
      options: CUBE_FACES as unknown as string[],
    },
    count: {
      value: command.count,
      min: 1,
      max: 64,
      step: 1,
    },
    target: {
      value: targetLabel,
      editable: false,
    },
  };
}
