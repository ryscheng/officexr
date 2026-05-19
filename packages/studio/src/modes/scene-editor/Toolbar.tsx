import React from 'react';
import { TOOLS, type Tool } from './tools.ts';
import { SelectIcon } from '../../ui/icons/SelectIcon.tsx';
import { AddIcon } from '../../ui/icons/AddIcon.tsx';
import { DeleteIcon } from '../../ui/icons/DeleteIcon.tsx';
import { TileIcon } from '../../ui/icons/TileIcon.tsx';
import { MoveIcon } from '../../ui/icons/MoveIcon.tsx';

const TOOL_ICONS: Record<Tool, React.ReactNode> = {
  select: <SelectIcon />,
  add: <AddIcon />,
  delete: <DeleteIcon />,
  tile: <TileIcon />,
  move: <MoveIcon />,
};

interface ToolbarProps {
  active: Tool;
  stagedKindId: string | null;
  onChange: (tool: Tool) => void;
}

/**
 * Floating toolbar above the Room canvas. Buttons select the active
 * tool; the Add tool's button shows the currently-staged kind as a
 * chip so the user knows what they'd be placing.
 *
 * Lives outside the R3F Canvas (DOM overlay) so it doesn't compete
 * with the scene's pointer events.
 */
export function Toolbar({ active, stagedKindId, onChange }: ToolbarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        display: 'flex',
        gap: 4,
        background: 'rgba(0,0,0,0.65)',
        padding: 4,
        borderRadius: 6,
        font: '12px system-ui, sans-serif',
        zIndex: 5,
      }}
      role="toolbar"
      aria-label="Room editor tools"
    >
      {TOOLS.map((t) => {
        const isActive = t.tool === active;
        // Tools that need a staged kind (Add, Tile) are disabled
        // until one is picked from the palette. Tile is also
        // disabled until Task 9 wires its state machine.
        const needsStaged = t.tool === 'add' || t.tool === 'tile';
        const isStagedMissing = needsStaged && !stagedKindId;
        const isDisabled = isStagedMissing || t.comingSoon;
        const title = t.comingSoon
          ? `${t.label} — coming soon`
          : isStagedMissing
            ? 'Pick a cube in the palette first'
            : `${t.label}${t.shortcut ? ` (${t.shortcut})` : ''} — ${t.description}`;
        const kindChip =
          t.tool === 'add' && stagedKindId ? (
            <span style={{ marginLeft: 5, fontSize: 11, opacity: 0.85 }}>
              {stagedKindId}
            </span>
          ) : null;
        return (
          <button
            key={t.tool}
            type="button"
            onClick={() => onChange(t.tool)}
            disabled={isDisabled}
            title={title}
            aria-pressed={isActive}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '5px 8px',
              border: 0,
              borderRadius: 4,
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              background: isActive ? '#3b82f6' : 'transparent',
              color: isDisabled ? '#525252' : isActive ? '#fff' : '#cbd5e1',
              opacity: t.comingSoon ? 0.5 : 1,
            }}
          >
            {TOOL_ICONS[t.tool]}
            {kindChip}
          </button>
        );
      })}
    </div>
  );
}
