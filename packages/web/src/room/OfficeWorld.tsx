import { useEffect, useMemo, useState } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import type { OfficeState, Store } from '@officexr/sdk';
import { createDefaultApi, loadMap, type LoadedMap } from '@officexr/world/app';
import {
  ApplicationProvider,
  ErrorBanner,
  FocusIndicator,
  useApplication,
  useCameraModeCycle,
  useWorldFocus,
  WorldHud,
} from '@officexr/world/react';
import { DEFAULT_VIEW_CONFIG, Scene } from '@officexr/world/renderer';
import { FilesystemLayoutStorage, FilesystemMapStorage, FilesystemRoomStorage } from '@officexr/world/scenes';
import type { Identity, Office } from '../../server/api';
import { CharacterPicker } from './CharacterPicker';
import { loadOfficeMap } from './loadOfficeMap';
import { useOfficeSession } from './useOfficeSession';

// Spawn above the point and let gravity land the player, as the studio does.
const SPAWN_DROP_HEIGHT = 4;

const storages = {
  maps: new FilesystemMapStorage(),
  rooms: new FilesystemRoomStorage(),
  layouts: new FilesystemLayoutStorage(),
};

export function OfficeWorld(props: { office: Office; me: Identity }) {
  const api = useMemo(() => createDefaultApi(), []);
  return (
    <ApplicationProvider api={api}>
      <World {...props} />
    </ApplicationProvider>
  );
}

function useOfficeMap(mapName: string | null) {
  const { catalog, rooms } = useApplication();
  const [map, setMap] = useState<LoadedMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadOfficeMap((name) => loadMap({ storages, catalog, roomService: rooms }, name), mapName).then(
      (loaded) => !cancelled && setMap(loaded),
      (err: Error) => !cancelled && setError(`Could not load the office map: ${err.message}`),
    );
    return () => {
      cancelled = true;
    };
  }, [mapName, catalog, rooms]);
  return { map, error };
}

const playerNames = (s: OfficeState) =>
  Object.values(s.players)
    .map((p) => p.name)
    .filter(Boolean)
    .sort()
    .join(', ');

function usePlayerNames(store: Store | undefined): string {
  const [names, setNames] = useState('');
  useEffect(() => {
    if (!store) {
      return;
    }
    setNames(playerNames(store.getState()));
    return store.subscribe(playerNames, setNames);
  }, [store]);
  return names;
}

function World({ office, me }: { office: Office; me: Identity }) {
  const session = useOfficeSession(office.id, me);
  const { map, error: mapError } = useOfficeMap(office.map_name);
  const cameraMode = useCameraModeCycle();
  const worldFocused = useWorldFocus();
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ local: PersistentLocalState; map: LoadedMap } | null>(null);
  const local = session.type === 'ready' ? session.local : undefined;
  const names = usePlayerNames(local?.store);

  const spawnPoints = useMemo(
    () => map?.spawnPoints.map(({ position: [x, y, z] }) => ({ x, y, z })) ?? [],
    [map],
  );

  useEffect(() => {
    if (!local || !map) {
      return;
    }
    local.actions.setWorldObjects(map.worldObjects);
    const spawn = spawnPoints[0];
    if (spawn) {
      local.actions.setSelfPosition({ ...spawn, y: spawn.y + SPAWN_DROP_HEIGHT }, { x: 0, y: 0, z: 0 }, 0, false);
    }
    // <Scene> broadcasts the world state on mount, so it must not mount before the map is in the store.
    setApplied({ local, map });
  }, [local, map, spawnPoints]);

  const error = session.type === 'error' ? session.message : (mapError ?? saveError);
  const bakedLayoutName = map?.bakedLayoutName;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {session.type === 'ready' && applied?.local === session.local && applied.map === map && (
        <Scene
          store={session.local.store}
          actions={session.local.actions}
          rules={session.local.rules}
          bus={session.local.bus}
          sync={session.office.sync}
          handshake={session.office.handshake}
          bots={session.bots}
          selfId={me.login}
          cameraMode={cameraMode}
          viewConfig={DEFAULT_VIEW_CONFIG}
          worldFocused={worldFocused}
          spawnPoints={spawnPoints}
          bakedLayoutPath={bakedLayoutName && `/api/baked-layouts/${encodeURIComponent(bakedLayoutName)}`}
          bakedLayoutName={bakedLayoutName}
        />
      )}
      <WorldHud cameraMode={cameraMode} realtime={session.type} bakedLayoutName={bakedLayoutName} />
      <FocusIndicator focused={worldFocused} />
      {names && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/55 px-2.5 py-1.5 text-xs text-white">
          {office.name}: {names}
        </div>
      )}
      <div className="pointer-events-none absolute right-3 bottom-3 flex flex-col items-end gap-2">
        {local && <CharacterPicker local={local} onSaveResult={setSaveError} />}
      </div>
      {error && error !== dismissedError && <ErrorBanner message={error} onDismiss={() => setDismissedError(error)} />}
    </div>
  );
}
