import { useEffect, useRef } from 'react';
import { button, folder, useControls } from 'leva';
import {
  CUBE_FACES,
  CUBE_KINDS,
  type CubeFace,
} from '@officexr/world';
import type { useSceneDocument } from './useSceneDocument.ts';

type SceneDoc = ReturnType<typeof useSceneDocument>;
type SceneCommand = SceneDoc['doc']['commands'][number];

const KIND_OPTIONS = CUBE_KINDS.map((k) => k.id);
const EXTRUDE_COUNT_DEFAULT = 2;

// Return type kept loose because Leva's `Schema` is internal — its
// public `useControls` accepts any shape compatible with its
// SchemaItem types. We cast at the call site for the consumer's
// values, which is the only spot that needs the precise shape.
function buildSchema(
  command: SceneCommand | null,
  targetLabel: string,
  extrudeCountRef: React.MutableRefObject<number>,
  sceneDoc: SceneDoc,
): Record<string, unknown> {
  if (!command) {
    return {
      tip: {
        value:
          'Pick the Add tool + click the floor to place a cube. Click an existing cube with the Select tool to edit it here.',
        editable: false,
      },
    };
  }
  if (command.op === 'placeCube') {
    // Extrude count lives as a `transient` field that writes to a
    // ref so the per-face buttons read the latest value at click
    // time without triggering a Leva schema rebuild on every digit
    // typed (which would close the input and lose focus).
    const buttonEntries: Record<string, ReturnType<typeof button>> = {};
    for (const face of CUBE_FACES) {
      buttonEntries[`extrude ${face}`] = button(() => {
        sceneDoc.extrudeFromFace(
          command.id,
          face,
          extrudeCountRef.current,
        );
      });
    }
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

interface InspectorValues {
  kind?: string;
  position?: [number, number, number];
  face?: CubeFace;
  count?: number;
  target?: string;
  tip?: string;
}

/**
 * Mounts the Leva-driven inspector for the Scenes editor's currently
 * selected command. The schema rebuilds when the selection or its
 * op changes — `[selectionKey]` deps drive Leva to swap panels.
 *
 * Branch by op:
 *   - placeCube: kind dropdown + integer position vector.
 *   - extrude: face dropdown + count slider (count INCLUDES the
 *     source) + read-only target reference.
 *   - none: a short tip so the panel doesn't read empty.
 *
 * Mirror Leva → store via effects keyed off the actual command so
 * stale closures from a prior selection don't write into the new one.
 */
export function useSceneInspector(sceneDoc: SceneDoc): void {
  const command =
    sceneDoc.selection != null
      ? sceneDoc.doc.commands.find((c) => c.id === sceneDoc.selection) ?? null
      : null;

  // Latest "extrude count" the per-face buttons should use. Held in
  // a ref so the field is `transient` in Leva (no re-render storm
  // while the user types) but the buttons still see the current
  // value on click.
  const extrudeCountRef = useRef<number>(EXTRUDE_COUNT_DEFAULT);

  // Selection key bumps whenever the user picks a different command
  // OR the command's op shape would change (rare — ops can't morph
  // today but the key shields against that future).
  const selectionKey = command ? `${command.id}:${command.op}` : '__none__';

  const targetIdx =
    command?.op === 'extrude'
      ? sceneDoc.doc.commands.findIndex(
          (c) => c.id === command.targetCommandId,
        )
      : -1;
  const targetLabel =
    targetIdx >= 0 ? `#${targetIdx + 1}` : '(none)';

  // Leva's `useControls` expects a Schema-typed schema fn; our
  // branching builder returns a discriminated shape per command kind
  // which TypeScript widens to a union with optional `undefined`
  // properties — incompatible with Leva's strict Schema record. Cast
  // the schema fn at the call site (the value we read back is
  // typed via `InspectorValues` separately).
  const values = useControls(
    'Inspector',
    (() =>
      buildSchema(
        command,
        targetLabel,
        extrudeCountRef,
        sceneDoc,
      )) as () => Record<string, never>,
    [selectionKey, targetLabel],
  ) as InspectorValues;

  // --- Mirror Leva → store ---------------------------------------

  useEffect(() => {
    if (command?.op !== 'placeCube') return;
    if (values.kind && values.kind !== command.kindId) {
      sceneDoc.setKindForCommand(command.id, values.kind);
    }
  }, [command, values.kind, sceneDoc]);

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
      sceneDoc.setPositionForCommand(command.id, next);
    }
  }, [command, values.position, sceneDoc]);

  useEffect(() => {
    if (command?.op !== 'extrude') return;
    if (values.face && values.face !== command.face) {
      sceneDoc.setExtrudeFace(command.id, values.face);
    }
  }, [command, values.face, sceneDoc]);

  useEffect(() => {
    if (command?.op !== 'extrude') return;
    if (values.count != null && values.count !== command.count) {
      sceneDoc.setExtrudeCount(command.id, values.count);
    }
  }, [command, values.count, sceneDoc]);
}
