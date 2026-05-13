import React, { useState } from 'react';
import { Header, type StudioMode } from './ui/Header.tsx';
import { DebugApp } from './modes/debug/DebugApp.tsx';
import { ScenesApp } from './modes/scenes/ScenesApp.tsx';
import { CharactersApp } from './modes/characters/CharactersApp.tsx';

/**
 * Top-level studio shell. Renders the persistent header and the
 * currently-selected mode app below it. Each mode is a SEPARATE
 * application:
 *
 *   - DebugApp: multiplayer scene with the SDK store, bots, and
 *     network protocol. The original behavior, used to debug
 *     gameplay + network.
 *   - ScenesApp: standalone CAD-like scene editor. Saves command-list
 *     scenes to disk via SceneStorage. No SDK / WebSocket.
 *   - CharactersApp: standalone character previewer + tuning bench.
 *     Saves per-model tuning to disk via CharacterStorage. No SDK /
 *     WebSocket.
 *
 * Debug consumes the editors' on-disk output: when it loads a scene
 * or character config, it pushes the result into its store and the
 * existing world:objects / world:characters NetEvents broadcast it
 * to peers + bots.
 *
 * Mounting one mode unmounts the others. Switching tabs disposes the
 * previous app's state (its store, channel, animations) so we don't
 * pay for what isn't on screen.
 */
export function StudioPage() {
  const [studioMode, setStudioMode] = useState<StudioMode>('scenes');

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
      {studioMode === 'scenes' && <ScenesApp />}
      {studioMode === 'characters' && <CharactersApp />}
      {studioMode === 'debug' && <DebugApp />}
    </div>
  );
}
