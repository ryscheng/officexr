import { useEffect, useState, type ReactNode } from 'react';
import { Map as MapIcon, Menu, MessageSquare, Settings, Users } from 'lucide-react';
import type { Actions, OfficeState, PlayerId, Store } from '@officexr/sdk';
import { useCoarsePointer, useStoreSelector } from '@officexr/world/top-down';
import type { PingInbox } from '../ping/pingInbox';
import type { PingSender } from '../ping/usePingSender';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import type { PlaceModeStore } from '@officexr/world/motion';
import { BuildIndicator } from './BuildIndicator';
import { CallCard } from './CallCard';
import { ChatPanel } from './ChatPanel';
import { FullMap } from './FullMap';
import { HudLayout } from './HudLayout';
import { IdentityCard } from './IdentityCard';
import { useMapPlan } from './OfficeMinimap';
import { MissionsPanel } from './missions/MissionsPanel';
import { resolvePlace } from './missions/missionRows';
import { useOfficeSpots } from './missions/useOfficeSpots';
import type { MissionsApi } from './missions/useMissions';
import { NearYouButtons, NearYouCard } from './NearYouCard';
import { PingInboxHud } from './PingInboxHud';
import { ArrivalBubble, PresenceList } from './PresenceList';
import { RoundButton } from './RoundButton';
import { Keycap } from './ui/Keycap';
import { Panel } from './ui/Panel';
import { useChatVisibility } from './useChatVisibility';
import { useEscapeLayer } from './useEscapeLayer';
import { useHotkey } from './useHotkey';

const selectChat = (s: OfficeState) => s.chat;

function MenuPopover({ onPeople, onSettings, onClose }: { onPeople: () => void; onSettings: () => void; onClose: () => void }) {
  useEscapeLayer(true, onClose);
  const item = 'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold hover:bg-hud-hover pointer-coarse:min-h-11';
  return (
    <Panel role="menu" aria-label="Office menu" className="pointer-events-auto flex w-60 flex-col p-1.5">
      <button type="button" role="menuitem" className={item} onClick={onPeople}>
        <Users aria-hidden className="size-4" />
        People here
      </button>
      <button type="button" role="menuitem" className={item} onClick={onSettings}>
        <Settings aria-hidden className="size-4" />
        Settings
      </button>
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
  onWave,
  onOpenSettings,
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
  onWave: () => void;
  onOpenSettings: () => void;
}) {
  const coarse = useCoarsePointer();
  const chat = useStoreSelector(store, selectChat);
  const chatVisibility = useChatVisibility(chat.length);
  const [read, setRead] = useState(chat.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const [people, setPeople] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const spots = useOfficeSpots(store);
  const plan = useMapPlan(store);

  useEffect(() => {
    if (chatVisibility.mode !== 'hidden') {
      setRead(chat.length);
    }
  }, [chatVisibility.mode, chat.length]);
  useHotkey('m', () => setMapOpen(true), !mapOpen);

  const unread = chatVisibility.mode === 'hidden' ? Math.max(0, chat.length - read) : 0;
  const toggleChat = () => (chatVisibility.mode === 'compose' ? chatVisibility.hide() : chatVisibility.compose());
  const openMenu = () => setMenuOpen((o) => !o);

  const current = missions.current;
  const to = current?.place ? resolvePlace(current.place, spots.areas) : null;
  const route = current && to ? { to, label: current.title, areaId: current.place?.kind === 'room' ? current.place.id : null } : null;

  const missionsPanel = (
    <MissionsPanel missions={missions} me={me} areas={spots.areas} people={spots.people} self={spots.self} compact={coarse} />
  );
  const chatPanel = (
    <ChatPanel
      store={store}
      actions={actions}
      selfId={selfId}
      visibility={chatVisibility}
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
  const call = voice && <CallCard store={store} selfId={selfId} voice={voice} pinger={pinger} compact={coarse} />;
  const menu = menuOpen && (
    <MenuPopover
      onClose={() => setMenuOpen(false)}
      onPeople={() => {
        setPeople((p) => !p);
        setMenuOpen(false);
      }}
      onSettings={() => {
        setMenuOpen(false);
        onOpenSettings();
      }}
    />
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
                onChat={toggleChat}
                onMenu={openMenu}
              />
              {menu}
              {chatPanel}
              {people && <PresenceList store={store} selfId={selfId} officeName={officeName} pinger={pinger} />}
            </>
          )
        }
        topCentre={
          <div className="flex flex-col items-center gap-2 pointer-coarse:mt-16">
            <ArrivalBubble store={store} selfId={selfId} toast />
            {toasts}
          </div>
        }
        topRight={
          <>
            <div className="flex items-start gap-2">
              {coarse && (
                <>
                  <RoundButton tone="glass" aria-label={unread ? `Chat, ${unread} new` : 'Chat'} onClick={toggleChat}>
                    <MessageSquare aria-hidden className="size-5" />
                  </RoundButton>
                  <RoundButton tone="glass" aria-label="Office menu" aria-expanded={menuOpen} onClick={openMenu}>
                    <Menu aria-hidden className="size-5" />
                  </RoundButton>
                  {call}
                </>
              )}
              <PingInboxHud inbox={pingInbox} store={store} />
              {mapButton}
            </div>
            {!coarse && call}
          </>
        }
        rightEdge={
          coarse && (
            <>
              {menu}
              {chatPanel}
              {people && <PresenceList store={store} selfId={selfId} officeName={officeName} pinger={pinger} />}
            </>
          )
        }
        bottomCentre={<BuildIndicator mode={placeMode} />}
        bottomLeft={missionsPanel}
        bottomRight={coarse ? <NearYouButtons store={store} onWave={onWave} /> : <NearYouCard store={store} onWave={onWave} />}
      />
      {mapOpen && <FullMap store={store} officeName={officeName} areas={spots.areas} plan={plan} route={route} onClose={() => setMapOpen(false)} />}
    </>
  );
}
