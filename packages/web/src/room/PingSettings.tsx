import { useState } from 'react';
import type { SoundCatalog } from '@officexr/world/app';
import { Dialog } from '../Dialog';
import { previewPingSound } from '../ping/pingSound';
import { usePingPrefs, writePingPrefs, type PingSound } from '../ping/pingPrefs';
import { useSoundCatalog } from '../ping/useSoundCatalog';
import { closeToWorld } from './closeToWorld';
import { RoomMenuItem } from './RoomMenu';

export type NotificationApi = { requestPermission: () => Promise<NotificationPermission> };

const browserNotification = (): NotificationApi | null => (typeof Notification === 'undefined' ? null : Notification);

const sameSound = (a: PingSound, b: PingSound) =>
  a.type === b.type && (a.type !== 'library' || (b.type === 'library' && a.name === b.name));

export function PingSettingsMenuItem({ onSelect }: { onSelect: () => void }) {
  return <RoomMenuItem onSelect={onSelect}>Ping settings</RoomMenuItem>;
}

export function PingSettingsDialog({
  onClose,
  notification = browserNotification(),
  preview = previewPingSound,
  useCatalog = useSoundCatalog,
}: {
  onClose: () => void;
  notification?: NotificationApi | null;
  preview?: (sound: PingSound, catalog?: SoundCatalog | null) => void;
  useCatalog?: () => SoundCatalog | null;
}) {
  const prefs = usePingPrefs();
  const catalog = useCatalog();
  const [blocked, setBlocked] = useState(false);

  const savedName = prefs.sound.type === 'library' ? prefs.sound.name : null;
  const stale = savedName !== null && catalog !== null && !catalog.sounds.some((s) => s.name === savedName);
  const selected: PingSound = stale ? { type: 'builtin' } : prefs.sound;

  const options: { label: string; sound: PingSound }[] = [
    { label: 'Built-in chime', sound: { type: 'builtin' } },
    ...(catalog?.sounds ?? []).map((s) => ({ label: s.name, sound: { type: 'library', name: s.name } as const })),
    { label: 'None (silent)', sound: { type: 'none' } },
  ];

  // The permission prompt only shows from inside the click, so no await precedes the request.
  const toggleNotify = (on: boolean) => {
    if (!on || !notification) {
      writePingPrefs(localStorage, { ...prefs, notify: false });
      return;
    }
    notification.requestPermission().then(
      (permission) => {
        setBlocked(permission !== 'granted');
        writePingPrefs(localStorage, { ...prefs, notify: permission === 'granted' });
      },
      () => setBlocked(true),
    );
  };

  return (
    <Dialog title="Ping settings" onClose={closeToWorld(onClose)}>
      <fieldset className="mb-4">
        <legend className="mb-1 font-medium">Sound</legend>
        {options.map(({ label, sound }) => (
          <div key={label} className="flex items-center gap-2 py-0.5">
            <label className="flex flex-1 items-center gap-2">
              <input
                type="radio"
                name="ping-sound"
                checked={sameSound(selected, sound)}
                onChange={() => writePingPrefs(localStorage, { ...prefs, sound })}
              />
              {label}
            </label>
            {sound.type !== 'none' && (
              <button type="button" className="rounded border px-2 py-0.5" onClick={() => preview(sound, catalog)}>
                Preview<span className="sr-only"> {label}</span>
              </button>
            )}
          </div>
        ))}
        {stale && (
          <p role="status" className="mt-1 text-xs text-gray-600">
            Your chosen sound is no longer available, so the built-in chime plays.
          </p>
        )}
      </fieldset>
      <section>
        <h3 className="mb-1 font-medium">Notifications</h3>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            checked={prefs.notify}
            disabled={!notification}
            onChange={(e) => toggleNotify(e.target.checked)}
          />
          Show a system notification for pings
        </label>
        {!notification && (
          <p role="status" className="mt-1 text-xs text-gray-600">
            This browser doesn't support notifications.
          </p>
        )}
        {blocked && (
          <p role="status" className="mt-1 text-xs text-gray-600">
            Notifications are blocked. Allow them in your browser settings.
          </p>
        )}
      </section>
    </Dialog>
  );
}
