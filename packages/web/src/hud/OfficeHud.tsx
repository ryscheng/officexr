import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Map as MapIcon, Menu, MessageSquare, Users } from 'lucide-react';
import { loginOf, PLACEABLE_KINDS, type Actions, type OfficeState, type PlayerId, type Store } from '@officexr/sdk';
import { useCoarsePointer, usePortrait, useStoreSelector } from '@officexr/world/top-down';
import type { PingInbox } from '../ping/pingInbox';
import type { PingSender } from '../ping/usePingSender';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { useVoiceFailed } from '../voice/useVoiceFailed';
import type { PlaceModeStore } from '@officexr/world/motion';
import { BuildActions } from './building/BuildActions';
import { BuildDone } from './building/BuildDone';
import { BuildKeyHints } from './building/BuildKeyHints';
import { BuildPalette } from './building/BuildPalette';
import { BuildStatus } from './building/BuildStatus';
import type { BuildSession } from '../place/buildSession';
import { CallCard } from './CallCard';
import { TextOnlyCall } from './TextOnlyCall';
import { useCallRows } from './CallList';
import { useFold } from './foldPrefs';
import { ChatPanel } from './ChatPanel';
import { ChatTicker, TICKER_MS } from './ChatTicker';
import { FullMap } from './FullMap';
import { HudLayout } from './HudLayout';
import { IdentityCard } from './IdentityCard';
import { InviteSheet } from './InviteSheet';
import { useMapPlan } from './OfficeMinimap';
import { MissionsPanel } from './missions/MissionsPanel';
import { resolvePlace } from './missions/missionRows';
import { useOfficeSpots } from './missions/useOfficeSpots';
import type { MissionsApi } from './missions/useMissions';
import { NearYouButtons, NearYouCard, sameNear, selectNearest } from './NearYouCard';
import { PingInboxHud } from './PingInboxHud';
import { ArrivalBubble } from './ArrivalBubble';
import { PeopleSheet } from './PeopleSheet';
import { SettingsSheet } from './settings/SettingsSheet';
import { useSettings, type SettingsPageId } from '../room/Settings';
import { createLocalMutes, useLocalMutes } from './localMutes';
import { useMutedVoice } from './useMutedVoice';
import { RoundButton } from './RoundButton';
import { Keycap } from './ui/Keycap';
import { AUTO_HIDE_MS, unreadCount, useChatVisibility } from './useChatVisibility';
import { selectSelfMoving, useMovingFade } from './useMovingFade';
import { useHotkey } from './useHotkey';
import { HintLayer } from './hints/HintLayer';
import { HintPlate } from './hints/HintPlate';
import { hintCopy } from './hints/hintCopy';
import { useFirstRunHint } from './hints/useFirstRunHint';
import { useHasText } from './hints/useHasText';
import { useEscapeLayer } from './useEscapeLayer';

const selectChat = (s: OfficeState) => s.chat;
const selectHeadcount = (s: OfficeState) => Object.keys(s.players).length;

export function OfficeHud({
  store,
  actions,
  selfId,
  me,
  officeName,
  voice,
  pinger,
  pingInbox,
  missions,
  placeMode,
  build,
  toasts,
  inviteUrl,
  welcome = false,
  onWelcomeShown,
  onWave,
  settingsPages,
  onSwitchOffice,
  onSignOut,
}: {
  store: Store;
  actions: Actions;
  selfId: PlayerId;
  me: string;
  officeName: string;
  voice: JaasVoiceAdapter | null;
  pinger: PingSender;
  pingInbox: PingInbox;
  missions: MissionsApi;
  placeMode: PlaceModeStore;
  build: BuildSession | null;
  toasts: ReactNode;
  inviteUrl: string;
  welcome?: boolean;
  onWelcomeShown?: () => void;
  onWave: () => void;
  settingsPages: Record<SettingsPageId, ReactNode>;
  onSwitchOffice: () => void;
  onSignOut: () => Promise<void>;
}) {
  const coarse = useCoarsePointer();
  const narrow = usePortrait() && coarse;
  const allChat = useStoreSelector(store, selectChat);
  const [mutes] = useState(createLocalMutes);
  const mutedLogins = useLocalMutes(mutes);
  useMutedVoice(store, voice, mutedLogins);
  const chat = useMemo(() => (mutedLogins.size ? allChat.filter((m) => !mutedLogins.has(loginOf(m.authorId))) : allChat), [allChat, mutedLogins]);
  const headcount = useStoreSelector(store, selectHeadcount);
  const moving = useStoreSelector(store, selectSelfMoving);
  const fadeSecondary = useMovingFade(moving, narrow);
  const building = useSyncExternalStore(placeMode.subscribe, () => placeMode.get().open);
  const chatVisibility = useChatVisibility(chat.length, { peekMs: narrow ? TICKER_MS : AUTO_HIDE_MS });
  const [lastReadId, setLastReadId] = useState<string | null>(chat.at(-1)?.id ?? null);
  const settings = useSettings();
  const menuOpen = settings.isOpen;
  const { close: closeMenu } = settings;
  const [people, setPeople] = useState(false);
  const [invite, setInvite] = useState<'created' | 'invite' | null>(welcome ? 'created' : null);
  const [mapOpen, setMapOpen] = useState(false);
  useEffect(() => {
    if (welcome) {
      onWelcomeShown?.();
    }
  }, [welcome, onWelcomeShown]);
  const missionsFold = useFold('missions', coarse);
  const [cueSlot, setCueSlot] = useState<HTMLElement | null>(null);
  const inCall = useCallRows(store, selfId).state !== 'none';
  const voiceFailed = useVoiceFailed(voice);
  const spots = useOfficeSpots(store);
  useEffect(() => {
    if (!(narrow && inCall)) {
      return;
    }
    document.documentElement.dataset.hudCall = '';
    return () => {
      delete document.documentElement.dataset.hudCall;
    };
  }, [narrow, inCall]);
  const plan = useMapPlan(store);
  const [toastsEl, setToastsEl] = useState<HTMLDivElement | null>(null);
  const toastShowing = useHasText(toastsEl);
  const near = useStoreSelector(store, selectNearest, sameNear);
  const nearName = near ? near.name.trim().split(' ')[0] : null;
  const canBuild = PLACEABLE_KINDS.length > 0;
  const { hint, done: hintDone } = useFirstRunHint({
    coarse,
    canBuild,
    moving,
    headcount,
    nearName,
    menuOpen,
    otherSheetOpen: people || mapOpen || !!invite || (narrow && chatVisibility.mode === 'compose'),
    peopleOpen: people,
    mapOpen,
    building,
    inCall,
    toastShowing: toastShowing || (narrow && chatVisibility.mode === 'peek'),
  });

  const chatShowsLog = chatVisibility.mode === 'compose' || (chatVisibility.mode === 'peek' && !narrow);
  const latestId = chat.at(-1)?.id ?? null;
  useEffect(() => {
    if (chatShowsLog) {
      setLastReadId(latestId);
    }
  }, [chatShowsLog, latestId]);
  useHotkey('m', () => setMapOpen(true), !mapOpen);

  const { setFolded: foldMissions } = missionsFold;
  const missionsOpen = !missionsFold.folded;
  const chatMode = chatVisibility.mode;
  const { hide: hideChat } = chatVisibility;
  useEffect(() => {
    if (narrow && (building || menuOpen || people || invite || chatMode === 'compose')) {
      foldMissions(true);
    }
  }, [narrow, building, menuOpen, people, invite, chatMode, foldMissions]);
  useEffect(() => {
    if (building) {
      setPeople(false);
      setInvite(null);
      hideChat();
    }
  }, [building, hideChat]);
  useEscapeLayer(building, () => placeMode.setOpen(false));
  useEffect(() => {
    if (narrow && missionsOpen) {
      closeMenu();
      setPeople(false);
      setInvite(null);
      hideChat();
    }
  }, [narrow, missionsOpen, hideChat, closeMenu]);

  const unread = chatShowsLog ? 0 : unreadCount(chat, lastReadId, selfId);
  const toggleChat = () => {
    if (chatVisibility.mode === 'compose') {
      chatVisibility.hide();
      return;
    }
    if (narrow) {
      closeMenu();
      setInvite(null);
    }
    if (coarse) {
      setPeople(false);
    }
    chatVisibility.compose();
  };
  const togglePeople = () => {
    setPeople((p) => !p);
    closeMenu();
    setInvite(null);
    if (coarse) {
      hideChat();
    }
  };
  const openMenu = () => {
    if (!menuOpen) {
      setInvite(null);
    }
    if (narrow && !menuOpen) {
      setPeople(false);
      hideChat();
    }
    if (menuOpen) {
      closeMenu();
    } else {
      settings.open();
    }
  };

  const current = missions.current;
  const to = current?.place ? resolvePlace(current.place, spots.areas) : null;
  const route = current && to ? { to, label: current.title, areaId: current.place?.kind === 'room' ? current.place.id : null } : null;

  const missionsPanel = (
    <MissionsPanel missions={missions} me={me} areas={spots.areas} people={spots.people} self={spots.self} compact={coarse} portrait={narrow} collapsed={fadeSecondary} cueSlot={cueSlot} />
  );
  const chatPanel = (
    <ChatPanel
      store={store}
      actions={actions}
      selfId={selfId}
      visibility={chatVisibility}
      portrait={narrow}
      unread={unread}
      hiddenLogins={mutedLogins}
      onMissionCommand={async (title) => (await missions.create({ title })) !== null}
    />
  );
  const mapButton = (
    <RoundButton tone="glass" aria-label="Open map" aria-haspopup="dialog" data-map-toggle onClick={() => setMapOpen(true)} className="shadow-hud-panel">
      <MapIcon aria-hidden className="size-5" />
      <span aria-hidden className="absolute -right-1 -bottom-1 pointer-coarse:hidden">
        <Keycap>M</Keycap>
      </span>
    </RoundButton>
  );
  const chatButton = (
    <RoundButton tone="glass" aria-label={unread ? `Chat, ${unread} new` : 'Chat'} data-chat-toggle onClick={toggleChat}>
      <MessageSquare aria-hidden className="size-5" />
      {unread > 0 && (
        <span aria-hidden className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </RoundButton>
  );
  const peopleButton = (
    <RoundButton tone="glass" aria-label={`People here, ${headcount}`} aria-expanded={people} data-people-toggle onClick={togglePeople}>
      <Users aria-hidden className="size-5" />
      <span aria-hidden className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-hud-accent-fill px-1 text-xs font-bold text-hud-on-accent">
        {headcount}
      </span>
    </RoundButton>
  );
  const menuButton = (
    <RoundButton tone="glass" aria-label="Office menu" aria-expanded={menuOpen} onClick={openMenu}>
      <Menu aria-hidden className="size-5" />
    </RoundButton>
  );
  const call =
    inCall && (!voice || voiceFailed) ? (
      <TextOnlyCall voice={voice} />
    ) : (
      voice && <CallCard store={store} selfId={selfId} voice={voice} pinger={pinger} compact={coarse} />
    );
  const menu = menuOpen && (
    <SettingsSheet
      store={store}
      portrait={narrow}
      page={settings.page}
      pages={settingsPages}
      canBuild={canBuild}
      buildHint={hint === 'build' && <HintPlate name="build" text={hintCopy('build', coarse, null)} arrow={{ side: 'up', offset: 28 }} visible className="relative ml-4 self-start" />}
      onPage={settings.openPage}
      onBack={settings.back}
      onClose={closeMenu}
      onInvite={() => {
        closeMenu();
        setPeople(false);
        setInvite('invite');
        if (narrow) {
          hideChat();
        }
      }}
      onBuild={() => {
        closeMenu();
        placeMode.setOpen(true);
      }}
      onSwitchOffice={onSwitchOffice}
      onSignOut={onSignOut}
    />
  );
  const peopleSheet = people && (
    <PeopleSheet
      store={store}
      selfId={selfId}
      officeName={officeName}
      pinger={pinger}
      mutes={mutes}
      portrait={narrow}
      onWave={onWave}
      onInvite={() => {
        setPeople(false);
        setInvite('invite');
      }}
      onClose={() => setPeople(false)}
    />
  );
  const inviteSheet = invite && (
    <InviteSheet url={inviteUrl} officeName={officeName} created={invite === 'created'} portrait={narrow} coarse={coarse} onClose={() => setInvite(null)} />
  );

  return (
    <>
      <HudLayout
        topLeft={
          coarse || building ? undefined : (
            <>
              <IdentityCard
                store={store}
                officeName={officeName}
                unread={unread}
                chatOpen={chatVisibility.mode !== 'hidden'}
                menuOpen={menuOpen}
                headcount={headcount}
                peopleOpen={people}
                onPeople={togglePeople}
                onChat={toggleChat}
                onMenu={openMenu}
              />
              {chatPanel}
            </>
          )
        }
        topCentre={
          narrow ? (
            <div className="mt-(--hud-portrait-bar-row) flex flex-col items-center gap-2">
              <div className="min-h-12">{!building && missionsPanel}</div>
              {inCall && <div aria-hidden className="h-[calc(var(--hud-portrait-call-row)-0.5rem)]" />}
              <div ref={setToastsEl} className="contents">
                <ArrivalBubble store={store} selfId={selfId} toast />
                {toasts}
                <div ref={setCueSlot} />
                {building && build && <BuildStatus mode={placeMode} build={build} store={store} />}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 pointer-coarse:mt-16">
              <div ref={setToastsEl} className="contents">
                <ArrivalBubble store={store} selfId={selfId} toast />
                {toasts}
                <div ref={setCueSlot} />
                {building && build && <BuildStatus mode={placeMode} build={build} store={store} />}
              </div>
            </div>
          )
        }
        topRight={
          <>
            <div className="flex items-start gap-2">
              {coarse && !narrow && !building && chatButton}
              {coarse && !narrow && !building && menuButton}
              {!narrow && coarse && call}
              <div className={`flex items-start gap-2 transition-opacity ${fadeSecondary && !building ? 'opacity-40' : ''}`}>
                {narrow && !building && menuButton}
                <PingInboxHud inbox={pingInbox} store={store} />
                {building ? <BuildDone mode={placeMode} /> : mapButton}
              </div>
            </div>
            {narrow ? inCall && <div className="mt-(--hud-portrait-chip-row)">{call}</div> : !coarse && call}
          </>
        }
        rightEdge={
          <>
            {coarse && !building && chatPanel}
            {menu}
            {peopleSheet}
            {inviteSheet}
          </>
        }
        bottomCentre={building && <BuildPalette mode={placeMode} layout={narrow ? 'portrait' : coarse ? 'landscape' : 'desktop'} />}
        bottomLeft={building ? !coarse && <BuildKeyHints /> : narrow || (coarse && (invite || people || menuOpen)) ? undefined : missionsPanel}
        bottomRight={
          building ? (
            <BuildActions mode={placeMode} store={store} />
          ) : (
            (coarse && (menuOpen || people || invite)) || (!coarse && (people || menuOpen)) ? undefined : narrow ? (
            <>
              {chatVisibility.mode === 'peek' && <ChatTicker key={latestId} store={store} hiddenLogins={mutedLogins} onOpen={chatVisibility.compose} />}
              {!building && <NearYouButtons store={store} onWave={onWave} onAct={() => hintDone('wave')} />}
              <div className="flex items-center gap-2">
                {peopleButton}
                {chatButton}
              </div>
            </>
          ) : coarse ? (
            <>
              <NearYouButtons store={store} onWave={onWave} onAct={() => hintDone('wave')} />
              {!building && peopleButton}
            </>
          ) : (
            <NearYouCard store={store} onWave={onWave} onAct={() => hintDone('wave')} />
          ))
        }
      />
      <HintLayer hint={hint === 'build' ? null : hint} coarse={coarse} portrait={narrow} nearName={nearName} />
      {mapOpen && <FullMap store={store} officeName={officeName} areas={spots.areas} plan={plan} route={route} onClose={() => setMapOpen(false)} />}
    </>
  );
}
