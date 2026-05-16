import React from 'react';
import type { EditAction } from './EditAction.ts';

interface CommandHistoryProps {
  nodes: ReadonlyArray<{ id: string; label: string }>;
  currentNodeId: string | null;
  onJumpTo: (nodeId: string) => void;
}

/**
 * History panel for the Room editor. Shows the EditAction history with
 * time-travel support. Clicking a row calls `onJumpTo` with that node's id
 * to jump to that point in history.
 *
 * Visual states:
 *   - past (before current): normal text, transparent background
 *   - current: highlighted blue background, white text
 *   - future (after current, i.e. redo-able): greyed-out text
 *
 * No per-row "×" delete buttons — time-travel replaces the old delete-history
 * row pattern.
 */
export function CommandHistory({
  nodes,
  currentNodeId,
  onJumpTo,
}: CommandHistoryProps) {
  const currentIndex =
    currentNodeId === null ? -1 : nodes.findIndex((n) => n.id === currentNodeId);

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
        History ({nodes.length})
      </div>

      {nodes.length === 0 ? (
        <p style={{ fontSize: 12, color: '#a3a3a3', margin: 0 }}>
          No actions yet.
        </p>
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
          {nodes.map((node, i) => {
            const isCurrent = i === currentIndex;
            const isFuture = currentIndex !== -1 && i > currentIndex;

            let bgColor = 'transparent';
            let textColor = '#fafafa';
            if (isCurrent) {
              bgColor = '#1d4ed8';
              textColor = '#ffffff';
            } else if (isFuture) {
              textColor = '#525252';
            }

            return (
              <li key={node.id}>
                <button
                  type="button"
                  onClick={() => onJumpTo(node.id)}
                  data-current={isCurrent ? 'true' : undefined}
                  data-future={isFuture ? 'true' : undefined}
                  title={node.id}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '4px 6px',
                    background: bgColor,
                    color: textColor,
                    border: isCurrent
                      ? '1px solid #3b82f6'
                      : '1px solid #262626',
                    borderLeft: isCurrent ? '3px solid #60a5fa' : undefined,
                    borderRadius: 3,
                    cursor: 'pointer',
                    font: '11px monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {String(i + 1).padStart(2, '0')}. {node.label}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
