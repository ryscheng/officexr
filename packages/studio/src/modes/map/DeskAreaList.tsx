import React from 'react';
import type { DeskArea } from '@officexr/world/scenes';
import type { DeskAreaViolation } from './deskAreaViolations.ts';
import type { MapSelection } from './useMapDocument.ts';

interface DeskAreaListProps {
  areas: readonly DeskArea[];
  violations: readonly DeskAreaViolation[];
  selection: MapSelection;
  onSelect: (sel: MapSelection) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => void;
}

/** Right-panel listing of every desk area; invalid rows show why. */
export function DeskAreaList({
  areas,
  violations,
  selection,
  onSelect,
  onRemove,
  onRename,
}: DeskAreaListProps) {
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
        Desk areas ({areas.length})
      </div>
      {areas.length === 0 ? (
        <div style={{ color: '#64748b' }}>
          Pick the Desk area tool (R) and drag on the floor to draw one.
        </div>
      ) : (
        areas.map((a) => {
          const isSelected =
            selection !== null && selection.kind === 'desk-area' && selection.id === a.id;
          const violation = violations.find((v) => v.areaId === a.id);
          return (
            <div
              key={a.id}
              style={{
                padding: '4px 6px',
                background: isSelected ? '#1d4ed8' : '#0a0a0a',
                borderRadius: 3,
                marginBottom: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  value={a.label ?? ''}
                  placeholder="Desk"
                  aria-label="Desk area label"
                  onChange={(e) => onRename(a.id, e.target.value)}
                  onFocus={() => onSelect({ kind: 'desk-area', id: a.id })}
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
                  onClick={() => onRemove(a.id)}
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
                  }}
                >
                  ✕
                </button>
              </div>
              {violation ? (
                <div style={{ color: '#fca5a5', marginTop: 3 }}>{violation.reason}</div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
