import React from 'react';
import { Leva } from 'leva';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { CharacterEditorCanvas } from './CharacterEditorCanvas.tsx';
import { useCharacterControls } from './useCharacterControls.ts';

/**
 * Standalone Characters editor application. Mounts its own canvas
 * with one Adventurer + endless grid + an orbit/follow camera.
 *
 * The right panel hosts a Leva store with three folders: Character
 * (model + take-control toggle), Animation (state buttons), Tuning
 * (per-character speed / collision / animation overrides). Tuning
 * persists to localStorage so Debug mode can pick it up at startup
 * and broadcast via the world:characters NetEvent.
 *
 * No SDK store, no SyncEngine — this is purely a previewer.
 */
export function CharactersApp() {
  const ctrl = useCharacterControls();

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <main
        style={{
          flex: 1,
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <CharacterEditorCanvas
          character={ctrl.character}
          previewState={ctrl.previewState}
          inControl={ctrl.inControl}
          idleSpeed={ctrl.idleAnimSpeed}
          walkSpeed={ctrl.walkAnimSpeed}
          runSpeed={ctrl.runAnimSpeed}
        />
        <CharactersHud
          character={ctrl.character}
          previewState={ctrl.previewState}
          inControl={ctrl.inControl}
        />
      </main>
      <SidePanel>
        <Leva fill flat titleBar={{ drag: false }} />
      </SidePanel>
    </div>
  );
}

function CharactersHud(props: {
  character: string;
  previewState: string;
  inControl: boolean;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        padding: '6px 10px',
        background: 'rgba(0,0,0,0.55)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 4,
        pointerEvents: 'none',
        whiteSpace: 'pre-line',
      }}
    >
      {`${props.character} · ${
        props.inControl ? 'control: WASD' : `state: ${props.previewState}`
      }
right-drag to rotate · scroll to zoom`}
    </div>
  );
}
