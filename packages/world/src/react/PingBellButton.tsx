import type React from 'react';

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/**
 * Bell button that pings a player. Stops propagation so a click doesn't reach R3F's
 * event-source listeners or the world-focus `mousedown` listener on `document`.
 */
export function PingBellButton({ name, onPing }: { name: string; onPing: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Ping ${name || 'player'}`}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={(e) => {
        e.stopPropagation();
        onPing();
      }}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 28,
        height: 28,
        padding: 0,
        border: 'none',
        borderRadius: '50%',
        background: '#111',
        color: '#fff',
        cursor: 'pointer',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    </button>
  );
}
