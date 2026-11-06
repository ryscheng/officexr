import React, { useEffect, useMemo, useState } from 'react';
import { useApplication, useCatalogReady } from '@officexr/world/react';
import type { SerializedMap } from '@officexr/world/scenes';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { EnvironmentPanel } from './EnvironmentPanel.tsx';
import { MapEditorCanvas } from './MapEditorCanvas.tsx';
import { MapPicker } from './MapPicker.tsx';
import { MapToolbar } from './MapToolbar.tsx';
import { MAP_TOOLS, type MapTool } from './mapTools.ts';
import { RoomPalette } from './RoomPalette.tsx';
import { RoomInstanceList } from './RoomInstanceList.tsx';
import { deskAreasOf } from './deskAreaGeometry.ts';
import { DeskAreaList } from './DeskAreaList.tsx';
import { findDeskAreaViolations, type DeskAreaViolation } from './deskAreaViolations.ts';
import { SpawnList } from './SpawnList.tsx';
import { useMapDocument, type UseMapDocumentOptions } from './useMapDocument.ts';
import { useMapRoomLibrary } from './useMapRoomLibrary.ts';

/**
 * Map editor. Composes rooms into a playable world, configures
 * environment, and places spawn points.
 *
 * Layout:
 *   - LeftPanel:  RoomPalette (saved rooms) + MapPicker (load/new).
 *   - Main:       MapEditorCanvas (free-fly + per-room groups + spawn
 *                 markers + selection outline) with a top-right
 *                 MapToolbar overlay (Select / Move / Spawn).
 *   - SidePanel:  RoomInstanceList, SpawnList, environment panel.
 */
export function MapApp() {
  const { rooms: roomService, geometry, catalog } = useApplication();
  const catalogReady = useCatalogReady();
  const [validateDeskAreas, setValidateDeskAreas] = useState<
    NonNullable<UseMapDocumentOptions['validateDeskAreas']>
  >(() => () => []);
  const map = useMapDocument({ validateDeskAreas });
  const referenced = useMemo(() => {
    const s = new Set<string>();
    for (const r of map.doc.rooms) s.add(r.roomName);
    return s;
  }, [map.doc.rooms]);
  const library = useMapRoomLibrary(referenced);
  // The library is loaded from the document's rooms, so the validator can only
  // be built after the document exists and is handed back to it via state.
  useEffect(() => {
    setValidateDeskAreas(() => (doc: SerializedMap) =>
      catalogReady && doc.schemaVersion === 2
        ? findDeskAreaViolations(
            doc,
            roomService.compileMap(doc, library.rooms, library.layouts).instances,
            catalog,
            geometry,
          )
        : [],
    );
  }, [catalogReady, roomService, catalog, geometry, library.rooms, library.layouts]);
  const [tool, setTool] = useState<MapTool>('select');

  // Tool keyboard shortcuts (V / M / P / R, Esc → select). Bound at window
  // scope so they work even when focus is in the canvas. Skip while
  // typing in inputs so the SpawnList rename doesn't switch tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      )
        return;
      if (e.key === 'Escape') {
        setTool('select');
        return;
      }
      const key = e.key.toLowerCase();
      for (const def of MAP_TOOLS) {
        if (def.shortcut.toLowerCase() === key) {
          setTool(def.tool);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <LeftPanel>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <MapPicker
            currentName={map.mapName}
            onLoad={(name) => map.loadMap(name)}
            onNew={(name) => map.newMap(name)}
            listMaps={map.listMaps}
          />
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <RoomPalette
              allRoomNames={library.allRoomNames}
              onAddRoom={(name) => map.addRoom(name)}
              onRefresh={() => library.refreshList()}
            />
          </div>
        </div>
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
        <MapEditorCanvas
          doc={map.doc}
          rooms={library.rooms}
          layouts={library.layouts}
          selection={map.selection}
          onSelect={map.setSelection}
          onMoveRoom={map.setRoomPosition}
          onPlaceSpawn={(pos) => {
            map.addSpawn(pos);
            // One-shot: drop back to Select after placing a spawn so
            // the next click selects normally rather than placing
            // another spawn.
            setTool('select');
          }}
          onAddDeskArea={map.addDeskArea}
          deskAreaViolations={map.deskAreaViolations}
          tool={tool}
        />
        <DeskAreaErrorBanner violations={map.deskAreaViolations} />
        <CanvasHud mapName={map.mapName} />
        <MapToolbar tool={tool} onChange={setTool} />
      </main>
      <SidePanel>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: '0 0 auto', maxHeight: '40%', overflowY: 'auto' }}>
            <RoomInstanceList
              rooms={map.doc.rooms}
              selection={map.selection}
              onSelect={map.setSelection}
              onRotate={(id) => {
                const r = map.doc.rooms.find((x) => x.id === id);
                if (!r) return;
                const next = (((r.rotationY ?? 0) + 1) % 4) as 0 | 1 | 2 | 3;
                map.setRoomRotation(id, next);
              }}
              onToggleVoiceZone={map.setRoomVoiceZone}
              onToggleBuilding={map.setRoomBuilding}
              onRemove={map.removeRoom}
            />
            <SpawnList
              spawns={map.doc.spawnPoints}
              selection={map.selection}
              onSelect={map.setSelection}
              onRemove={map.removeSpawn}
              onRename={map.setSpawnLabel}
            />
            <DeskAreaList
              areas={deskAreasOf(map.doc)}
              violations={map.deskAreaViolations}
              selection={map.selection}
              onSelect={map.setSelection}
              onRemove={map.removeDeskArea}
              onRename={map.setDeskAreaLabel}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <EnvironmentPanel
              environment={map.doc.environment}
              setEnvironment={map.setEnvironment}
            />
          </div>
        </div>
      </SidePanel>
    </div>
  );
}

function DeskAreaErrorBanner({ violations }: { violations: readonly DeskAreaViolation[] }) {
  if (violations.length === 0) {
    return null;
  }
  return (
    <div
      role="alert"
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        maxWidth: '60%',
        padding: '8px 12px',
        background: 'rgba(127,29,29,0.92)',
        color: '#fff',
        borderRadius: 4,
        font: '12px system-ui, sans-serif',
        pointerEvents: 'none',
      }}
    >
      Not saved: fix {violations.map((v) => `${v.label} (${v.reason})`).join(', ')}
    </div>
  );
}

interface CanvasHudProps {
  mapName: string;
}

function CanvasHud({ mapName }: CanvasHudProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        font: '12px system-ui, sans-serif',
        color: '#fafafa',
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          background: 'rgba(0,0,0,0.55)',
          borderRadius: 4,
          pointerEvents: 'none',
        }}
      >
        Map: {mapName} · WASD pan · right-drag orbit · scroll zoom · Q/E elevate
      </div>
    </div>
  );
}
