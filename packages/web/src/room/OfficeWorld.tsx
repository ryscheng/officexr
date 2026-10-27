import { useCallback, useMemo, useState } from 'react';
import type { OfficeState, Store } from '@officexr/sdk';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider, ErrorBanner, PlayView, useStoreSelector } from '@officexr/world/react';
import type { CameraMode } from '@officexr/world/renderer';
import { FilesystemLayoutStorage, FilesystemMapStorage, FilesystemRoomStorage } from '@officexr/world/scenes';
import type { Identity, Office } from '../../server/api';
import { ChatPanel } from '../hud/ChatPanel';
import { PresenceList } from '../hud/PresenceList';
import { JaasMeeting, MuteToggle, ShareScreenToggle } from '../voice/JaasMeeting';
import { ZoneCallLabel } from '../voice/ZoneCallLabel';
import { CameraModeMenuItem } from './CameraModeMenuItem';
import { CharacterPicker } from './CharacterPicker';
import { OfficeSettings } from './OfficeSettings';
import { PreWorld } from './PreWorld';
import { playerIdFor } from './playerId';
import { RoomMenu, RoomMenuItem } from './RoomMenu';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useJoinCheck } from './useJoinCheck';
import { useOfficeSession } from './useOfficeSession';
import { useShortcutsHotkey } from './useShortcutsHotkey';
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

function World({ office: initialOffice, me }: { office: Office; me: Identity }) {
  const [office, setOffice] = useState(initialOffice);
  const selfId = useMemo(() => playerIdFor(initialOffice, me), [initialOffice, me]);
  const join = useJoinCheck(office.id, me.login);
  const session = useOfficeSession(office.id, me, selfId, join.state === 'go');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useShortcutsHotkey(openShortcuts, session.type === 'ready');

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
          hostControls
          error={saveError}
          onDismissError={() => setSaveError(null)}
        >
          <RoomMenu>
            <CameraModeMenuItem value={cameraMode} onChange={setCameraMode} />
            <RoomMenuItem onSelect={openShortcuts}>Keyboard shortcuts</RoomMenuItem>
          </RoomMenu>
          {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
          {session.voice && <JaasMeeting voice={session.voice} />}
          <ChatPanel store={session.local.store} actions={session.local.actions} selfId={session.local.selfId} />
          <PresenceList store={session.local.store} selfId={session.local.selfId} officeName={office.name} />
          <div className="pointer-events-none absolute right-3 bottom-3 flex flex-col items-end gap-2">
            <OfficeSettings office={office} me={me} onSaved={setOffice} />
            <CharacterPicker local={session.local} onSaveResult={setSaveError} />
            {session.voice && (
              <div className="flex items-center gap-2">
                <ZoneCallLabel store={session.local.store} />
                <ShareScreenToggle voice={session.voice} />
                <MuteToggle voice={session.voice} />
              </div>
            )}
          </div>
        </PlayView>
      )}
      {session.type === 'ready' && <ReplacedBanner store={session.local.store} />}
      <PreWorld title={office.name} join={join.state} session={session} onJoin={join.join} onCancel={join.cancel} />
      {session.type === 'replaced' && <ErrorBanner message={REPLACED_MESSAGE} />}
    </div>
  );
}
