import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowLeftRight, Map as MapIcon, Menu, MessageSquare, Settings, UserPlus, Users, LogOut } from 'lucide-react';
import { loginOf, type Actions, type OfficeState, type PlayerId, type Store } from '@officexr/sdk';
import { useCoarsePointer, usePortrait, useStoreSelector } from '@officexr/world/top-down';
import type { PingInbox } from '../ping/pingInbox';
import type { PingSender } from '../ping/usePingSender';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import type { PlaceModeStore } from '@officexr/world/motion';
import { BuildIndicator } from './BuildIndicator';
import { CallCard } from './CallCard';
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
import { NearYouButtons, NearYouCard } from './NearYouCard';
import { PingInboxHud } from './PingInboxHud';
import { ArrivalBubble } from './ArrivalBubble';
import { PeopleSheet } from './PeopleSheet';
import { createLocalMutes, useLocalMutes } from './localMutes';
import { useMutedVoice } from './useMutedVoice';
import { RoundButton } from './RoundButton';
import { Keycap } from './ui/Keycap';
import { InlineAlert } from './ui/InlineAlert';
import { Panel } from './ui/Panel';
import { PortraitSheet } from './ui/PortraitSheet';
import { AUTO_HIDE_MS, unreadCount, useChatVisibility } from './useChatVisibility';
import { selectSelfMoving, useMovingFade } from './useMovingFade';
import { useEscapeLayer } from './useEscapeLayer';
import { useHotkey } from './useHotkey';

const selectChat = (s: OfficeState) => s.chat;
const selectHeadcount = (s: OfficeState) => Object.keys(s.players).length;

type MenuActions = { onInvite: () => void; onPeople: () => void; onSettings: () => void; onSwitchOffice: () => void; onSignOut: () => Promise<void> };

export function MenuPopover({ portrait, onClose, onInvite, onPeople, onSettings, onSwitchOffice, onSignOut }: MenuActions & { portrait: boolean; onClose: () => void }) {
  useEscapeLayer(true, onClose);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const item = 'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold hover:bg-hud-hover pointer-coarse:min-h-12';
  const items = (
    <>
      <button type="button" role="menuitem" className={item} onClick={onInvite}>
        <UserPlus aria-hidden className="size-4" />
        Invite people
      </button>
      <button type="button" role="menuitem" className={item} onClick={onPeople}>
        <Users aria-hidden className="size-4" />
        People here
      </button>
      <button type="button" role="menuitem" className={item} onClick={onSettings}>
        <Settings aria-hidden className="size-4" />
        Settings
      </button>
      <button type="button" role="menuitem" className={item} onClick={onSwitchOffice}>
        <ArrowLeftRight aria-hidden className="size-4" />
        Switch office
      </button>
      <button
        type="button"
        role="menuitem"
        className={`${item} text-hud-rose-text`}
        onClick={() => {
          setSignOutError(null);
          onSignOut().catch((err: Error) => setSignOutError(err.message));
        }}
      >
        <LogOut aria-hidden className="size-4" />
        Sign out
      </button>
      {signOutError && <InlineAlert className="mx-1 text-xs">{signOutError}</InlineAlert>}
    </>
  );
  if (portrait) {
    return (
      <PortraitSheet title="Menu" label="Menu" closeLabel="Close menu" onClose={onClose}>
        <div role="menu" aria-label="Office menu" className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain">
          {items}
        </div>
      </PortraitSheet>
    );
  }
  return (
    <Panel role="menu" aria-label="Office menu" className="pointer-events-auto flex w-60 flex-col p-1.5">
      {items}
    </Panel>
  );
}

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
  toasts,
  inviteUrl,
  welcome = false,
  onWelcomeShown,
  onWave,
  onOpenSettings,
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
  toasts: ReactNode;
  inviteUrl: string;
  welcome?: boolean;
  onWelcomeShown?: () => void;
  onWave: () => void;
  onOpenSettings: () => void;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [people, setPeople] = useState(false);
  const [invite, setInvite] = useState<'created' | 'invite' | null>(welcome ? 'created' : null);
  const [mapOpen, setMapOpen] = useState(false);
  useEffect(() => {
    if (welcome) {
      onWelcomeShown?.();
    }
  }, [welcome, onWelcomeShown]);
  const missionsFold = useFold('missions', coarse);
  const inCall = useCallRows(store, selfId).state !== 'none';
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
    if (narrow && (menuOpen || people || invite || chatMode === 'compose')) {
      foldMissions(true);
    }
  }, [narrow, menuOpen, people, invite, chatMode, foldMissions]);
  useEffect(() => {
    if (narrow && building) {
      setPeople(false);
    }
  }, [narrow, building]);
  useEffect(() => {
    if (narrow && missionsOpen) {
      setMenuOpen(false);
      setPeople(false);
      setInvite(null);
      hideChat();
    }
  }, [narrow, missionsOpen, hideChat]);

  const unread = chatShowsLog ? 0 : unreadCount(chat, lastReadId, selfId);
  const toggleChat = () => {
    if (chatVisibility.mode === 'compose') {
      chatVisibility.hide();
      return;
    }
    if (narrow) {
      setMenuOpen(false);
      setInvite(null);
    }
    if (coarse) {
      setPeople(false);
    }
    chatVisibility.compose();
  };
  const togglePeople = () => {
    setPeople((p) => !p);
    setMenuOpen(false);
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
    setMenuOpen((o) => !o);
  };

  const current = missions.current;
  const to = current?.place ? resolvePlace(current.place, spots.areas) : null;
  const route = current && to ? { to, label: current.title, areaId: current.place?.kind === 'room' ? current.place.id : null } : null;

  const missionsPanel = (
    <MissionsPanel missions={missions} me={me} areas={spots.areas} people={spots.people} self={spots.self} compact={coarse} portrait={narrow} collapsed={fadeSecondary} />
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
    <RoundButton tone="glass" aria-label="Open map" aria-haspopup="dialog" onClick={() => setMapOpen(true)} className="shadow-hud-panel">
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
  const call = voice && <CallCard store={store} selfId={selfId} voice={voice} pinger={pinger} compact={coarse} />;
  const menu = menuOpen && (
    <MenuPopover
      portrait={narrow}
      onClose={() => setMenuOpen(false)}
      onInvite={() => {
        setMenuOpen(false);
        setPeople(false);
        setInvite('invite');
        if (narrow) {
          hideChat();
        }
      }}
      onPeople={togglePeople}
      onSettings={() => {
        setMenuOpen(false);
        onOpenSettings();
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
          coarse ? undefined : (
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
              {menu}
              {chatPanel}
            </>
          )
        }
        topCentre={
          narrow ? (
            <div className="mt-(--hud-portrait-bar-row) flex flex-col items-center gap-2">
              <div className="min-h-12">{!building && missionsPanel}</div>
              {inCall && <div aria-hidden className="h-[calc(var(--hud-portrait-call-row)-0.5rem)]" />}
              <ArrivalBubble store={store} selfId={selfId} toast />
              {toasts}
              <BuildIndicator mode={placeMode} />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 pointer-coarse:mt-16">
              <ArrivalBubble store={store} selfId={selfId} toast />
              {toasts}
              <BuildIndicator mode={placeMode} />
            </div>
          )
        }
        topRight={
          <>
            <div className="flex items-start gap-2">
              {coarse && !narrow && chatButton}
              {coarse && !narrow && menuButton}
              {!narrow && coarse && call}
              <div className={`flex items-start gap-2 transition-opacity ${fadeSecondary ? 'opacity-40' : ''}`}>
                {narrow && menuButton}
                <PingInboxHud inbox={pingInbox} store={store} />
                {mapButton}
              </div>
            </div>
            {narrow ? inCall && <div className="mt-(--hud-portrait-chip-row)">{call}</div> : !coarse && call}
          </>
        }
        rightEdge={
          <>
            {coarse && (
              <>
                {menu}
                {chatPanel}
              </>
            )}
            {peopleSheet}
            {inviteSheet}
          </>
        }
        bottomLeft={narrow || (coarse && (invite || people)) ? undefined : missionsPanel}
        bottomRight={
          (coarse && (menuOpen || people || invite)) || (!coarse && people) ? undefined : narrow ? (
            <>
              {chatVisibility.mode === 'peek' && <ChatTicker key={latestId} store={store} hiddenLogins={mutedLogins} onOpen={chatVisibility.compose} />}
              <div className="flex items-center gap-2">
                {peopleButton}
                {chatButton}
              </div>
              {!building && <NearYouButtons store={store} onWave={onWave} />}
            </>
          ) : coarse ? (
            <>
              <NearYouButtons store={store} onWave={onWave} />
              {!building && peopleButton}
            </>
          ) : (
            <NearYouCard store={store} onWave={onWave} />
          )
        }
      />
      {mapOpen && <FullMap store={store} officeName={officeName} areas={spots.areas} plan={plan} route={route} onClose={() => setMapOpen(false)} />}
    </>
  );
}
