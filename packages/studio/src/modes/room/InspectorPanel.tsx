import React, { useEffect, useMemo, useState } from 'react';
import { useCatalog } from '@officexr/world/react';
import {
  getBakeState,
  subscribe as registrySubscribe,
  type BakeState,
} from '@officexr/world/app';

import { Button } from '../../components/ui/button.tsx';
import {
  Field,
  Panel,
  Readonly,
  Section,
  SelectInput,
  Vector3Input,
} from '../../ui/controls/index.ts';
import type { useRoomDocument } from './useRoomDocument.ts';

type RoomDoc = ReturnType<typeof useRoomDocument>;
type RoomCommand = RoomDoc['doc']['commands'][number];

interface InspectorPanelProps {
  roomDoc: RoomDoc;
}

// ---------------------------------------------------------------------------
// LayoutSection — always shown at the top of the inspector.
// ---------------------------------------------------------------------------

/**
 * Fetches the list of available layouts from `/api/layouts` and renders
 * an autocomplete field bound to `doc.layoutName`.  Empty value unlinks
 * the layout.
 *
 * ISP note: takes only the two fields it uses from `RoomDoc` rather than
 * the full type, but must still accept the full type at the call site
 * because the parent passes the whole `roomDoc`.  A narrow interface is
 * deferred until InspectorPanel is refactored to accept a slim prop type.
 */
function LayoutSection({ roomDoc }: { roomDoc: RoomDoc }) {
  const [availableLayouts, setAvailableLayouts] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/layouts')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { layouts: { name: string }[] }) =>
        setAvailableLayouts(data.layouts.map((l) => l.name)),
      )
      .catch(() => {
        // Non-blocking — the datalist just stays empty if the route
        // is unavailable (e.g. in test or localStorage environments).
      });
  }, []);

  const currentLayout = roomDoc.doc.layoutName ?? '';

  return (
    <Section title="Room">
      <Field label="layout" hint="Linked layout that provides structural geometry (walls, floors). Leave empty for no layout.">
        <input
          list="inspector-layouts-datalist"
          value={currentLayout}
          placeholder="none"
          onChange={(e) => {
            const v = e.target.value.trim();
            roomDoc.setLayoutName(v || undefined);
          }}
          style={{
            width: '100%',
            background: 'transparent',
            border: '1px solid #334155',
            borderRadius: 3,
            color: '#fafafa',
            fontSize: 11,
            padding: '2px 4px',
          }}
        />
        <datalist id="inspector-layouts-datalist">
          {availableLayouts.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        {currentLayout ? <LayoutBakeBadge layoutName={currentLayout} /> : null}
      </Field>
    </Section>
  );
}

/**
 * Tiny inline status badge for the linked layout's bake state. Shown
 * below the layout input so the user sees WHY a freshly-linked layout
 * isn't visible yet.
 *
 * Two signals are merged:
 *   - `BakeRegistry` for live in-session state (`pending` / `running` /
 *     `error` while a bake is being scheduled or executed).
 *   - A HEAD probe against `/api/baked-layouts/<name>` for ground-
 *     truth disk presence.
 *
 * Priority rules — disk presence trumps a stale registry error:
 *   - `pending` / `running` → show "Bake pending" / "Baking…" (the
 *     in-flight bake is the most informative signal).
 *   - GLB exists on disk → "settled" (badge hides). A registry error
 *     from an earlier failed attempt doesn't matter if the file is
 *     there now — that's what "stale" means.
 *   - No disk file AND registry `error` → "Bake failed" (a real
 *     failure the user should know about).
 *   - No disk file otherwise → "not baked yet" (the user typed a
 *     name that's never been baked).
 *
 * The earlier version mapped `error` straight to "Bake failed" even
 * when the GLB existed, so any past failure stuck the badge until the
 * tab was reloaded — which the user reported as "constantly says Bake
 * Failed."
 */
function LayoutBakeBadge({ layoutName }: { layoutName: string }) {
  const [state, setState] = useState<BakeState>(() => getBakeState(layoutName));
  // `null` = not yet probed. We need three-valued state here because
  // "haven't checked yet" must not look the same as "missing on disk."
  const [diskPresent, setDiskPresent] = useState<boolean | null>(null);

  useEffect(() => {
    setState(getBakeState(layoutName));
    const unsub = registrySubscribe((name, s) => {
      if (name === layoutName) setState(s);
    });
    return unsub;
  }, [layoutName]);

  // Probe disk. Re-runs on every state transition because a registry
  // going `settled` is the signal the GLB just landed; we want the
  // badge to re-read disk so it can flip to settled too.
  useEffect(() => {
    let cancelled = false;
    setDiskPresent(null);
    fetch(`/api/baked-layouts/${encodeURIComponent(layoutName)}`, { method: 'HEAD' })
      .then((r) => {
        if (cancelled) return;
        setDiskPresent(r.ok);
      })
      .catch(() => {
        if (cancelled) return;
        // Network/transport failure (server down, offline, etc.).
        // Leave `diskPresent` null so we don't accidentally flag the
        // layout as missing when the API just isn't reachable.
        setDiskPresent(null);
      });
    return () => { cancelled = true; };
  }, [layoutName, state]);

  // Pick the most-informative status under the priority rules above.
  let effective: BakeState | 'not-baked' | 'settled';
  if (state === 'pending' || state === 'running') {
    effective = state;
  } else if (diskPresent === true) {
    effective = 'settled';
  } else if (state === 'error') {
    effective = 'error';
  } else if (diskPresent === false) {
    effective = 'not-baked';
  } else {
    // Disk probe in flight and registry idle/settled — nothing to
    // show. Avoids a momentary "not baked yet" flash on first mount
    // before the HEAD comes back.
    effective = 'settled';
  }

  if (effective === 'settled') return null;

  const labels: Record<BakeState | 'not-baked', string> = {
    idle: '',
    pending: 'Bake pending…',
    running: 'Baking…',
    settled: 'Baked',
    error: 'Bake failed',
    'not-baked': 'Layout not baked yet — open it in the Layout editor',
  };
  const colors: Record<BakeState | 'not-baked', { bg: string; color: string }> = {
    idle: { bg: 'transparent', color: '#a3a3a3' },
    pending: { bg: '#1a2433', color: '#60a5fa' },
    running: { bg: '#1a2433', color: '#93c5fd' },
    settled: { bg: '#0d2b1d', color: '#4ade80' },
    error: { bg: '#2b0d0d', color: '#f87171' },
    'not-baked': { bg: '#2b0d0d', color: '#f87171' },
  };
  const { bg, color } = colors[effective];

  return (
    <div
      style={{
        marginTop: 4,
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 10,
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: effective === 'not-baked' ? 'none' : 'uppercase',
        display: 'inline-block',
        background: bg,
        color,
      }}
    >
      {labels[effective]}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InspectorPanel — selection-driven branches
// ---------------------------------------------------------------------------

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
        <LayoutSection roomDoc={roomDoc} />
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
        <LayoutSection roomDoc={roomDoc} />
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
      <LayoutSection roomDoc={roomDoc} />
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
  // The kind dropdown stays reactive — if the catalog hot-reloads
  // (e.g. via the Object editor or a `replaceCatalog` test), the
  // available options reflect the live list.
  const kinds = useCatalog();
  const kindOptions = useMemo(() => kinds.map((k) => k.id), [kinds]);

  return (
    <Panel>
      <LayoutSection roomDoc={roomDoc} />
      <Section title="placeObject">
        <Readonly label="id" value={command.id} />
        <SelectInput
          label="kind"
          value={command.kindId}
          options={kindOptions}
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
