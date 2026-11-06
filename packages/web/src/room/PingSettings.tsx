import { useId, useState } from 'react';
import type { SoundCatalog } from '@officexr/world/app';
import { assertNever } from '../ping/assertNever';
import { browserNotification, type NotificationSeam } from '../ping/pingNotifier';
import { previewPingSound } from '../ping/pingSound';
import { readPingPrefs, usePingPrefs, writePingPrefs, type PingSound } from '../ping/pingPrefs';
import { useSoundCatalog } from '../ping/useSoundCatalog';
import { Switch } from '../hud/ui/Switch';
import { SettingRow } from './SettingsModal';

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

export function NotificationsPane({
  notification = browserNotification(),
  preview = previewPingSound,
  catalog: catalogOverride,
}: {
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
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 font-hud-title text-sm font-normal tracking-widest uppercase">Sound</legend>
        <div className="space-y-2">
          {options.map(({ label, sound }) => {
            const active = sameSound(selected, sound);
            return (
              <div
                key={soundKey(sound)}
                className={`flex items-center gap-2 rounded-hud-control border-2 px-3 py-2 ${
                  active ? 'border-hud-accent-edge bg-hud-inset' : 'border-hud-edge'
                }`}
              >
                <label className="flex flex-1 items-center gap-2 font-bold">
                  <input
                    type="radio"
                    name="ping-sound"
                    className="accent-hud-accent"
                    checked={active}
                    onChange={() => writePingPrefs(localStorage, { ...prefs, sound })}
                  />
                  {label}
                </label>
                {isAudible(sound) && (
                  <button
                    type="button"
                    className="rounded-hud-control border-2 border-hud-edge bg-hud-inset px-3 py-1 text-xs font-bold hover:bg-hud-edge"
                    onClick={() => preview(sound, catalog)}
                  >
                    Preview<span className="sr-only"> {label}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {stale && (
          <p role="status" className="mt-2 text-xs text-hud-text-2">
            Your chosen sound is no longer available, so the built-in chime plays.
          </p>
        )}
      </fieldset>
      <section>
        <SettingRow label="System notifications">
          <Switch
            aria-label="System notifications"
            checked={prefs.notify}
            disabled={!notification || pending}
            aria-describedby={hint ? hintId : undefined}
            onCheckedChange={toggleNotify}
          />
        </SettingRow>
        {hint && (
          <p id={hintId} role="status" className="text-xs text-hud-text-2">
            {hint}
          </p>
        )}
      </section>
    </div>
  );
}
