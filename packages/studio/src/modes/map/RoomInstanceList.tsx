import React from 'react';
import type { RoomInstance } from '@officexr/world/scenes';
import type { MapSelection } from './useMapDocument.ts';

interface RoomInstanceListProps {
  rooms: readonly RoomInstance[];
  selection: MapSelection;
  onSelect: (sel: MapSelection) => void;
  onRotate: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * Right-panel listing of every `RoomInstance` placed on the current
 * map. Each row shows:
 *   - room name + current position
 *   - "↻" rotate button (cycles `rotationY` through 0→1→2→3→0)
 *   - "✕" delete button
 *
 * Clicking the row selects the instance so the TransformControls in
 * the canvas attach to it.
 */
export function RoomInstanceList({
  rooms,
  selection,
  onSelect,
  onRotate,
  onRemove,
}: RoomInstanceListProps) {
  return (
    <div
      style={{
        padding: '12px 14px',
        font: '12px system-ui, sans-serif',
        color: '#cbd5e1',
        borderTop: '1px solid #262626',
      }}
    >
      <div
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontSize: 10,
          color: '#94a3b8',
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        Placed rooms ({rooms.length})
      </div>
      {rooms.length === 0 ? (
        <div style={{ color: '#64748b' }}>
          Click a room in the palette to add an instance.
        </div>
      ) : (
        rooms.map((r) => {
          const isSelected =
            selection !== null &&
            selection.kind === 'room' &&
            selection.id === r.id;
          return (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 6px',
                background: isSelected ? '#1d4ed8' : '#0a0a0a',
                borderRadius: 3,
                marginBottom: 4,
              }}
            >
              <button
                type="button"
                onClick={() => onSelect({ kind: 'room', id: r.id })}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 0,
                  color: '#fafafa',
                  textAlign: 'left',
                  cursor: 'pointer',
                  font: 'inherit',
                  padding: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${r.roomName} at (${r.position.join(', ')})`}
              >
                <div style={{ fontWeight: 600 }}>{r.roomName}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>
                  ({r.position.join(', ')}) · rot {r.rotationY ?? 0}
                </div>
              </button>
              <button
                type="button"
                onClick={() => onRotate(r.id)}
                title="Rotate 90°"
                style={iconBtn}
              >
                ↻
              </button>
              <button
                type="button"
                onClick={() => onRemove(r.id)}
                title="Delete"
                style={{ ...iconBtn, color: '#fca5a5' }}
              >
                ✕
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 22,
  height: 22,
  background: '#1e293b',
  border: '1px solid #334155',
  color: '#cbd5e1',
  borderRadius: 3,
  cursor: 'pointer',
  font: '12px system-ui, sans-serif',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
