import React, { useEffect, useMemo, useState } from 'react';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { EnvironmentPanel } from './EnvironmentPanel.tsx';
import { MapEditorCanvas } from './MapEditorCanvas.tsx';
import { MapPicker } from './MapPicker.tsx';
import { MapToolbar } from './MapToolbar.tsx';
import { MAP_TOOLS, type MapTool } from './mapTools.ts';
import { RoomPalette } from './RoomPalette.tsx';
import { RoomInstanceList } from './RoomInstanceList.tsx';
import { SpawnList } from './SpawnList.tsx';
import { useMapDocument } from './useMapDocument.ts';
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
  const map = useMapDocument();
  const referenced = useMemo(() => {
    const s = new Set<string>();
    for (const r of map.doc.rooms) s.add(r.roomName);
    return s;
  }, [map.doc.rooms]);
  const library = useMapRoomLibrary(referenced);
  const [tool, setTool] = useState<MapTool>('select');

  // Tool keyboard shortcuts (V / M / P, Esc → select). Bound at window
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
          tool={tool}
        />
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
              onRemove={map.removeRoom}
            />
            <SpawnList
              spawns={map.doc.spawnPoints}
              selection={map.selection}
              onSelect={map.setSelection}
              onRemove={map.removeSpawn}
              onRename={map.setSpawnLabel}
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
