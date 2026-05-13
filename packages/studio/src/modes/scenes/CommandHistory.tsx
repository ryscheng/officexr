import React from 'react';
import type { SceneCommand } from '@officexr/world/scenes';

interface CommandHistoryProps {
  commands: SceneCommand[];
  selection: string | null;
  onSelect: (commandId: string | null) => void;
  onDelete: (commandId: string) => void;
}

/**
 * Linear history list for the Scenes editor's right panel. Click a
 * row to focus that command in the inspector (Leva). The selection
 * state is owned by `useSceneDocument`, so this list is pure
 * presentation.
 *
 * Lives below the Leva panel rather than inside it so its layout
 * stays compact (Leva's auto-fold UX adds chrome we don't need for
 * a flat selectable list).
 */
export function CommandHistory({
  commands,
  selection,
  onSelect,
  onDelete,
}: CommandHistoryProps) {
  return (
    <div
      style={{
        padding: 12,
        borderTop: '1px solid #2a2f36',
        font: '12px system-ui, sans-serif',
        color: '#fafafa',
      }}
    >
      <div
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontSize: 11,
          color: '#a3a3a3',
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        History ({commands.length})
      </div>
      {commands.length === 0 ? (
        <p style={{ fontSize: 12, color: '#a3a3a3', margin: 0 }}>Empty.</p>
      ) : (
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {commands.map((c, i) => {
            const isSelected = selection === c.id;
            return (
              <li
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    padding: '4px 6px',
                    background: isSelected ? '#1d4ed8' : 'transparent',
                    color: '#fafafa',
                    border: '1px solid #262626',
                    borderRadius: 3,
                    cursor: 'pointer',
                    font: '11px monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={c.id}
                >
                  {String(i + 1).padStart(2, '0')}. {commandLabel(c)}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  title="Delete"
                  style={{
                    padding: '4px 6px',
                    background: '#1f1f1f',
                    color: '#fca5a5',
                    border: '1px solid #262626',
                    borderRadius: 3,
                    cursor: 'pointer',
                    font: '11px system-ui',
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function commandLabel(c: SceneCommand): string {
  if (c.op === 'placeCube') return `place ${c.kindId} @ ${c.position.join(',')}`;
  return `extrude ${c.face} ×${c.count}`;
}
