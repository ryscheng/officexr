import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Story } from '@ladle/react';
import { Bell, Settings } from 'lucide-react';
import { createPersistentLocalState, type PersistentLocalState } from '@officexr/core-refactor';
import { createViewYaw, PlayControlsProvider, ViewYawProvider } from '@officexr/world/react';
import { getScenario, SELF_ID, seedScenario } from '../hud-preview/scenarios';
import { CallBar } from '../voice/CallBar';
import { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { ChatPanel } from './ChatPanel';
import { fakePlayControls } from './fakePlayControls';
import { HudBanner } from './HudBanner';
import { HudLayout } from './HudLayout';
import { IconButton } from './IconButton';
import { Minimap } from './Minimap';
import { OfficeNamePlate } from './OfficeNamePlate';
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
  <div className="flex w-96 flex-col items-center gap-3">
    <HudBanner message="This office was opened in another window. Reload to rejoin here." />
    <HudBanner message="Could not save the map." onDismiss={() => {}} />
  </div>
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
                  <CallBar store={l.store} selfId={l.selfId} voice={adapter} />
                }
                bottomLeft={<ChatPanel store={l.store} actions={l.actions} selfId={l.selfId} />}
              />
            </Screen>
          </Providers>
        )}
      </Seeded>
    );
  };
export const LayoutPhoneLandscape = layout('crowd', 844, 390);
export const LayoutPhoneLandscapeAlone = layout('alone', 844, 390);
export const LayoutDesktopCrowd = layout('crowd', 1280, 720);
export const LayoutDesktopFull = layout('full', 1280, 720);
