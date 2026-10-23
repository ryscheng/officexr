import { useMemo, useState } from 'react';
import type { OfficeState, Store } from '@officexr/sdk';
import { createDefaultApi } from '@officexr/world/app';
import { ApplicationProvider, ErrorBanner, PlayView, useStoreSelector } from '@officexr/world/react';
import { FilesystemLayoutStorage, FilesystemMapStorage, FilesystemRoomStorage } from '@officexr/world/scenes';
import type { Identity, Office } from '../../server/api';
import { ChatPanel } from '../hud/ChatPanel';
import { PresenceList } from '../hud/PresenceList';
import { JaasMeeting, MuteToggle, ShareScreenToggle } from '../voice/JaasMeeting';
import { CharacterPicker } from './CharacterPicker';
import { OfficeSettings } from './OfficeSettings';
import { DEFAULT_MAP, withDefaultMap } from './withDefaultMap';
import { useOfficeSession } from './useOfficeSession';

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

function ReplacedBanner({ store }: { store: Store }) {
  const replaced = useStoreSelector(store, isReplaced);
  return replaced ? <ErrorBanner message="This office was opened in another window. Reload to rejoin here." /> : null;
}

function World({ office: initialOffice, me }: { office: Office; me: Identity }) {
  const [office, setOffice] = useState(initialOffice);
  const session = useOfficeSession(office.id, me);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
          selfId={me.login}
          mapName={office.map_name ?? DEFAULT_MAP}
          storages={storages}
          realtime="ws"
          error={saveError}
          onDismissError={() => setSaveError(null)}
        >
          {session.voice && <JaasMeeting voice={session.voice} />}
          <ChatPanel store={session.local.store} actions={session.local.actions} selfId={me.login} />
          <PresenceList store={session.local.store} selfId={session.local.selfId} officeName={office.name} />
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
      {session.type === 'error' && session.message !== dismissedError && (
        <ErrorBanner message={session.message} onDismiss={() => setDismissedError(session.message)} />
      )}
    </div>
  );
}
