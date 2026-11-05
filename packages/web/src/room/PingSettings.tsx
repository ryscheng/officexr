import { useId, useState } from 'react';
import type { SoundCatalog } from '@officexr/world/app';
import { Dialog } from '../Dialog';
import { assertNever } from '../ping/assertNever';
import { browserNotification, type NotificationSeam } from '../ping/pingNotifier';
import { previewPingSound } from '../ping/pingSound';
import { readPingPrefs, usePingPrefs, writePingPrefs, type PingSound } from '../ping/pingPrefs';
import { useSoundCatalog } from '../ping/useSoundCatalog';
import { closeToWorld } from './closeToWorld';
import { RoomMenuItem } from './RoomMenu';

const sameSound = (a: PingSound, b: PingSound): boolean =>
  a.type === 'builtin'
    ? b.type === 'builtin'
    : a.type === 'none'
      ? b.type === 'none'
      : a.type === 'library'
        ? b.type === 'library' && a.name === b.name
        : assertNever(a);

const isAudible = (sound: PingSound): boolean =>
  sound.type === 'builtin' ? true : sound.type === 'library' ? true : sound.type === 'none' ? false : assertNever(sound);

const soundKey = (sound: PingSound): string => (sound.type === 'library' ? `library:${sound.name}` : sound.type);

/** Requests inside the click so user activation holds; a throw, rejection or old Safari's callback form all resolve or reject. */
const requestPermission = (api: NotificationSeam): Promise<NotificationPermission> =>
  new Promise((resolve, reject) => {
    const result = api.requestPermission(resolve) as Promise<NotificationPermission> | undefined;
    result?.then(resolve, reject);
  });

export function PingSettingsMenuItem({ onSelect }: { onSelect: () => void }) {
  return <RoomMenuItem onSelect={onSelect}>Ping settings</RoomMenuItem>;
}

export function PingSettingsDialog({
  onClose,
  notification = browserNotification(),
  preview = previewPingSound,
  catalog: catalogOverride,
}: {
  onClose: () => void;
  notification?: NotificationSeam | null;
  preview?: (sound: PingSound, catalog?: SoundCatalog | null) => void;
  catalog?: SoundCatalog | null;
}) {
  const prefs = usePingPrefs();
  const loadedCatalog = useSoundCatalog();
  const catalog = catalogOverride === undefined ? loadedCatalog : catalogOverride;
  const [blocked, setBlocked] = useState(false);
  const [pending, setPending] = useState(false);
  const hintId = useId();

  const savedName = prefs.sound.type === 'library' ? prefs.sound.name : null;
  const stale = savedName !== null && catalog !== null && !catalog.sounds.some((s) => s.name === savedName);
  const selected: PingSound = stale ? { type: 'builtin' } : prefs.sound;

  const options: { label: string; sound: PingSound }[] = [
    { label: 'Built-in chime', sound: { type: 'builtin' } },
    ...(catalog?.sounds ?? []).map((s) => ({ label: s.name, sound: { type: 'library', name: s.name } as const })),
    { label: 'None (silent)', sound: { type: 'none' } },
  ];

  const toggleNotify = (on: boolean) => {
    if (!on || !notification) {
      setBlocked(false);
      writePingPrefs(localStorage, { ...readPingPrefs(localStorage), notify: false });
      return;
    }
    setPending(true);
    requestPermission(notification).then(
      (permission) => {
        setPending(false);
        setBlocked(permission !== 'granted');
        writePingPrefs(localStorage, { ...readPingPrefs(localStorage), notify: permission === 'granted' });
      },
      () => {
        setPending(false);
        setBlocked(true);
      },
    );
  };

  const hint = !notification
    ? "This browser doesn't support notifications."
    : blocked || (prefs.notify && notification.permission === 'denied')
      ? 'Notifications are blocked. Allow them in your browser settings.'
      : null;

  return (
    <Dialog title="Ping settings" onClose={closeToWorld(onClose)}>
      <fieldset className="mb-4">
        <legend className="mb-1 font-medium">Sound</legend>
        {options.map(({ label, sound }) => (
          <div key={soundKey(sound)} className="flex items-center gap-2 py-0.5">
            <label className="flex flex-1 items-center gap-2">
              <input
                type="radio"
                name="ping-sound"
                checked={sameSound(selected, sound)}
                onChange={() => writePingPrefs(localStorage, { ...prefs, sound })}
              />
              {label}
            </label>
            {isAudible(sound) && (
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
            disabled={!notification || pending}
            aria-describedby={hint ? hintId : undefined}
            onChange={(e) => toggleNotify(e.target.checked)}
          />
          Show a system notification for pings
        </label>
        {hint && (
          <p id={hintId} role="status" className="mt-1 text-xs text-gray-600">
            {hint}
          </p>
        )}
      </section>
    </Dialog>
  );
}
