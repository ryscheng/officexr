import React from 'react';

export type StudioMode =
  | 'map'
  | 'room'
  | 'object'
  | 'character'
  | 'debug'
  | 'mugshot';

export const STUDIO_MODES: ReadonlyArray<{
  mode: StudioMode;
  label: string;
  description: string;
}> = [
  { mode: 'map', label: 'Map', description: 'Compose rooms into a world' },
  { mode: 'room', label: 'Room', description: 'Build a room from objects' },
  { mode: 'object', label: 'Object', description: 'View + tune the non-character catalog' },
  { mode: 'character', label: 'Character', description: 'Preview models + per-character tuning' },
  { mode: 'debug', label: 'Debug', description: 'Test gameplay + network protocol' },
  { mode: 'mugshot', label: 'Mugshot', description: 'Character placement reference shots' },
];

export function isStudioMode(value: unknown): value is StudioMode {
  return (
    typeof value === 'string' &&
    STUDIO_MODES.some((m) => m.mode === value)
  );
}

interface HeaderProps {
  active: StudioMode;
  onChange: (mode: StudioMode) => void;
}

/**
 * Top-of-page header. "OFFICEXR STUDIO" title on the left, mode tabs
 * on the right. Each mode mounts a completely separate application
 * below; the header is the only chrome they share.
 */
export function Header({ active, onChange }: HeaderProps) {
  return (
    <header
      style={{
        height: 48,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: '#0a0a0a',
        borderBottom: '1px solid #262626',
        color: '#fafafa',
        font: '13px system-ui, sans-serif',
        zIndex: 20,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          letterSpacing: '0.08em',
          fontSize: 14,
        }}
      >
        OFFICEXR STUDIO
      </div>
      <nav style={{ display: 'flex', gap: 4 }} role="tablist" aria-label="Mode">
        {STUDIO_MODES.map((m) => {
          const isActive = m.mode === active;
          return (
            <button
              key={m.mode}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={m.description}
              onClick={() => onChange(m.mode)}
              style={{
                padding: '6px 14px',
                border: 0,
                borderRadius: 4,
                cursor: 'pointer',
                background: isActive ? '#3b82f6' : 'transparent',
                color: isActive ? '#fff' : '#cbd5e1',
                fontWeight: isActive ? 600 : 400,
                fontSize: 13,
              }}
            >
              {m.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
