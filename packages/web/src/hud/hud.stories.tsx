import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Story } from '@ladle/react';
import { Bell, Settings } from 'lucide-react';
import { createPersistentLocalState, type PersistentLocalState } from '@officexr/core-refactor';
import { createPlaceMode } from '@officexr/world/motion';
import {
  ActionContextStore,
  ActionInput,
  createViewYaw,
  MobileActionPad,
  MobileActionRegistry,
  NO_MOVE,
  PlayControlsProvider,
  ViewYawProvider,
  VirtualJoystick,
  WORLD_MOBILE_ACTIONS,
} from '@officexr/world/react';
import { getScenario, SELF_ID, seedScenario } from '../hud-preview/scenarios';
import { PlacePalette } from '../place/PlaceHud';
import { SpellChip } from '../spell/SpellChip';
import { wandMobileActions } from '../spell/mobileWandActions';
import { EmoteMenu } from '../status/EmoteMenu';
import { FocusPingToast } from '../status/FocusPingToast';
import { statusMobileActions } from '../status/mobileStatusActions';
import { SelfStatusProvider, useStatusHud } from '../status/SelfStatusProvider';
import { StatusMenu } from '../status/StatusMenu';
import { CallBar } from '../voice/CallBar';
import { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { ChatPanel } from './ChatPanel';
import { fakePlayControls } from './fakePlayControls';
import { HudBanner } from './HudBanner';
import { HudLayout } from './HudLayout';
import { IconButton } from './IconButton';
import { Minimap } from './Minimap';
import { OfficeNamePlate } from './OfficeNamePlate';
import { PokeToast } from './PokeToast';
import { PresenceList } from './PresenceList';

export default { title: 'HUD' };

/**
 * Every story renders the real component over a store seeded from a `/hud-preview` scenario (`crowd`, `alone`,
 * `wand`, `build`, `focus`, `full`). Switch Ladle's theme for light and dark; the screens are fixed-size
 * stand-ins for a phone in landscape and a desktop window. Touch-only styles follow the browser's pointer,
 * so open the phone stories in device emulation with touch to see them.
 */
function Seeded({ scenario, children }: { scenario: string; children: (local: PersistentLocalState) => ReactNode }) {
  const world = useMemo(() => {
    const local = createPersistentLocalState({ selfId: SELF_ID, officeId: 'stories' });
    return { local, stop: seedScenario(getScenario(scenario), local) };
  }, [scenario]);
  useEffect(() => world.stop, [world]);
  return <>{children(world.local)}</>;
}

function Providers({ children }: { children: ReactNode }) {
  const [viewYaw] = useState(createViewYaw);
  const [controls] = useState(() => fakePlayControls().controls);
  return (
    <PlayControlsProvider controls={controls}>
      <ViewYawProvider viewYaw={viewYaw}>{children}</ViewYawProvider>
    </PlayControlsProvider>
  );
}

function Screen({ w, h, children }: { w: number; h: number; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-slate-800" style={{ width: w, height: h, contain: 'layout' }}>
      {children}
    </div>
  );
}

const openStorage = { getItem: () => 'open', setItem: () => {} };

export const OfficePlate: Story = () => (
  <div className="flex flex-col gap-4">
    {[
      ['alone', 'Preview Office'],
      ['full', 'The Very Long Named Headquarters Office'],
    ].map(([scenario, name]) => (
      <Seeded key={scenario} scenario={scenario!}>
        {(l) => <OfficeNamePlate store={l.store} name={name!} />}
      </Seeded>
    ))}
  </div>
);

const roster =
  (scenario: string): Story =>
  () => (
    <Seeded scenario={scenario}>
      {(l) => (
        <Providers>
          <PresenceList store={l.store} selfId={l.selfId} officeName="Preview Office" storage={openStorage} />
        </Providers>
      )}
    </Seeded>
  );
export const PeopleEmpty = roster('alone');
export const PeopleCrowd = roster('crowd');
export const PeopleFullLongNames = roster('full');

export const PeopleFolded: Story = () => (
  <Seeded scenario="crowd">
    {(l) => (
      <Providers>
        <PresenceList store={l.store} selfId={l.selfId} officeName="Preview Office" storage={{ getItem: () => 'collapsed', setItem: () => {} }} />
      </Providers>
    )}
  </Seeded>
);

export const MapCard: Story = () => (
  <Seeded scenario="crowd">
    {(l) => (
      <Providers>
        <Minimap store={l.store} alwaysOpen />
      </Providers>
    )}
  </Seeded>
);

function OpenChat({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector('button')?.click(), []);
  return <div ref={ref}>{children}</div>;
}
const chat =
  (scenario: string): Story =>
  () => (
    <Seeded scenario={scenario}>
      {(l) => (
        <OpenChat>
          <ChatPanel store={l.store} actions={l.actions} selfId={l.selfId} />
        </OpenChat>
      )}
    </Seeded>
  );
export const ChatEmpty = chat('alone');
export const ChatMessages = chat('crowd');
export const ChatLong = chat('full');

export const Toasts: Story = () => (
  <Seeded scenario="crowd">
    {(l) => (
      <div className="flex w-96 flex-col items-center gap-3">
        <PokeToast bus={l.bus} store={l.store} selfId={l.selfId} />
        <FocusPingToast notice={{ name: 'Chiamaka Okonkwo-Adeyemi', n: 1 }} onDone={() => {}} />
        <HudBanner message="This office was opened in another window. Reload to rejoin here." />
        <HudBanner message="Could not save the map." onDismiss={() => {}} />
      </div>
    )}
  </Seeded>
);

const voice = () => new JaasVoiceAdapter({ appId: 'stories', getJwt: () => Promise.reject(new Error('no voice')), displayName: 'You' });
const callBar =
  (scenario: string): Story =>
  () => {
    const adapter = useMemo(voice, []);
    return (
      <Seeded scenario={scenario}>
        {(l) => (
          <Providers>
            <CallBar store={l.store} selfId={l.selfId} voice={adapter} />
          </Providers>
        )}
      </Seeded>
    );
  };
export const CallBarAlone = callBar('alone');
export const CallBarInCall = callBar('crowd');
export const CallBarFullCall = callBar('full');

export const SpellBarHeldWand: Story = () => <Seeded scenario="wand">{(l) => <SpellChip store={l.store} actions={l.actions} selfId={l.selfId} />}</Seeded>;
export const SpellBarEmptyHands: Story = () => (
  <Seeded scenario="crowd">{(l) => <SpellChip store={l.store} actions={l.actions} selfId={l.selfId} />}</Seeded>
);

export const BuildPanelOpen: Story = () => {
  const mode = useMemo(() => {
    const m = createPlaceMode();
    m.setOpen(true);
    return m;
  }, []);
  return <Seeded scenario="build">{(l) => <PlacePalette mode={mode} store={l.store} />}</Seeded>;
};

function OpenMenus({ status, emote }: { status?: boolean; emote?: boolean }) {
  const hud = useStatusHud();
  useEffect(() => {
    if (status) hud?.setStatusMenuOpen(true);
    if (emote) hud?.setEmoteMenuOpen(true);
  }, [hud, status, emote]);
  return null;
}
const statusStory =
  (open: { status?: boolean; emote?: boolean }): Story =>
  () => (
    <Seeded scenario="focus">
      {(l) => (
        <SelfStatusProvider store={l.store} actions={l.actions} sync={{ sendEmote: () => {} }} selfId={l.selfId} storage={{ getItem: () => null, setItem: () => {} }}>
          <OpenMenus {...open} />
          <div className="flex h-80 items-start justify-end gap-2">
            <StatusMenu />
            <EmoteMenu />
          </div>
        </SelfStatusProvider>
      )}
    </Seeded>
  );
export const StatusMenuOpen = statusStory({ status: true });
export const EmotePickerOpen = statusStory({ emote: true });

function Pad({ scenario, interact }: { scenario: string; interact: 'ride' | 'wand-return' | null }) {
  const [input] = useState(() => new ActionInput());
  const [context] = useState(() => new ActionContextStore());
  const moveInput = useMemo(() => ({ current: NO_MOVE }), []);
  useEffect(() => context.set({ interact }), [context, interact]);
  return (
    <Seeded scenario={scenario}>
      {(l) => {
        const registry = new MobileActionRegistry();
        registry.register(WORLD_MOBILE_ACTIONS);
        registry.register(statusMobileActions({ handRaised: false, toggleHand: () => {}, toggleEmotePicker: () => {} }));
        registry.register(
          wandMobileActions(
            { holdingWand: l.store.getState().players[l.selfId]?.held === 'wand', spell: 'fireball', buildOpen: false },
            { cycleSpell: () => {}, toggleBuild: () => {}, place: () => {} },
          ),
        );
        return (
          <Screen w={844} h={390}>
            <VirtualJoystick inputRef={moveInput} />
            <MobileActionPad registry={registry} input={input} context={context} />
          </Screen>
        );
      }}
    </Seeded>
  );
}
export const TouchPadIdle: Story = () => <Pad scenario="crowd" interact={null} />;
export const TouchPadWandHeld: Story = () => <Pad scenario="wand" interact="wand-return" />;
export const TouchPadNearRide: Story = () => <Pad scenario="crowd" interact="ride" />;

const layout =
  (scenario: string, w: number, h: number): Story =>
  () => {
    const adapter = useMemo(voice, []);
    return (
      <Seeded scenario={scenario}>
        {(l) => (
          <Providers>
            <Screen w={w} h={h}>
              <HudLayout
                topLeft={<OfficeNamePlate store={l.store} name="Preview Office" />}
                topRight={
                  <div className="flex items-start gap-2">
                    <IconButton icon={Bell} label="Pings" onClick={() => {}} />
                    <IconButton icon={Settings} label="Settings" tone="accent" onClick={() => {}} />
                  </div>
                }
                rightEdge={<PresenceList store={l.store} selfId={l.selfId} officeName="Preview Office" storage={openStorage} />}
                bottomCentre={
                  <div className="flex flex-col items-center gap-2">
                    <SpellChip store={l.store} actions={l.actions} selfId={l.selfId} />
                    <CallBar store={l.store} selfId={l.selfId} voice={adapter} />
                  </div>
                }
                bottomLeft={<ChatPanel store={l.store} actions={l.actions} selfId={l.selfId} />}
              />
            </Screen>
          </Providers>
        )}
      </Seeded>
    );
  };
export const LayoutPhoneLandscape = layout('wand', 844, 390);
export const LayoutPhoneLandscapeAlone = layout('alone', 844, 390);
export const LayoutDesktopCrowd = layout('crowd', 1280, 720);
export const LayoutDesktopFull = layout('full', 1280, 720);
