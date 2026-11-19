import { Switch } from '../hud/ui/Switch';
import { SettingRow } from '../room/SettingsModal';
import { useSfxPrefs, writeSfxPrefs } from './sfxPrefs';

/** Settings rows for the office's sound effects: on or off, and how loud. */
export function SfxSettingsRows() {
  const prefs = useSfxPrefs();
  return (
    <>
      <SettingRow label="Sound effects">
        <Switch
          aria-label="Sound effects"
          checked={prefs.enabled}
          onCheckedChange={(enabled) => writeSfxPrefs(localStorage, { ...prefs, enabled })}
        />
      </SettingRow>
      <SettingRow label="Effects volume">
        <input
          type="range"
          aria-label="Effects volume"
          min={0}
          max={100}
          value={Math.round(prefs.volume * 100)}
          disabled={!prefs.enabled}
          onChange={(e) => writeSfxPrefs(localStorage, { ...prefs, volume: Number(e.target.value) / 100 })}
          className="w-32 accent-hud-accent"
        />
      </SettingRow>
    </>
  );
}
