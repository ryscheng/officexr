import React from 'react';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { ObjectKindEditorPanel } from './ObjectKindEditorPanel.tsx';
import { KindList } from './KindList.tsx';
import { ObjectPreviewCanvas } from './ObjectPreviewCanvas.tsx';
import { useObjectCatalog } from './useObjectCatalog.ts';

/**
 * Object editor. Three panes:
 *   - LeftPanel:  KindList (kinds grouped by category + filter).
 *   - Main:       ObjectPreviewCanvas — single rotating instance of
 *                 the selected kind with live material override
 *                 application.
 *   - SidePanel:  ObjectKindEditorPanel (label, category, swatch, walkable,
 *                 scale, and material overrides). Edits hit the
 *                 in-memory catalog synchronously (so the preview +
 *                 Room editor's palette + ObjectInstances renderer
 *                 update live) and round-trip to /api/world-object-kinds with
 *                 a 500ms debounce.
 */
export function ObjectApp() {
  const catalog = useObjectCatalog();

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <LeftPanel>
        <KindList
          kinds={catalog.kinds}
          selectedKindId={catalog.selectedKindId}
          onSelect={catalog.setSelectedKindId}
        />
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
        <ObjectPreviewCanvas kind={catalog.selectedKind} />
        <PreviewHud kind={catalog.selectedKind ? catalog.selectedKind.id : null} />
      </main>
      <SidePanel>
        <ObjectKindEditorPanel
          kind={catalog.selectedKind}
          applyPatch={catalog.applyPatch}
        />
      </SidePanel>
    </div>
  );
}

function PreviewHud({ kind }: { kind: string | null }) {
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
      {kind ? `Kind: ${kind}\nright-drag rotate · scroll zoom` : 'No kind selected'}
    </div>
  );
}
