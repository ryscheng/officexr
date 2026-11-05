import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Actions, OfficeState, PlayerId, Store } from '@officexr/sdk';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider, ErrorBanner, TopDownPlayView, useStoreSelector, WorldLoadingScreen } from '@officexr/world/top-down';
import { FilesystemLayoutStorage, FilesystemMapStorage, FilesystemRoomStorage } from '@officexr/world/scenes';
import type { Identity, Office } from '@officexr/server/shared';
import { apiUrl, paths } from '../apiOrigin';
import { ChatPanel } from '../hud/ChatPanel';
import { Minimap } from '../hud/Minimap';
import { PresenceList } from '../hud/PresenceList';
import { usePingSender } from '../ping/usePingSender';
import { PipContents } from '../pip/PipContents';
import { PopOutMenuItem } from '../pip/PopOutMenuItem';
import { usePictureInPicture } from '../pip/usePictureInPicture';
import { CallBar } from '../voice/CallBar';
import { JaasMeeting } from '../voice/JaasMeeting';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { OfficeSettingsDialog, OfficeSettingsMenuItem } from './OfficeSettings';
import { PlayView3dBoundary } from './PlayView3dBoundary';
import { PreWorld } from './PreWorld';
import { playerIdFor } from './playerId';
import { RoomMenu, RoomMenuItem } from './RoomMenu';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useJoinCheck } from './useJoinCheck';
import { useLocalPresence } from './useLocalPresence';
import { useOfficeSession, type OfficeSession } from './useOfficeSession';
import { useShortcutsHotkey } from './useShortcutsHotkey';
import { detectGpu, initialViewMode, storedViewMode } from './viewMode';
import { ViewModeMenuItem } from './ViewModeMenuItem';
import { DEFAULT_MAP, withDefaultMap } from './withDefaultMap';

const PlayView3d = lazy(() => import('./PlayView3d'));

const storages = {
  maps: withDefaultMap(new FilesystemMapStorage({ basePath: apiUrl(paths.maps) })),
  rooms: new FilesystemRoomStorage({ basePath: apiUrl(paths.rooms) }),
  layouts: new FilesystemLayoutStorage({ basePath: apiUrl(paths.layouts) }),
};

export function OfficeWorld(props: { office: Office; me: Identity }) {
  const api = useMemo(() => createDefaultApi({ apiPath: apiUrl(paths.worldObjectKinds) }), []);
  return (
    <ApplicationProvider api={api}>
      <World {...props} />
    </ApplicationProvider>
  );
}

type ReadySession = Extract<OfficeSession, { type: 'ready' }>;

const isReplaced = (s: OfficeState) => s.realtime.status === 'replaced';

const REPLACED_MESSAGE = 'This office was opened in another window. Reload to rejoin here.';

function ReplacedBanner({ store }: { store: Store }) {
  const replaced = useStoreSelector(store, isReplaced);
  return replaced ? <ErrorBanner message={REPLACED_MESSAGE} /> : null;
}

function LocalPresence({ actions, voice }: { actions: Actions; voice: JaasVoiceAdapter | null }) {
  useLocalPresence(actions, voice);
  return null;
}

function World({ office: initialOffice, me }: { office: Office; me: Identity }) {
  const [office, setOffice] = useState(initialOffice);
  const selfId = useMemo(() => playerIdFor(initialOffice, me), [initialOffice, me]);
  const gpu = useMemo(() => detectGpu(), []);
  const viewMode = useMemo(() => initialViewMode(gpu, storedViewMode()), [gpu]);
  const join = useJoinCheck(office.id, me.login);
  const session = useOfficeSession(office.id, me, selfId, join.state === 'go', viewMode);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useShortcutsHotkey(openShortcuts, session.type === 'ready');
  const pip = usePictureInPicture();
  const closePip = pip.close;
  // The window's contents render inside PlayView, so a session that drops would leave it blank.
  useEffect(() => {
    if (session.type !== 'ready') {
      closePip();
    }
  }, [session.type, closePip]);

  const sendPing = useCallback((id: PlayerId) => {
    if (session.type === 'ready') {
      session.office.sync.sendPing(id);
    }
  }, [session]);
  const pinger = usePingSender(sendPing);

  const readyViewProps = (ready: ReadySession) => ({
    store: ready.local.store,
    actions: ready.local.actions,
    rules: ready.local.rules,
    bus: ready.local.bus,
    sync: ready.office.sync,
    handshake: ready.office.handshake,
    selfId: ready.local.selfId,
    mapName: office.map_name ?? DEFAULT_MAP,
    title: office.name,
    storages,
    error: bannerError,
    onDismissError: () => setBannerError(null),
  });
  const menu = (
    <>
      <ViewModeMenuItem mode={viewMode} gpu={gpu} />
      <OfficeSettingsMenuItem office={office} me={me} onSelect={() => setSettingsOpen(true)} />
      <RoomMenuItem onSelect={openShortcuts}>Keyboard shortcuts</RoomMenuItem>
      <PopOutMenuItem pip={pip} />
    </>
  );
  const readyHud = (ready: ReadySession) => (
    <>
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {settingsOpen && (
        <OfficeSettingsDialog office={office} me={me} onSaved={setOffice} onClose={() => setSettingsOpen(false)} />
      )}
      {ready.voice && <JaasMeeting voice={ready.voice} />}
      <ChatPanel store={ready.local.store} actions={ready.local.actions} selfId={ready.local.selfId} />
      {/* The call bar centres while it fits; the people column pushes it aside instead of under it.
          On touch the people column sits above the joystick, so only the joystick's width is reserved. */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 grid grid-cols-[1fr_minmax(0,auto)_1fr] items-end gap-2">
        <div className="pointer-coarse:min-w-28">
          <div className="flex flex-col items-start gap-2 pointer-coarse:absolute pointer-coarse:bottom-37 pointer-coarse:left-0">
            <PresenceList store={ready.local.store} selfId={ready.local.selfId} officeName={office.name} pinger={pinger} />
            <Minimap store={ready.local.store} />
          </div>
        </div>
        {ready.voice && <CallBar store={ready.local.store} voice={ready.voice} />}
      </div>
      {pip.pipWindow && <PipContents pipWindow={pip.pipWindow} store={ready.local.store} voice={ready.voice} />}
    </>
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      {session.type === 'ready' && (
        viewMode === '3d' ? (
          <PlayView3dBoundary>
            <Suspense fallback={<WorldLoadingScreen title={office.name} step="Loading 3D view" />}>
              <PlayView3d viewProps={readyViewProps(session)} local={session.local} menu={menu} onError={setBannerError}>
                {readyHud(session)}
              </PlayView3d>
            </Suspense>
          </PlayView3dBoundary>
        ) : (
          <TopDownPlayView {...readyViewProps(session)}>
            <RoomMenu>{menu}</RoomMenu>
            {readyHud(session)}
          </TopDownPlayView>
        )
      )}
      {session.type === 'ready' && (
        <>
          <ReplacedBanner store={session.local.store} />
          <LocalPresence actions={session.local.actions} voice={session.voice} />
        </>
      )}
      <PreWorld title={office.name} join={join.state} session={session} onJoin={join.join} onCancel={join.cancel} />
      {session.type === 'replaced' && <ErrorBanner message={REPLACED_MESSAGE} />}
    </div>
  );
}
