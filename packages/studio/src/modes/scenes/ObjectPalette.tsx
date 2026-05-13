import React from 'react';
import { CUBE_KINDS } from '@officexr/world';

interface ObjectPaletteProps {
  staged: string | null;
  /**
   * Pick (or unpick) a kind. The caller wires this to also flip the
   * active tool to Add — clicking a swatch is the natural "I want to
   * place this" affordance, so it should imply the tool switch
   * without a separate toolbar tap.
   */
  onStage: (kindId: string | null) => void;
}

/**
 * Left-column palette of cube kinds. Click a swatch to stage that
 * kind for the Add tool — the next floor click in the canvas places
 * a `placeCube` command with this kind, then the tool reverts to
 * Select.
 *
 * Categories are flat for v1 — twelve kinds is small enough that
 * grouping (e.g. "Building / Terrain / Hazards") would add chrome
 * without saving scrolls.
 */
export function ObjectPalette({ staged, onStage }: ObjectPaletteProps) {
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontSize: 11,
          color: '#a3a3a3',
          marginBottom: 4,
        }}
      >
        Cubes
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 6,
        }}
      >
        {CUBE_KINDS.map((kind) => {
          const isStaged = staged === kind.id;
          return (
            <button
              key={kind.id}
              type="button"
              onClick={() => onStage(isStaged ? null : kind.id)}
              title={kind.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 8px',
                background: isStaged ? '#1d4ed8' : '#1f1f1f',
                color: '#fafafa',
                border: isStaged ? '1px solid #3b82f6' : '1px solid #262626',
                borderRadius: 4,
                cursor: 'pointer',
                font: '11px system-ui, sans-serif',
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  background: kind.swatch,
                  borderRadius: 2,
                  border: '1px solid rgba(255,255,255,0.2)',
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {kind.label}
              </span>
            </button>
          );
        })}
      </div>
      <p style={{ marginTop: 12, fontSize: 11, color: '#737373', lineHeight: 1.4 }}>
        Click a swatch to stage that cube, then click the floor to place.
        Click an existing cube to select; click a face on the selected
        cube to extrude.
      </p>
    </div>
  );
}
