import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Identity, Office, OfficeUpdate } from '../../server/api';
import { MAX_DESCRIPTION, MAX_NAME } from '../../server/officeLimits';
import { Dialog } from '../Dialog';
import { errorMessage } from '../useApi';
import { useMapNames } from '../useMapNames';
import { closeToWorld } from './closeToWorld';
import { RoomMenuItem } from './RoomMenu';
import { DEFAULT_MAP } from './withDefaultMap';

/** Only the fields that differ, so an untouched map (or one since removed) can't fail the save. */
function changedFields(office: Office, next: Required<OfficeUpdate>): OfficeUpdate {
  const current = {
    name: office.name,
    description: office.description ?? '',
    mapName: office.map_name ?? DEFAULT_MAP,
    debugEnabled: office.debug_enabled,
  };
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== current[key as keyof typeof current]));
}

function SettingsForm({ office, onSaved, onClose }: { office: Office; onSaved: (office: Office) => void; onClose: () => void }) {
  const { maps, error: mapsError } = useMapNames();
  const [mapName, setMapName] = useState(office.map_name ?? DEFAULT_MAP);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A save that lands after the dialog closed must not close or steal focus from whatever opened since.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/offices/${encodeURIComponent(office.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changedFields(office, {
          name: form.get('name') as string,
          description: form.get('description') as string,
          mapName,
          debugEnabled: form.has('debugEnabled'),
        })),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(res, body));
      }
      onSaved(body as Office);
      if (mounted.current) {
        onClose();
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">
          Name
          <input name="name" required maxLength={MAX_NAME} defaultValue={office.name} className="mt-1 block w-full rounded border p-2" />
        </label>
        <label className="block">
          Description
          <textarea
            name="description"
            maxLength={MAX_DESCRIPTION}
            defaultValue={office.description ?? ''}
            className="mt-1 block w-full rounded border p-2"
          />
        </label>
        <label className="block">
          Map
          <select value={mapName} onChange={(e) => setMapName(e.target.value)} className="mt-1 block w-full rounded border p-2">
            {[...new Set([...maps, mapName])].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input name="debugEnabled" type="checkbox" defaultChecked={office.debug_enabled} />
          Debug mode (lets you join from several windows)
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border px-4 py-2">
            Cancel
          </button>
          <button type="submit" className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
            Save
          </button>
        </div>
      </fieldset>
      {(error ?? mapsError) && (
        <p role="alert" className="text-red-600">
          {error ?? mapsError}
        </p>
      )}
    </form>
  );
}

export const isOfficeCreator = (me: Identity, office: Office) => me.login === office.created_by_login;

/** The creator's menu entry for the Office settings dialog; renders nothing for anyone else. */
export function OfficeSettingsMenuItem({ office, me, onSelect }: { office: Office; me: Identity; onSelect: () => void }) {
  return isOfficeCreator(me, office) ? <RoomMenuItem onSelect={onSelect}>Office settings…</RoomMenuItem> : null;
}

/** The creator's Office settings dialog; renders nothing for anyone else. */
export function OfficeSettingsDialog({
  office,
  me,
  onSaved,
  onClose,
}: {
  office: Office;
  me: Identity;
  onSaved: (office: Office) => void;
  onClose: () => void;
}) {
  if (!isOfficeCreator(me, office)) {
    return null;
  }
  const close = closeToWorld(onClose);
  return (
    <Dialog title="Office settings" onClose={close}>
      <SettingsForm office={office} onSaved={onSaved} onClose={close} />
    </Dialog>
  );
}
