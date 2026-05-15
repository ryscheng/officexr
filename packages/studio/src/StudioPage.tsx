import React, { useEffect, useState } from 'react';
import { Header, isStudioMode, type StudioMode } from './ui/Header.tsx';
import { DebugApp } from './modes/debug/DebugApp.tsx';
import { RoomApp } from './modes/room/RoomApp.tsx';
import { CharacterApp } from './modes/character/CharacterApp.tsx';
import { MapApp } from './modes/map/MapApp.tsx';
import { ObjectApp } from './modes/object/ObjectApp.tsx';
import { MugshotApp } from './modes/mugshot/MugshotApp.tsx';

const DEFAULT_MODE: StudioMode = 'map';

/**
 * Top-level studio shell. Renders the persistent header and the
 * currently-selected mode app below it.
 *
 *   - MapApp:       compose rooms into a world (Tasks 12-14 wire the canvas).
 *   - RoomApp:      build a room from objects — the renamed Scenes editor.
 *   - ObjectApp:    view + tune the catalog (Task 11 wires the editor).
 *   - CharacterApp: standalone character previewer + tuning bench.
 *   - DebugApp:     multiplayer scene with the SDK store, bots, network.
 *
 * The active mode is mirrored into `location.hash` so a designer can
 * bookmark `studio#room` or hard-refresh without losing their tab.
 *
 * Mounting one mode unmounts the others. Switching tabs disposes the
 * previous app's state (its store, channel, animations) so we don't
 * pay for what isn't on screen.
 */
export function StudioPage() {
  const [studioMode, setStudioMode] = useState<StudioMode>(() =>
    readHashMode() ?? DEFAULT_MODE,
  );

  // Mirror mode → hash so links survive a hard reload. Compare only
  // the BASE hash (before any `/sub-route`) so `#mugshot/Barbarian`
  // isn't clobbered back to `#mugshot` whenever this effect runs.
  useEffect(() => {
    const currentBase = window.location.hash.replace(/^#/, '').split('/')[0];
    if (currentBase !== studioMode) {
      window.history.replaceState(null, '', `#${studioMode}`);
    }
  }, [studioMode]);

  // Mirror hash → mode so back/forward + manual hash edits work.
  useEffect(() => {
    const handler = () => {
      const fromHash = readHashMode();
      if (fromHash && fromHash !== studioMode) {
        setStudioMode(fromHash);
      }
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, [studioMode]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#0a0a0a',
        color: '#fafafa',
      }}
    >
      <Header active={studioMode} onChange={setStudioMode} />
      {studioMode === 'map' && <MapApp />}
      {studioMode === 'room' && <RoomApp />}
      {studioMode === 'object' && <ObjectApp />}
      {studioMode === 'character' && <CharacterApp />}
      {studioMode === 'debug' && <DebugApp />}
      {studioMode === 'mugshot' && <MugshotApp />}
    </div>
  );
}

function readHashMode(): StudioMode | null {
  if (typeof window === 'undefined') return null;
  // Strip the leading `#` AND any `/sub-route` (used by Mugshot mode
  // to encode a character: `#mugshot/Barbarian`).
  const fromHash = window.location.hash.replace(/^#/, '').split('/')[0];
  return isStudioMode(fromHash) ? fromHash : null;
}
