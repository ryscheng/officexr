import React, { useState } from 'react';
import { SidePanel } from '../../ui/SidePanel.tsx';
import {
  CharacterEditorCanvas,
  type CharacterPartHover,
} from './CharacterEditorCanvas.tsx';
import { CharacterPanel } from './CharacterPanel.tsx';
import { useCharacterControls } from './useCharacterControls.ts';

/**
 * Standalone Characters editor application. Mounts its own canvas
 * with one Adventurer + endless grid + an orbit/follow camera.
 *
 * The right panel hosts the shadcn-based `CharacterPanel` with three
 * sections: Character (model + take-control toggle), Animation
 * (state buttons), Tuning (per-character speed / collision / anim
 * overrides). Tuning persists to localStorage so Debug mode can
 * pick it up at startup and broadcast via the world:characters
 * NetEvent.
 *
 * No SDK store, no SyncEngine — this is purely a previewer.
 */
export function CharacterApp() {
  const ctrl = useCharacterControls();
  const [hover, setHover] = useState<CharacterPartHover | null>(null);

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
          onPartHover={setHover}
        />
        <CharacterHud
          character={ctrl.character}
          previewState={ctrl.previewState}
          inControl={ctrl.inControl}
        />
        {hover && <PartHoverTooltip hover={hover} />}
      </main>
      <SidePanel>
        <CharacterPanel ctrl={ctrl} />
      </SidePanel>
    </div>
  );
}

/**
 * Floating debug tooltip placed near the cursor showing which mesh
 * / bone the raycast under the cursor hit. Anchored in viewport
 * coords (the canvas raycaster reports clientX/clientY) and offset
 * so the cursor doesn't immediately re-hover the tooltip itself.
 * `pointer-events: none` keeps it from intercepting the raycast.
 */
function PartHoverTooltip({ hover }: { hover: CharacterPartHover }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: hover.clientY + 14,
        left: hover.clientX + 14,
        padding: '4px 8px',
        background: 'rgba(0, 0, 0, 0.85)',
        color: '#fafafa',
        font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
        borderRadius: 4,
        border: '1px solid rgba(255, 255, 255, 0.12)',
        pointerEvents: 'none',
        whiteSpace: 'pre',
        zIndex: 50,
      }}
    >
      {`mesh: ${hover.meshName}${hover.boneName ? `\nbone: ${hover.boneName}` : ''}`}
    </div>
  );
}

function CharacterHud(props: {
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
