import React from 'react';
import type { SpawnPoint } from '@officexr/world/scenes';
import type { MapSelection } from './useMapDocument.ts';

interface SpawnListProps {
  spawns: readonly SpawnPoint[];
  selection: MapSelection;
  onSelect: (sel: MapSelection) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => void;
}

/**
 * Right-panel listing of every spawn point on the current map. Each
 * row exposes the label as an editable text field, plus a delete
 * button. Clicking the row selects the spawn so the canvas
 * highlights its marker.
 */
export function SpawnList({
  spawns,
  selection,
  onSelect,
  onRemove,
  onRename,
}: SpawnListProps) {
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
        Spawn points ({spawns.length})
      </div>
      {spawns.length === 0 ? (
        <div style={{ color: '#64748b' }}>
          Click "+ Add spawn" then click the floor to place one.
        </div>
      ) : (
        spawns.map((s) => {
          const isSelected =
            selection !== null &&
            selection.kind === 'spawn' &&
            selection.id === s.id;
          return (
            <div
              key={s.id}
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
              <input
                value={s.label ?? ''}
                placeholder="(no label)"
                onChange={(e) => onRename(s.id, e.target.value)}
                onFocus={() => onSelect({ kind: 'spawn', id: s.id })}
                style={{
                  flex: 1,
                  padding: '3px 5px',
                  fontSize: 12,
                  background: '#0a0a0a',
                  border: '1px solid #334155',
                  borderRadius: 3,
                  color: '#fafafa',
                  minWidth: 0,
                }}
              />
              <button
                type="button"
                onClick={() => onRemove(s.id)}
                title="Delete"
                style={{
                  width: 22,
                  height: 22,
                  background: '#1e293b',
                  border: '1px solid #334155',
                  color: '#fca5a5',
                  borderRadius: 3,
                  cursor: 'pointer',
                  font: '12px system-ui, sans-serif',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
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
