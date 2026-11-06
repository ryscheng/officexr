import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Actions, Bus, OfficeState, PlayerId, Store } from '@officexr/sdk';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider, TopDownPlayView, useStoreSelector, WorldLoadingScreen } from '@officexr/world/top-down';
import { DEFAULT_MAP, FilesystemLayoutStorage, FilesystemMapStorage, FilesystemRoomStorage } from '@officexr/world/scenes';
import type { Identity, Office } from '@officexr/server/shared';
import { apiUrl, paths } from '../apiOrigin';
import { DeskAutoSit } from '../desk/DeskAutoSit';
import { DeskHud } from '../desk/DeskHud';
import { ChatPanel } from '../hud/ChatPanel';
import { PingInboxHud } from '../hud/PingInboxHud';
import { ClickToPlayPrompt } from '../hud/ClickToPlayPrompt';
import { Minimap } from '../hud/Minimap';
import { ConnectionToast } from '../hud/ConnectionToast';
import { HudBanner } from '../hud/HudBanner';
import { HudLayout } from '../hud/HudLayout';
import { OfficeNamePlate } from '../hud/OfficeNamePlate';
import { PresenceList } from '../hud/PresenceList';
import { connectPingInbox, PingInbox } from '../ping/pingInbox';
import { usePingReceiver } from '../ping/usePingReceiver';
import { usePingSender } from '../ping/usePingSender';
import { PipContents } from '../pip/PipContents';
import { popOutActions } from '../pip/popOutActions';
import { usePictureInPicture } from '../pip/usePictureInPicture';
import { CallBar } from '../voice/CallBar';
import { JaasMeeting } from '../voice/JaasMeeting';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { officeSettingsTabs } from './OfficeSettings';
import { PlayView3dBoundary } from './PlayView3dBoundary';
import { PreWorld } from './PreWorld';
import { playerIdFor } from './playerId';
import { KeybindsTab } from './KeybindsTab';
import { NotificationsPane } from './PingSettings';
import { SettingsProvider, useSettings, type SettingsAction, type SettingsTab } from './Settings';
import { SettingRow, SettingsButton, SettingsModal } from './SettingsModal';
import { useJoinCheck } from './useJoinCheck';
import { useLocalPresence } from './useLocalPresence';
import { useOfficeSession, type OfficeSession } from './useOfficeSession';
import { useEscapeFallback } from '../hud/useEscapeLayer';
import { useShortcutsHotkey } from './useShortcutsHotkey';
import { initialViewMode } from './viewMode';
import { ViewModeControl } from './ViewModeControl';
import { withDefaultMap } from './withDefaultMap';

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
      <SettingsProvider>
        <World {...props} />
      </SettingsProvider>
    </ApplicationProvider>
  );
}

type ReadySession = Extract<OfficeSession, { type: 'ready' }>;

const isReplaced = (s: OfficeState) => s.realtime.status === 'replaced';

const REPLACED_MESSAGE = 'This office was opened in another window. Reload to rejoin here.';

function ReplacedBanner({ store }: { store: Store }) {
  const replaced = useStoreSelector(store, isReplaced);
  return replaced ? <HudBanner message={REPLACED_MESSAGE} /> : null;
}

function LocalPresence({ actions, voice }: { actions: Actions; voice: JaasVoiceAdapter | null }) {
  useLocalPresence(actions, voice);
  return null;
}

function PingReceiver({ bus, store }: { bus: Bus; store: Store }) {
  usePingReceiver(bus, store);
  return null;
}

function PingInboxFeed({ bus, store, inbox }: { bus: Bus; store: Store; inbox: PingInbox }) {
  useEffect(() => connectPingInbox(bus, store, inbox), [bus, store, inbox]);
  return null;
}

function World({ office: initialOffice, me }: { office: Office; me: Identity }) {
  const [office, setOffice] = useState(initialOffice);
  const selfId = useMemo(() => playerIdFor(initialOffice, me), [initialOffice, me]);
  const viewMode = useMemo(() => initialViewMode(), []);
  const join = useJoinCheck(office.id, me.login);
  const session = useOfficeSession(office.id, me, selfId, join.state === 'go', viewMode);
  const local = session.type === 'ready' ? session.local : null;
  const pingInbox = useMemo(() => new PingInbox(), [local]);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const settings = useSettings();
  const { open: openSettings, close: closeSettings } = settings;
  const openKeybinds = useCallback(() => openSettings('keybinds'), [openSettings]);
  useShortcutsHotkey(openKeybinds, session.type === 'ready');
  useEscapeFallback(openSettings, session.type === 'ready');
  const pip = usePictureInPicture();
  const closePip = pip.close;
  // The window's contents render inside PlayView, so a session that drops would leave it blank.
  useEffect(() => {
    if (session.type !== 'ready') {
      closePip();
    }
  }, [session.type, closePip]);
  // Settings render inside PlayView, so they would otherwise reappear open after a rejoin.
  useEffect(() => {
    if (session.type !== 'ready') {
      closeSettings();
    }
  }, [session.type, closeSettings]);

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
    onPingPlayer: pinger.ping,
  });
  const sharedTabs: SettingsTab[] = [
    {
      id: 'controls',
      label: 'Controls',
      content: (
        <SettingRow label="View">
          <ViewModeControl mode={viewMode} />
        </SettingRow>
      ),
    },
    { id: 'keybinds', label: 'Keybinds', content: <KeybindsTab /> },
    { id: 'notifications', label: 'Notifications', content: <NotificationsPane /> },
    ...officeSettingsTabs(office, me, setOffice),
  ];
  const sharedActions: SettingsAction[] = popOutActions(pip);
  const readyHud = (ready: ReadySession) => (
    <>
      {ready.voice && <JaasMeeting voice={ready.voice} />}
      {!settings.isOpen && <ClickToPlayPrompt />}
      <DeskHud store={ready.local.store} requestDeskClaim={ready.requestDeskClaim} />
      {viewMode === '3d' && <DeskAutoSit store={ready.local.store} selfId={ready.local.selfId} />}
      <HudLayout
        topCentre={
          <>
            <ReplacedBanner store={ready.local.store} />
            {bannerError && <HudBanner message={bannerError} onDismiss={() => setBannerError(null)} />}
            <ConnectionToast store={ready.local.store} />
          </>
        }
        topLeft={<OfficeNamePlate store={ready.local.store} name={office.name} />}
        topRight={
          <>
            <div className="flex items-start gap-2">
              <PingInboxHud inbox={pingInbox} store={ready.local.store} />
              <SettingsButton />
            </div>
            <Minimap store={ready.local.store} />
          </>
        }
        rightEdge={
          <PresenceList
            store={ready.local.store}
            selfId={ready.local.selfId}
            officeName={office.name}
            pinger={pinger}
          />
        }
        bottomCentre={
          ready.voice && (
            <CallBar store={ready.local.store} selfId={ready.local.selfId} voice={ready.voice} pinger={pinger} />
          )
        }
        bottomLeft={<ChatPanel store={ready.local.store} actions={ready.local.actions} selfId={ready.local.selfId} />}
      />
      {pip.pipWindow && <PipContents pipWindow={pip.pipWindow} store={ready.local.store} voice={ready.voice} />}
    </>
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      {session.type === 'ready' && (
        viewMode === '3d' ? (
          <PlayView3dBoundary>
            <Suspense fallback={<WorldLoadingScreen title={office.name} step="Loading 3D view" />}>
              <PlayView3d
                viewProps={readyViewProps(session)}
                local={session.local}
                settings={{ tabs: sharedTabs, actions: sharedActions }}
                onError={setBannerError}
              >
                {readyHud(session)}
              </PlayView3d>
            </Suspense>
          </PlayView3dBoundary>
        ) : (
          <TopDownPlayView {...readyViewProps(session)}>
            <SettingsModal title={office.name} tabs={sharedTabs} actions={sharedActions} />
            {readyHud(session)}
          </TopDownPlayView>
        )
      )}
      {session.type === 'ready' && (
        <>
          <PingReceiver bus={session.local.bus} store={session.local.store} />
          <PingInboxFeed bus={session.local.bus} store={session.local.store} inbox={pingInbox} />
          <LocalPresence actions={session.local.actions} voice={session.voice} />
        </>
      )}
      <PreWorld title={office.name} join={join.state} session={session} onJoin={join.join} onCancel={join.cancel} />
      {session.type === 'replaced' && <HudLayout topCentre={<HudBanner message={REPLACED_MESSAGE} />} />}
    </div>
  );
}
