import { useEffect, useMemo, useState } from 'react';
import type { OfficeState, Store } from '@officexr/sdk';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider, ErrorBanner, PlayView, useStoreSelector } from '@officexr/world/react';
import { FilesystemLayoutStorage, FilesystemMapStorage, FilesystemRoomStorage } from '@officexr/world/scenes';
import type { Identity, Office } from '../../server/api';
import { ChatPanel } from '../hud/ChatPanel';
import { JaasMeeting, MuteToggle, ShareScreenToggle } from '../voice/JaasMeeting';
import { CharacterPicker } from './CharacterPicker';
import { JoinPrompt } from './JoinPrompt';
import { OfficeSettings } from './OfficeSettings';
import { playerIdFor } from './playerId';
import { useJoinCheck } from './useJoinCheck';
import { useOfficeSession } from './useOfficeSession';
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

const playerNames = (s: OfficeState) =>
  Object.values(s.players)
    .map((p) => p.name)
    .filter(Boolean)
    .sort()
    .join(', ');

function usePlayerNames(store: Store | undefined): string {
  const [names, setNames] = useState('');
  useEffect(() => {
    if (!store) {
      return;
    }
    setNames(playerNames(store.getState()));
    return store.subscribe(playerNames, setNames);
  }, [store]);
  return names;
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
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const local = session.type === 'ready' ? session.local : undefined;
  const names = usePlayerNames(local?.store);

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
          storages={storages}
          realtime="ws"
          error={saveError}
          onDismissError={() => setSaveError(null)}
        >
          {session.voice && <JaasMeeting voice={session.voice} />}
          <ChatPanel store={session.local.store} actions={session.local.actions} selfId={session.local.selfId} />
          {names && (
            <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/55 px-2.5 py-1.5 text-xs text-white">
              {office.name}: {names}
            </div>
          )}
          <div className="pointer-events-none absolute right-3 bottom-3 flex flex-col items-end gap-2">
            <OfficeSettings office={office} me={me} onSaved={setOffice} />
            <CharacterPicker local={session.local} onSaveResult={setSaveError} />
            {session.voice && (
              <div className="flex gap-2">
                <ShareScreenToggle voice={session.voice} />
                <MuteToggle voice={session.voice} />
              </div>
            )}
          </div>
        </PlayView>
      )}
      {session.type === 'ready' && <ReplacedBanner store={session.local.store} />}
      {join.state === 'prompt' && <JoinPrompt onJoin={join.join} onCancel={join.cancel} />}
      {session.type === 'replaced' && <ErrorBanner message={REPLACED_MESSAGE} />}
      {session.type === 'error' && session.message !== dismissedError && (
        <ErrorBanner message={session.message} onDismiss={() => setDismissedError(session.message)} />
      )}
    </div>
  );
}
