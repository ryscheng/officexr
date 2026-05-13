import React from 'react';
import { TOOLS, type Tool } from './tools.ts';
import { SelectIcon } from '../../ui/icons/SelectIcon.tsx';
import { AddIcon } from '../../ui/icons/AddIcon.tsx';

const TOOL_ICONS: Record<string, React.ReactNode> = {
  select: <SelectIcon />,
  add: <AddIcon />,
};

interface ToolbarProps {
  active: Tool;
  stagedKindId: string | null;
  onChange: (tool: Tool) => void;
}

/**
 * Floating toolbar above the Scenes canvas. Buttons select the
 * active tool; the Add tool's button shows the currently-staged kind
 * as a chip so the user knows what they'd be placing.
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
      aria-label="Scene editor tools"
    >
      {TOOLS.map((t) => {
        const isActive = t.tool === active;
        const isAddDisabled = t.tool === 'add' && !stagedKindId;
        const kindChip =
          t.tool === 'add' && stagedKindId
            ? (
              <span style={{ marginLeft: 5, fontSize: 11, opacity: 0.85 }}>
                {stagedKindId}
              </span>
            )
            : null;
        return (
          <button
            key={t.tool}
            type="button"
            onClick={() => onChange(t.tool)}
            disabled={isAddDisabled}
            title={isAddDisabled ? 'Pick a cube in the palette first' : t.description}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '5px 8px',
              border: 0,
              borderRadius: 4,
              cursor: isAddDisabled ? 'not-allowed' : 'pointer',
              background: isActive ? '#3b82f6' : 'transparent',
              color: isAddDisabled ? '#525252' : isActive ? '#fff' : '#cbd5e1',
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
