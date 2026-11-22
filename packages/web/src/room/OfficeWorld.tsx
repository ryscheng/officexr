import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Bus, MissionsClient, OfficeState, PlayerId, Store } from '@officexr/sdk';
import { createDefaultApi } from '@officexr/world/app';
import { SfxProvider } from '@officexr/world/audio';
import { createPlaceMode } from '@officexr/world/motion';
import { ApplicationProvider, useCoarsePointer, useStoreSelector } from '@officexr/world/top-down';
import { DEFAULT_MAP, FilesystemLayoutStorage, FilesystemMapStorage, FilesystemRoomStorage } from '@officexr/world/scenes';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Identity, Office } from '@officexr/server/shared';
import { API_ORIGIN, apiUrl, paths } from '../apiOrigin';
import { hasInviteFlag, roomPath, withoutInviteFlag } from '../inviteFlag';
import { signOut } from '../signOut';
import { slackPing } from '../integrations/integrationsApi';
import { IntegrationsPane } from '../integrations/IntegrationsPane';
import { useIntegrations } from '../integrations/useIntegrations';
import { DeskAutoSit } from '../desk/DeskAutoSit';
import { DeskHud } from '../desk/DeskHud';
import { createBuildSession } from '../place/buildSession';
import { usePlaceHotkey } from '../place/usePlaceHotkey';
import { createBrowserSfx } from '../sfx/browserSfx';
import { ConnectionBanner } from '../hud/ConnectionBanner';
import { HudBanner } from '../hud/HudBanner';
import { OfficeHud } from '../hud/OfficeHud';
import { createHttpMissionsClient } from '../hud/missions/missionsApi';
import { useMissionMarker } from '../hud/missions/useMissionMarker';
import { useMissions } from '../hud/missions/useMissions';
import { SectionLabel, SettingRow, SettingsActionButton } from '../hud/settings/parts';
import { HelpPage } from '../hud/settings/HelpPage';
import { OfficePage } from '../hud/settings/OfficePage';
import { StatusSection } from '../hud/settings/StatusSection';
import { connectPingInbox, PingInbox } from '../ping/pingInbox';
import { connectSocialToasts, SocialToastQueue } from '../ping/socialToasts';
import { usePingReceiver } from '../ping/usePingReceiver';
import { INVITE_COOLDOWN_MS, usePingSender } from '../ping/usePingSender';
import { performanceNow } from '../hud/useNow';
import { StatusHotkeys } from '../status/StatusHotkeys';
import { PipContents } from '../pip/PipContents';
import { popOutActions } from '../pip/popOutActions';
import { usePictureInPicture } from '../pip/usePictureInPicture';
import { JaasMeeting } from '../voice/JaasMeeting';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { useMuteHotkey } from '../voice/useMuteHotkey';
import { Blocked } from '../page/Blocked';
import { PlayView3dBoundary } from './PlayView3dBoundary';
import { EnteringOffice, enteringScreen } from './EnteringOffice';
import { PreWorld } from './PreWorld';
import { playerIdFor } from './playerId';
import { NotificationsPane } from './PingSettings';
import { SettingsProvider, useSettings, type SettingsAction, type SettingsPageId } from './Settings';
import type { PlayViewSettings } from './PlayView3d';
import { useJoinCheck, type JoinCheckControl } from './useJoinCheck';
import { useLocalActivity } from './useLocalActivity';
import { useLocalPresence } from './useLocalPresence';
import { useOfficeSession, type OfficeSession } from './useOfficeSession';
import { usePreloadAvatars } from './usePreloadAvatars';
import { useEscapeFallback } from '../hud/useEscapeLayer';
import { useShortcutsHotkey } from './useShortcutsHotkey';
import { AppearancePicker } from '../theme/AppearancePicker';
import { initialViewMode } from './viewMode';
import { RefocusOnMovementKey } from './useRefocusOnMovementKey';
import { withDefaultMap } from './withDefaultMap';
import { BlockedPeople } from '../social/BlockedPeople';
import { SocialProvider } from '../social/SocialProvider';

const loadPlayView3d = () => import('./PlayView3d');
const PlayView3d = lazy(loadPlayView3d);

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
            <World office={props.office} me={props.me} session={props.hermetic.session} join={HERMETIC_JOIN} missionsClient={props.hermetic.missions ?? httpMissions} stallMs={props.hermetic.stallMs} />
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
export type HermeticWorld = { session: ReadySession; missions?: MissionsClient; stallMs?: number };

const HERMETIC_JOIN = { state: 'go' as const, join: () => undefined };

function LiveWorld(props: { office: Office; me: Identity }) {
  const { office, me } = props;
  const selfId = useMemo(() => playerIdFor(office, me), [office, me]);
  const join = useJoinCheck(office.id, me.login);
  const [attempt, setAttempt] = useState(0);
  const session = useOfficeSession(office.id, me, selfId, join.state === 'go', undefined, attempt);
  const rejoin = useCallback(() => setAttempt((n) => n + 1), []);
  return <World office={office} me={me} session={session} join={join} missionsClient={httpMissions} onRejoin={rejoin} />;
}

const isReplaced = (s: OfficeState) => s.realtime.status === 'replaced';

function ReplacedCover({ store, onRejoin }: { store: Store; onRejoin: () => void }) {
  const replaced = useStoreSelector(store, isReplaced);
  return replaced ? <Blocked surface="dim" variant="otherWindow" details="Session replaced" onPrimary={onRejoin} /> : null;
}

const reloadPage = () => window.location.reload();

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

function SocialToastFeed({ bus, store, queue }: { bus: Bus; store: Store; queue: SocialToastQueue }) {
  useEffect(() => connectSocialToasts(bus, store, queue), [bus, store, queue]);
  return null;
}

const calendarReturnTo = () => (API_ORIGIN ? window.location.href : `${window.location.pathname}${window.location.search}`);

function World({ office: initialOffice, me, session, join, missionsClient, onRejoin = reloadPage, stallMs }: { office: Office; me: Identity; session: OfficeSession; join: JoinCheckControl; missionsClient: MissionsClient; onRejoin?: () => void; stallMs?: number }) {
  const [office, setOffice] = useState(initialOffice);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const leaveOffice = useCallback(() => navigate('/'), [navigate]);
  const welcome = hasInviteFlag(search);
  const welcomeShown = useCallback(() => navigate({ pathname, search: withoutInviteFlag(search) }, { replace: true }), [navigate, pathname, search]);
  const viewMode = useMemo(() => initialViewMode(), []);
  const local = session.type === 'ready' ? session.local : null;
  useEffect(() => {
    loadPlayView3d().catch(() => undefined);
  }, []);
  usePreloadAvatars(local?.store ?? null, local?.selfId ?? null);
  const pingInbox = useMemo(() => new PingInbox(), [local]);
  const socialToasts = useMemo(() => new SocialToastQueue(), [local]);
  const placeMode = useMemo(createPlaceMode, []);
  const requestPropOp = session.type === 'ready' ? session.requestPropOp : null;
  const localStore = local?.store ?? null;
  const build = useMemo(
    () => (requestPropOp && localStore ? createBuildSession(placeMode, requestPropOp, () => localStore.getState().placedProps) : null),
    [placeMode, requestPropOp, localStore],
  );
  const placement = build?.host;
  usePlaceHotkey(placeMode, session.type === 'ready');
  useEffect(() => {
    if (session.type !== 'ready') {
      placeMode.setOpen(false);
    }
  }, [session.type, placeMode]);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const settings = useSettings();
  const { open: openSettings, close: closeSettings } = settings;
  const coarse = useCoarsePointer();
  const openHelp = useCallback(() => openSettings('help'), [openSettings]);
  useShortcutsHotkey(openHelp, session.type === 'ready');
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
  const sendInvite = useCallback((id: PlayerId) => {
    if (session.type === 'ready') {
      session.office.sync.sendPing(id, 'invite');
    }
  }, [session]);
  const inviter = usePingSender(sendInvite, performanceNow, INVITE_COOLDOWN_MS);
  const sendWave = useCallback((id: PlayerId) => {
    if (session.type === 'ready') {
      session.office.sync.sendPing(id, 'wave');
    }
  }, [session]);
  const waver = usePingSender(sendWave);
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
    loading: enteringScreen(4, office.name),
    renderLoadError: (message: string) => <Blocked surface="cover" variant="crashed" details={message} onPrimary={reloadPage} />,
    storages,
    onPingPlayer: pinger.ping,
    onPingFrozen: integrations.status.slack.enabled ? pingFrozen : undefined,
    placement,
    missionMarker,
  });
  const popOut: SettingsAction[] = popOutActions(pip);
  const settingsPages = (ready: ReadySession, extras: PlayViewSettings): Record<SettingsPageId, ReactNode> => ({
    profile: (
      <>
        {extras.look}
        <StatusSection store={ready.local.store} actions={ready.local.actions} selfId={ready.local.selfId} />
        <BlockedPeople />
      </>
    ),
    controls: (
      <>
        {extras.controls}
        <SettingRow label="Appearance">
          <AppearancePicker />
        </SettingRow>
        {!coarse && (
          <SettingsActionButton onClick={openHelp}>Keyboard shortcuts</SettingsActionButton>
        )}
        {popOut.map((action) => (
          <Fragment key={action.id}>{action.render(closeSettings)}</Fragment>
        ))}
        <SectionLabel>VR and motion look</SectionLabel>
        {extras.motion}
        {extras.actions.map((action) => (
          <Fragment key={action.id}>{action.render(closeSettings)}</Fragment>
        ))}
      </>
    ),
    alerts: (
      <>
        <NotificationsPane />
        {integrations.status.calendar.enabled && <IntegrationsPane integrations={integrations} returnTo={calendarReturnTo()} />}
      </>
    ),
    office: <OfficePage office={office} coarse={coarse} onSaved={setOffice} />,
    help: <HelpPage coarse={coarse} />,
  });
  const readyHud = (ready: ReadySession, extras: PlayViewSettings) => (
    <>
      <StatusHotkeys store={ready.local.store} actions={ready.local.actions} selfId={ready.local.selfId} />
      {ready.voice && <JaasMeeting voice={ready.voice} />}
      {ready.voice && <MuteHotkey voice={ready.voice} />}
      <RefocusOnMovementKey />
      <DeskAutoSit store={ready.local.store} selfId={ready.local.selfId} />
      <OfficeHud
        store={ready.local.store}
        actions={ready.local.actions}
        selfId={ready.local.selfId}
        me={me.login}
        officeName={office.name}
        voice={ready.voice}
        pinger={pinger}
        inviter={inviter}
        waver={waver}
        pingInbox={pingInbox}
        socialToasts={socialToasts}
        missions={missions}
        placeMode={placeMode}
        build={build}
        onWave={() => ready.office.sync.sendEmote('wave')}
        inviteUrl={`${window.location.origin}${roomPath(office.id)}`}
        welcome={welcome}
        onWelcomeShown={welcomeShown}
        settingsPages={settingsPages(ready, extras)}
        onSwitchOffice={leaveOffice}
        onSignOut={signOut}
        joystickFloats={extras.joystickFloats}
        toasts={
          <>
            {bannerError && <HudBanner message={bannerError} onDismiss={() => setBannerError(null)} />}
            <ConnectionBanner store={ready.local.store} onRetry={onRejoin} onLeave={leaveOffice} stallMs={stallMs} />
            <DeskHud store={ready.local.store} requestDeskClaim={ready.requestDeskClaim} />
          </>
        }
      />
      {pip.pipWindow && <PipContents pipWindow={pip.pipWindow} store={ready.local.store} voice={ready.voice} />}
    </>
  );

  const world = (
    <div className="relative h-full w-full overflow-hidden">
      {session.type === 'ready' && (
        <PlayView3dBoundary>
          <Suspense fallback={<EnteringOffice stage={4} name={office.name} />}>
            <PlayView3d
              viewProps={readyViewProps(session)}
              overhead={viewMode === '2d'}
              local={session.local}
              onError={setBannerError}
            >
              {(extras) => readyHud(session, extras)}
            </PlayView3d>
          </Suspense>
        </PlayView3dBoundary>
      )}
      {session.type === 'ready' && (
        <>
          <PingReceiver bus={session.local.bus} store={session.local.store} />
          <PingInboxFeed bus={session.local.bus} store={session.local.store} inbox={pingInbox} />
          <SocialToastFeed bus={session.local.bus} store={session.local.store} queue={socialToasts} />
          <LocalPresence local={session.local} voice={session.voice} />
        </>
      )}
      <PreWorld title={office.name} join={join.state} session={session} onJoin={join.join} onRetry={onRejoin} />
      {session.type === 'ready' && <ReplacedCover store={session.local.store} onRejoin={onRejoin} />}
    </div>
  );
  return (
    <SocialProvider officeId={office.id} officeName={office.name}>
      {world}
    </SocialProvider>
  );
}
