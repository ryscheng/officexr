import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Bus, MissionsClient, OfficeState, PlayerId, Store } from '@officexr/sdk';
import { createDefaultApi } from '@officexr/world/app';
import { SfxProvider } from '@officexr/world/audio';
import { createPlaceMode, type PlacementHost } from '@officexr/world/motion';
import { ApplicationProvider, useStoreSelector, WorldLoadingScreen } from '@officexr/world/top-down';
import { DEFAULT_MAP, FilesystemLayoutStorage, FilesystemMapStorage, FilesystemRoomStorage } from '@officexr/world/scenes';
import type { Identity, Office } from '@officexr/server/shared';
import { API_ORIGIN, apiUrl, paths } from '../apiOrigin';
import { slackPing } from '../integrations/integrationsApi';
import { IntegrationsPane } from '../integrations/IntegrationsPane';
import { useIntegrations } from '../integrations/useIntegrations';
import { DeskAutoSit } from '../desk/DeskAutoSit';
import { DeskHud } from '../desk/DeskHud';
import { usePlaceHotkey } from '../place/usePlaceHotkey';
import { createBrowserSfx } from '../sfx/browserSfx';
import { ClickToPlayPrompt } from '../hud/ClickToPlayPrompt';
import { ConnectionToast } from '../hud/ConnectionToast';
import { HudBanner } from '../hud/HudBanner';
import { HudLayout } from '../hud/HudLayout';
import { OfficeHud } from '../hud/OfficeHud';
import { createHttpMissionsClient } from '../hud/missions/missionsApi';
import { useMissionMarker } from '../hud/missions/useMissionMarker';
import { useMissions } from '../hud/missions/useMissions';
import { RotatePrompt } from '../hud/RotatePrompt';
import { SettingRow } from './SettingsModal';
import { connectPingInbox, PingInbox } from '../ping/pingInbox';
import { usePingReceiver } from '../ping/usePingReceiver';
import { usePingSender } from '../ping/usePingSender';
import { StatusHotkeys } from '../status/StatusHotkeys';
import { PipContents } from '../pip/PipContents';
import { popOutActions } from '../pip/popOutActions';
import { usePictureInPicture } from '../pip/usePictureInPicture';
import { JaasMeeting } from '../voice/JaasMeeting';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { useMuteHotkey } from '../voice/useMuteHotkey';
import { officeSettingsTabs } from './OfficeSettings';
import { PlayView3dBoundary } from './PlayView3dBoundary';
import { PreWorld } from './PreWorld';
import { playerIdFor } from './playerId';
import { KeybindsTab } from './KeybindsTab';
import { NotificationsPane } from './PingSettings';
import { SettingsProvider, useSettings, type SettingsAction, type SettingsTab } from './Settings';
import { useJoinCheck, type JoinCheckControl } from './useJoinCheck';
import { useLocalActivity } from './useLocalActivity';
import { useLocalPresence } from './useLocalPresence';
import { useOfficeSession, type OfficeSession } from './useOfficeSession';
import { useEscapeFallback } from '../hud/useEscapeLayer';
import { useShortcutsHotkey } from './useShortcutsHotkey';
import { AppearancePicker } from '../theme/AppearancePicker';
import { initialViewMode } from './viewMode';
import { ViewModeControl } from './ViewModeControl';
import { withDefaultMap } from './withDefaultMap';

const PlayView3d = lazy(() => import('./PlayView3d'));

const storages = {
  maps: withDefaultMap(new FilesystemMapStorage({ basePath: apiUrl(paths.maps) })),
  rooms: new FilesystemRoomStorage({ basePath: apiUrl(paths.rooms) }),
  layouts: new FilesystemLayoutStorage({ basePath: apiUrl(paths.layouts) }),
};

const httpMissions = createHttpMissionsClient();

export function OfficeWorld(props: { office: Office; me: Identity; hermetic?: HermeticWorld }) {
  const api = useMemo(() => createDefaultApi({ apiPath: apiUrl(paths.worldObjectKinds) }), []);
  const sfx = useMemo(createBrowserSfx, []);
  useEffect(() => () => sfx.dispose(), [sfx]);
  return (
    <ApplicationProvider api={api}>
      <SfxProvider value={sfx}>
        <SettingsProvider>
          {props.hermetic ? (
            <World office={props.office} me={props.me} session={props.hermetic.session} join={HERMETIC_JOIN} missionsClient={props.hermetic.missions ?? httpMissions} />
          ) : (
            <LiveWorld office={props.office} me={props.me} />
          )}
        </SettingsProvider>
      </SfxProvider>
    </ApplicationProvider>
  );
}

type ReadySession = Extract<OfficeSession, { type: 'ready' }>;

/** A session built without the backend: the web office then skips the join check and the realtime join. */
export type HermeticWorld = { session: ReadySession; missions?: MissionsClient };

const HERMETIC_JOIN = { state: 'go' as const, join: () => undefined, cancel: () => undefined };

function LiveWorld(props: { office: Office; me: Identity }) {
  const { office, me } = props;
  const selfId = useMemo(() => playerIdFor(office, me), [office, me]);
  const join = useJoinCheck(office.id, me.login);
  const session = useOfficeSession(office.id, me, selfId, join.state === 'go');
  return <World office={office} me={me} session={session} join={join} missionsClient={httpMissions} />;
}

const isReplaced = (s: OfficeState) => s.realtime.status === 'replaced';

const REPLACED_MESSAGE = 'This office was opened in another window. Reload to rejoin here.';

function ReplacedBanner({ store }: { store: Store }) {
  const replaced = useStoreSelector(store, isReplaced);
  return replaced ? <HudBanner message={REPLACED_MESSAGE} /> : null;
}

function LocalPresence({ local, voice }: { local: ReadySession['local']; voice: JaasVoiceAdapter | null }) {
  const markActive = useLocalActivity(local.store, local.actions, local.selfId);
  useLocalPresence(local.actions, voice, markActive);
  return null;
}

function MuteHotkey({ voice }: { voice: JaasVoiceAdapter }) {
  useMuteHotkey(voice);
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

const calendarReturnTo = () => (API_ORIGIN ? window.location.href : `${window.location.pathname}${window.location.search}`);

function World({ office: initialOffice, me, session, join, missionsClient }: { office: Office; me: Identity; session: OfficeSession; join: JoinCheckControl; missionsClient: MissionsClient }) {
  const [office, setOffice] = useState(initialOffice);
  const viewMode = useMemo(() => initialViewMode(), []);
  const local = session.type === 'ready' ? session.local : null;
  const pingInbox = useMemo(() => new PingInbox(), [local]);
  const placeMode = useMemo(createPlaceMode, []);
  const requestPropOp = session.type === 'ready' ? session.requestPropOp : null;
  const placement = useMemo<PlacementHost | undefined>(
    () => (requestPropOp ? { mode: placeMode, send: requestPropOp } : undefined),
    [placeMode, requestPropOp],
  );
  usePlaceHotkey(placeMode, session.type === 'ready');
  useEffect(() => {
    if (session.type !== 'ready') {
      placeMode.setOpen(false);
    }
  }, [session.type, placeMode]);
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
  const missions = useMissions(missionsClient, initialOffice.id, session.type === 'ready' ? session.subscribeMissionsChanged : undefined);
  const missionMarker = useMissionMarker(local?.store ?? null, missions.current);
  const integrations = useIntegrations();
  const pingFrozen = useCallback((login: string) => void slackPing(initialOffice.id, login), [initialOffice.id]);

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
    onPingFrozen: integrations.status.slack.enabled ? pingFrozen : undefined,
    placement,
    missionMarker,
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
    {
      id: 'appearance',
      label: 'Appearance',
      content: (
        <SettingRow label="Appearance">
          <AppearancePicker />
        </SettingRow>
      ),
    },
    { id: 'keybinds', label: 'Keybinds', content: <KeybindsTab /> },
    { id: 'notifications', label: 'Notifications', content: <NotificationsPane /> },
    ...(integrations.status.calendar.enabled ? [{ id: 'integrations', label: 'Integrations', content: <IntegrationsPane integrations={integrations} returnTo={calendarReturnTo()} /> }] : []),
    ...officeSettingsTabs(office, me, setOffice),
  ];
  const sharedActions: SettingsAction[] = popOutActions(pip);
  const readyHud = (ready: ReadySession) => (
    <>
      <StatusHotkeys store={ready.local.store} actions={ready.local.actions} selfId={ready.local.selfId} />
      {ready.voice && <JaasMeeting voice={ready.voice} />}
      {ready.voice && <MuteHotkey voice={ready.voice} />}
      {!settings.isOpen && <ClickToPlayPrompt />}
      <DeskAutoSit store={ready.local.store} selfId={ready.local.selfId} />
      <OfficeHud
        store={ready.local.store}
        actions={ready.local.actions}
        selfId={ready.local.selfId}
        me={me.login}
        officeName={office.name}
        voice={ready.voice}
        pinger={pinger}
        pingInbox={pingInbox}
        missions={missions}
        placeMode={placeMode}
        onWave={() => ready.office.sync.sendEmote('wave')}
        onOpenSettings={() => openSettings()}
        toasts={
          <>
            <ReplacedBanner store={ready.local.store} />
            {bannerError && <HudBanner message={bannerError} onDismiss={() => setBannerError(null)} />}
            <ConnectionToast store={ready.local.store} />
            <DeskHud store={ready.local.store} requestDeskClaim={ready.requestDeskClaim} />
          </>
        }
      />
      {pip.pipWindow && <PipContents pipWindow={pip.pipWindow} store={ready.local.store} voice={ready.voice} />}
    </>
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      {session.type === 'ready' && (
        <PlayView3dBoundary>
          <Suspense fallback={<WorldLoadingScreen title={office.name} step="Loading the office" />}>
            <PlayView3d
              viewProps={readyViewProps(session)}
              overhead={viewMode === '2d'}
              local={session.local}
              settings={{ tabs: sharedTabs, actions: sharedActions }}
              onError={setBannerError}
            >
              {readyHud(session)}
            </PlayView3d>
          </Suspense>
        </PlayView3dBoundary>
      )}
      {session.type === 'ready' && (
        <>
          <PingReceiver bus={session.local.bus} store={session.local.store} />
          <PingInboxFeed bus={session.local.bus} store={session.local.store} inbox={pingInbox} />
          <LocalPresence local={session.local} voice={session.voice} />
        </>
      )}
      <PreWorld title={office.name} join={join.state} session={session} onJoin={join.join} onCancel={join.cancel} />
      <RotatePrompt />
      {session.type === 'replaced' && <HudLayout topCentre={<HudBanner message={REPLACED_MESSAGE} />} />}
    </div>
  );
}
