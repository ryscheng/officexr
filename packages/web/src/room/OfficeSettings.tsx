import { useState, type FormEvent } from 'react';
import {
  MAX_DESCRIPTION,
  MAX_NAME,
  isOfficeCreator,
  type Identity,
  type Office,
  type OfficeUpdate,
} from '@officexr/server/shared';
import { apiFetch, paths } from '../apiOrigin';
import { FIELD } from '../hud/ui/fieldStyles';
import { Switch } from '../hud/ui/Switch';
import { errorMessage } from '../useApi';
import { useMapNames } from '../useMapNames';
import type { SettingsTab } from './Settings';
import { SettingRow, SettingsActionButton } from './SettingsModal';
import { DEFAULT_MAP } from '@officexr/world/scenes';

/** Only the fields that differ, so an untouched map (or one since removed) can't fail the save. */
function changedFields(office: Office, next: Required<OfficeUpdate>): OfficeUpdate {
  const current = {
    name: office.name,
    description: office.description ?? '',
    mapName: office.map_name ?? DEFAULT_MAP,
    debugEnabled: office.debug_enabled,
  };
  return Object.fromEntries(
    Object.entries(next).filter(([key, value]) => value !== current[key as keyof typeof current]),
  );
}

export function OfficeSettingsPane({ office, onSaved }: { office: Office; onSaved: (office: Office) => void }) {
  const { maps, error: mapsError } = useMapNames();
  const [mapName, setMapName] = useState(office.map_name ?? DEFAULT_MAP);
  const [debug, setDebug] = useState(office.debug_enabled);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await apiFetch(paths.office(office.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          changedFields(office, {
            name: form.get('name') as string,
            description: form.get('description') as string,
            mapName,
            debugEnabled: debug,
          }),
        ),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(res, body));
      }
      onSaved(body as Office);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = `mt-1 ${FIELD}`;
  return (
    <form
      onSubmit={submit}
      onReset={() => {
        setMapName(office.map_name ?? DEFAULT_MAP);
        setDebug(office.debug_enabled);
        setError(null);
        setSaved(false);
      }}
      onChange={() => setSaved(false)}
      className="space-y-3"
    >
      <fieldset disabled={busy} className="space-y-3">
        <label className="block font-bold">
          Name
          <input name="name" required maxLength={MAX_NAME} defaultValue={office.name} className={field} />
        </label>
        <label className="block font-bold">
          Description
          <textarea
            name="description"
            maxLength={MAX_DESCRIPTION}
            defaultValue={office.description ?? ''}
            className={field}
          />
        </label>
        <label className="block font-bold">
          Map
          <select value={mapName} onChange={(e) => setMapName(e.target.value)} className={field}>
            {[...new Set([...maps, mapName])].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <SettingRow label="Debug mode (lets you join from several windows)">
          <Switch
            aria-label="Debug mode"
            checked={debug}
            onCheckedChange={(on) => {
              setDebug(on);
              setSaved(false);
            }}
          />
        </SettingRow>
        <div className="flex gap-2">
          <SettingsActionButton primary type="submit">
            Save
          </SettingsActionButton>
          <SettingsActionButton type="reset">Cancel</SettingsActionButton>
        </div>
      </fieldset>
      {saved && (
        <p role="status" className="text-hud-sage-text">
          Saved
        </p>
      )}
      {(error ?? mapsError) && (
        <p role="alert" className="text-hud-rose-text">
          {error ?? mapsError}
        </p>
      )}
    </form>
  );
}

/** The creator's Office tab; none for anyone else. */
export const officeSettingsTabs = (office: Office, me: Identity, onSaved: (office: Office) => void): SettingsTab[] =>
  isOfficeCreator(me, office)
    ? [{ id: 'office', label: 'Office', content: <OfficeSettingsPane office={office} onSaved={onSaved} /> }]
    : [];
