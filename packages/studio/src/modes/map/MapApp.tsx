import React from 'react';
import { Leva } from 'leva';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';

/**
 * Map editor — composes one or more rooms into a playable world, with
 * spawn points and an environment (sun / sky / stars / HDRI).
 *
 * Task 5 of the studio restructure landed only the page shell so the
 * routing surface is ready. The canvas + RoomPalette + spawn UX + env
 * panel arrive in Tasks 12-14. Until then the main pane shows a
 * placeholder explaining what's coming.
 */
export function MapApp() {
  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <LeftPanel>
        <ModePlaceholderPanel
          title="Rooms"
          body="The room palette will list every saved Room here. Click to drop an instance onto the map canvas."
        />
      </LeftPanel>
      <main
        style={{
          flex: 1,
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
        }}
      >
        <PlaceholderBanner
          title="Map editor"
          body={[
            'Compose rooms into a world, place spawn points, configure',
            'sun / sky / stars / HDRI background. Coming in Tasks 12-14.',
          ].join('\n')}
        />
      </main>
      <SidePanel>
        <Leva fill flat titleBar={{ drag: false }} />
        <ModePlaceholderPanel
          title="Inspector"
          body="Selected room or spawn point details + the environment panel will live here."
        />
      </SidePanel>
    </div>
  );
}

function PlaceholderBanner({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        maxWidth: 480,
        padding: 24,
        textAlign: 'center',
        font: '14px system-ui, sans-serif',
        color: '#cbd5e1',
      }}
    >
      <h1 style={{ marginTop: 0, color: '#fafafa', fontSize: 22 }}>{title}</h1>
      <p style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>{body}</p>
    </div>
  );
}

function ModePlaceholderPanel({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        font: '12px system-ui, sans-serif',
        color: '#94a3b8',
      }}
    >
      <h2
        style={{
          margin: '0 0 6px',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#cbd5e1',
        }}
      >
        {title}
      </h2>
      <p style={{ margin: 0, lineHeight: 1.4 }}>{body}</p>
    </div>
  );
}
