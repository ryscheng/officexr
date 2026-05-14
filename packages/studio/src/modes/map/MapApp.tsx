import React, { useMemo, useState } from 'react';
import { Leva } from 'leva';
import { LeftPanel } from '../../ui/LeftPanel.tsx';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { MapEditorCanvas } from './MapEditorCanvas.tsx';
import { MapPicker } from './MapPicker.tsx';
import { RoomPalette } from './RoomPalette.tsx';
import { RoomInstanceList } from './RoomInstanceList.tsx';
import { SpawnList } from './SpawnList.tsx';
import { useEnvironmentPanel } from './useEnvironmentPanel.ts';
import { useMapDocument } from './useMapDocument.ts';
import { useMapRoomLibrary } from './useMapRoomLibrary.ts';

/**
 * Map editor. Composes rooms into a playable world, configures
 * environment, and places spawn points.
 *
 * Layout:
 *   - LeftPanel:  RoomPalette (saved rooms) + MapPicker (load/new).
 *   - Main:       MapEditorCanvas (free-fly + per-room groups + spawn
 *                 markers + selection outline).
 *   - SidePanel:  Toolbar (spawn-tool toggle), RoomInstanceList,
 *                 SpawnList, Leva env panel (Task 13 wires sky/stars/HDRI).
 */
export function MapApp() {
  const map = useMapDocument();
  const referenced = useMemo(() => {
    const s = new Set<string>();
    for (const r of map.doc.rooms) s.add(r.roomName);
    return s;
  }, [map.doc.rooms]);
  const library = useMapRoomLibrary(referenced);
  const [spawnToolActive, setSpawnToolActive] = useState(false);
  useEnvironmentPanel({
    mapName: map.mapName,
    environment: map.doc.environment,
    setEnvironment: map.setEnvironment,
  });

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
            setSpawnToolActive(false);
          }}
          spawnToolActive={spawnToolActive}
        />
        <CanvasHud
          mapName={map.mapName}
          spawnToolActive={spawnToolActive}
          onToggleSpawnTool={() => setSpawnToolActive((s) => !s)}
        />
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
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <Leva fill flat titleBar={{ drag: false }} />
          </div>
        </div>
      </SidePanel>
    </div>
  );
}

interface CanvasHudProps {
  mapName: string;
  spawnToolActive: boolean;
  onToggleSpawnTool: () => void;
}

function CanvasHud({ mapName, spawnToolActive, onToggleSpawnTool }: CanvasHudProps) {
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
      <button
        type="button"
        onClick={onToggleSpawnTool}
        style={{
          padding: '6px 10px',
          background: spawnToolActive ? '#0e7490' : '#1e293b',
          border: '1px solid #334155',
          color: '#fafafa',
          borderRadius: 4,
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        {spawnToolActive ? '✓ Placing spawn — click ground' : '+ Add spawn'}
      </button>
    </div>
  );
}
