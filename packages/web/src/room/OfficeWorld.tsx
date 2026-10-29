import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Actions, OfficeState, Store } from '@officexr/sdk';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider, ErrorBanner, PlayView, useStoreSelector } from '@officexr/world/react';
import { createWorldXRStore, useXRSessionModeSupported, type CameraMode, type XRStore } from '@officexr/world/renderer';
import { FilesystemLayoutStorage, FilesystemMapStorage, FilesystemRoomStorage } from '@officexr/world/scenes';
import type { Identity, Office } from '../../server/api';
import { ChatPanel } from '../hud/ChatPanel';
import { Minimap } from '../hud/Minimap';
import { PresenceList } from '../hud/PresenceList';
import { CallBar } from '../voice/CallBar';
import { JaasMeeting } from '../voice/JaasMeeting';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { CameraModeMenuItem } from './CameraModeMenuItem';
import { CharacterDialog, CharacterMenuItem } from './CharacterDialog';
import { MotionLookMenuItem } from './MotionLookMenuItem';
import { OfficeSettingsDialog, OfficeSettingsMenuItem } from './OfficeSettings';
import { PreWorld } from './PreWorld';
import { playerIdFor } from './playerId';
import { RoomMenu, RoomMenuChoice, RoomMenuItem } from './RoomMenu';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useJoinCheck } from './useJoinCheck';
import { useLocalPresence } from './useLocalPresence';
import { useOfficeSession } from './useOfficeSession';
import { useShortcutsHotkey } from './useShortcutsHotkey';
import { VrMenuItem } from './VrMenuItem';
import { DEFAULT_MAP, withDefaultMap } from './withDefaultMap';

const storages = {
  maps: withDefaultMap(new FilesystemMapStorage()),
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

/** Created in an effect so StrictMode's remount destroys the first store, which appends a DOM overlay. */
function useWorldXRStore(): XRStore | undefined {
  const [store, setStore] = useState<XRStore>();
  useEffect(() => {
    const created = createWorldXRStore();
    setStore(created);
    return () => created.destroy();
  }, []);
  return store;
}

function World({ office: initialOffice, me }: { office: Office; me: Identity }) {
  const [office, setOffice] = useState(initialOffice);
  const selfId = useMemo(() => playerIdFor(initialOffice, me), [initialOffice, me]);
  const join = useJoinCheck(office.id, me.login);
  const session = useOfficeSession(office.id, me, selfId, join.state === 'go');
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  const [motionLook, setMotionLook] = useState({ enabled: false, recenterKey: 0 });
  const [motionUnsupported, setMotionUnsupported] = useState(false);
  const [invertLook, setInvertLook] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const [characterOpen, setCharacterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useShortcutsHotkey(openShortcuts, session.type === 'ready');
  const xrStore = useWorldXRStore();
  const vrSupported = useXRSessionModeSupported('immersive-vr') === true;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {session.type === 'ready' && (
        <PlayView
          store={session.local.store}
          actions={session.local.actions}
          rules={session.local.rules}
          bus={session.local.bus}
          sync={session.office.sync}
          handshake={session.office.handshake}
          selfId={session.local.selfId}
          mapName={office.map_name ?? DEFAULT_MAP}
          title={office.name}
          storages={storages}
          realtime="ws"
          cameraMode={cameraMode}
          onCameraModeChange={setCameraMode}
          motionLook={motionLook}
          invertLook={invertLook}
          hostControls
          error={bannerError}
          onDismissError={() => setBannerError(null)}
          xrStore={xrStore}
        >
          <RoomMenu>
            <CameraModeMenuItem value={cameraMode} onChange={setCameraMode} />
            <MotionLookMenuItem
              enabled={motionLook.enabled}
              onEnabledChange={(enabled) => setMotionLook((m) => ({ ...m, enabled }))}
              onRecenter={() => setMotionLook((m) => ({ ...m, recenterKey: m.recenterKey + 1 }))}
              unsupported={motionUnsupported}
              onUnsupported={() => setMotionUnsupported(true)}
            />
            <RoomMenuChoice>
              <input
                type="checkbox"
                role="switch"
                checked={invertLook}
                onChange={(e) => setInvertLook(e.target.checked)}
              />
              Invert look
            </RoomMenuChoice>
            <CharacterMenuItem onSelect={() => setCharacterOpen(true)} />
            <OfficeSettingsMenuItem office={office} me={me} onSelect={() => setSettingsOpen(true)} />
            <RoomMenuItem onSelect={openShortcuts}>Keyboard shortcuts</RoomMenuItem>
            {xrStore && <VrMenuItem supported={vrSupported} store={xrStore} onError={setBannerError} />}
          </RoomMenu>
          {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
          {characterOpen && (
            <CharacterDialog local={session.local} onSaveResult={setBannerError} onClose={() => setCharacterOpen(false)} />
          )}
          {settingsOpen && (
            <OfficeSettingsDialog office={office} me={me} onSaved={setOffice} onClose={() => setSettingsOpen(false)} />
          )}
          {session.voice && <JaasMeeting voice={session.voice} />}
          <ChatPanel store={session.local.store} actions={session.local.actions} selfId={session.local.selfId} />
          {/* The call bar centres while it fits; the people column pushes it aside instead of under it.
              On touch the people column sits above the joystick, so only the joystick's width is reserved. */}
          <div className="pointer-events-none absolute inset-x-3 bottom-3 grid grid-cols-[1fr_minmax(0,auto)_1fr] items-end gap-2">
            <div className="pointer-coarse:min-w-28">
              <div className="flex flex-col items-start gap-2 pointer-coarse:absolute pointer-coarse:bottom-37 pointer-coarse:left-0">
                <PresenceList store={session.local.store} selfId={session.local.selfId} officeName={office.name} />
                <Minimap store={session.local.store} />
              </div>
            </div>
            {session.voice && <CallBar store={session.local.store} voice={session.voice} />}
          </div>
        </PlayView>
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
