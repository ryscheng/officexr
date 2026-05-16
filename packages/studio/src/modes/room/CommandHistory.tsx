import React from 'react';
import type { SceneCommand } from '@officexr/world/scenes';

interface CommandHistoryProps {
  commands: SceneCommand[];
  selection: ReadonlySet<string>;
  /** `(id, modKey)` — Ctrl/Cmd toggles, plain replaces. The
   * inspector can read modKey off the React event but the history
   * list does it via the passed flag so its keyboard story stays
   * consistent. */
  onSelect: (commandId: string, modKey: boolean) => void;
  onDelete: (commandId: string) => void;
  /** Map of commandId → groupId so the history can badge group
   * members. */
  commandToGroup: ReadonlyMap<string, string>;
}

/**
 * Linear history list for the Room editor's right panel. Click a row
 * to focus that command in the inspector (Leva). Ctrl/Cmd-click
 * toggles multi-select. Group membership shows as a small chip.
 *
 * Selection state is owned by `useRoomDocument`, so this list is pure
 * presentation. Lives below the Leva panel rather than inside it so
 * its layout stays compact.
 */
export function CommandHistory({
  commands,
  selection,
  onSelect,
  onDelete,
  commandToGroup,
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
            const isSelected = selection.has(c.id);
            const groupId = commandToGroup.get(c.id);
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
                  onClick={(e) =>
                    onSelect(c.id, e.ctrlKey || e.metaKey)
                  }
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
                  {groupId ? <GroupBadge id={groupId} /> : null}
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

function GroupBadge({ id }: { id: string }) {
  // Show only the short suffix so the chip stays readable. The
  // tooltip carries the full id for hovers.
  const short = id.split('-').slice(0, 2).join('-');
  return (
    <span
      title={`group ${id}`}
      style={{
        marginLeft: 6,
        padding: '0 4px',
        borderRadius: 2,
        background: '#374151',
        color: '#e5e7eb',
        font: '10px monospace',
      }}
    >
      {short}
    </span>
  );
}

function commandLabel(c: SceneCommand): string {
  if (c.op === 'placeCube') return `place ${c.kindId} @ ${c.position.join(',')}`;
  // extrude commands are legacy; show a generic label if one appears
  return `legacy op: ${c.op}`;
}
