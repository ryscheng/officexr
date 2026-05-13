import React, { useCallback, useState } from 'react';
import { Leva } from 'leva';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { CommandHistory } from './CommandHistory.tsx';
import { ObjectPalette } from './ObjectPalette.tsx';
import { SceneEditorCanvas } from './SceneEditorCanvas.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useSceneDocument } from './useSceneDocument.ts';
import { useSceneInspector } from './useSceneInspector.ts';
import type { Tool } from './tools.ts';

/**
 * Standalone Scenes editor application. Owns its own R3F canvas, its
 * own document state, and its own free-fly camera. Persists the
 * working document via SceneStorage (filesystem in dev). Has no SDK
 * store, no SyncEngine, no WebSocket — Debug mode is what consumes
 * authored scenes by loading them from disk.
 */
export function ScenesApp() {
  const sceneDoc = useSceneDocument();
  const [tool, setTool] = useState<Tool>('select');
  const [stagedKindId, setStagedKindId] = useState<string | null>(null);

  // Picking a kind in the palette implies "I want to place this".
  // Switch to Add automatically; un-pick reverts to Select.
  const handleStage = useCallback((kindId: string | null) => {
    setStagedKindId(kindId);
    setTool(kindId ? 'add' : 'select');
  }, []);

  // Place via the Add tool, then revert to Select so a stray click
  // doesn't keep dropping cubes (single-shot semantic).
  const handlePlace = useCallback(
    (position: [number, number, number]) => {
      if (!stagedKindId) return;
      sceneDoc.placeCube(stagedKindId, position);
      setTool('select');
    },
    [stagedKindId, sceneDoc],
  );

  // Inspector controls (Leva). useSceneInspector mounts the panels
  // for the active selection; we don't render anything visible here.
  useSceneInspector(sceneDoc);

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <LeftPanel>
        <ObjectPalette staged={stagedKindId} onStage={handleStage} />
      </LeftPanel>
      <main
        style={{
          flex: 1,
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <SceneEditorCanvas
          compiled={sceneDoc.compiled}
          selection={sceneDoc.selection}
          tool={tool}
          stagedKindId={stagedKindId}
          onPlaceAt={handlePlace}
          onSelectInstance={sceneDoc.setSelection}
          onClickEmpty={() => sceneDoc.setSelection(null)}
        />
        <ScenesHud sceneName={sceneDoc.sceneName} tool={tool} />
        <Toolbar
          active={tool}
          stagedKindId={stagedKindId}
          onChange={setTool}
        />
      </main>
      <SidePanel>
        <Leva fill flat titleBar={{ drag: false }} />
        <CommandHistory
          commands={sceneDoc.doc.commands}
          selection={sceneDoc.selection}
          onSelect={sceneDoc.setSelection}
          onDelete={sceneDoc.deleteCommand}
        />
      </SidePanel>
    </div>
  );
}

function ScenesHud(props: { sceneName: string; tool: Tool }) {
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
      {`Scene: ${props.sceneName} · Tool: ${props.tool}
WASD/QE to fly · right-drag to look · scroll to dolly`}
    </div>
  );
}
