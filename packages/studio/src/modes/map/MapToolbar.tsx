import React from 'react';
import { MAP_TOOLS, type MapTool } from './mapTools.ts';

interface MapToolbarProps {
  tool: MapTool;
  onChange: (tool: MapTool) => void;
}

/**
 * DOM-overlay toolbar for the Map editor (mirrors the visual
 * conventions of `scene-editor/Toolbar.tsx`: top-right, dark pill,
 * `aria-pressed` per button). Map-mode tools (Select/Move/Spawn) are
 * a narrower set than the Room editor's, so this is its own component
 * rather than a shared one — see `mapTools.ts` for rationale.
 *
 * Lives outside the R3F Canvas so it doesn't compete with the scene's
 * pointer events.
 */
export function MapToolbar({ tool, onChange }: MapToolbarProps) {
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
      aria-label="Map editor tools"
    >
      {MAP_TOOLS.map((t) => {
        const isActive = t.tool === tool;
        return (
          <button
            key={t.tool}
            type="button"
            onClick={() => onChange(t.tool)}
            title={`${t.label} (${t.shortcut}) — ${t.description}`}
            aria-pressed={isActive}
            style={{
              padding: '5px 10px',
              border: 0,
              borderRadius: 4,
              cursor: 'pointer',
              background: isActive ? '#3b82f6' : 'transparent',
              color: isActive ? '#fff' : '#cbd5e1',
              font: 'inherit',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
