import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ExternalLink, Undo2 } from 'lucide-react';
import { MAX_DESCRIPTION, MAX_NAME, type Office, type OfficeUpdate } from '@officexr/server/shared';
import { DEFAULT_MAP } from '@officexr/world/scenes';
import { apiFetch, paths } from '../../apiOrigin';
import { errorMessage } from '../../useApi';
import { useMapNames } from '../../useMapNames';
import { Button } from '../ui/Button';
import { FIELD } from '../ui/fieldStyles';
import { Modal } from '../ui/Modal';
import { PanelTitle } from '../ui/Panel';
import { Switch } from '../ui/Switch';
import { setShowPerformance, useShowPerformance } from '../../perf/perfSetting';
import { SettingRow } from './parts';

export const STUDIO_URL = 'https://officexr.karibalabs.co/studio/';
const UNDO_SECONDS = 5;

const subscribeOnline = (notify: () => void) => {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
};
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

/** Only the fields that differ, so an untouched map (or one since removed) can't fail the save. */
function changedFields(office: Office, next: Required<Omit<OfficeUpdate, 'debugEnabled'>>): OfficeUpdate {
  const current = { name: office.name, description: office.description ?? '', mapName: office.map_name ?? DEFAULT_MAP };
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== current[key as keyof typeof current]));
}

async function patchOffice(officeId: string, fields: OfficeUpdate): Promise<Office> {
  const res = await apiFetch(paths.office(officeId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(errorMessage(res, body));
  }
  return body as Office;
}

function ConfirmMapChange({ officeName, onConfirm, onCancel }: { officeName: string; onConfirm: () => void; onCancel: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => cancel.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);
  return createPortal(
    <Modal labelledBy="confirm-map-title" onEscape={onCancel} className="z-50 bg-hud-backdrop" panelClassName="flex w-full max-w-[340px] flex-col gap-3 p-4">
      <PanelTitle id="confirm-map-title" className="text-xl">
        Change the map for everyone in {officeName}?
      </PanelTitle>
      <Button tone="primary" className="min-h-12 w-full" onClick={onConfirm}>
        Change map
      </Button>
      <Button ref={cancel} className="min-h-12 w-full" onClick={onCancel}>
        Cancel
      </Button>
    </Modal>,
    document.body,
  );
}

function UndoToast({ onUndo, onExpire }: { onUndo: () => void; onExpire: () => void }) {
  const [left, setLeft] = useState(UNDO_SECONDS);
  useEffect(() => {
    const timer = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left <= 0) {
      onExpire();
    }
  }, [left, onExpire]);
  return (
    <div role="status" className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 rounded-hud-panel border border-hud-edge bg-hud-panel-solid px-4 shadow-hud-panel">
      <span className="text-base font-semibold">Map changed.</span>
      <button type="button" onClick={onUndo} className="flex min-h-12 items-center gap-2 rounded-lg px-2 text-base font-semibold text-hud-accent-edge focus-visible:outline-2 focus-visible:outline-hud-accent">
        <Undo2 aria-hidden className="size-4" />
        Undo ({Math.max(left, 0)} s)
      </button>
    </div>
  );
}

function StudioLink({ coarse }: { coarse: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-hud-surface p-2 shadow-[0_0_0_0.5px_var(--color-hud-hairline)]">
      <a
        href={STUDIO_URL}
        target="_blank"
        rel="noopener"
        className="flex min-h-14 items-center justify-between gap-3 rounded-hud-control border border-hud-edge px-4 py-2 hover:bg-hud-surface-hover focus-visible:outline-2 focus-visible:outline-hud-accent"
      >
        <span>
          <span className="block text-base font-semibold">Open studio</span>
          <span className="block text-sm text-hud-text-2">Edit maps and objects</span>
        </span>
        <ExternalLink aria-hidden className="size-5 shrink-0" />
      </a>
      <p className="px-2 text-sm text-hud-text-2">
        {coarse ? 'The studio works best on a large screen.' : 'Opens in a new tab. If you are not on the studio list, it tells you.'}
      </p>
    </div>
  );
}

export function OfficePage({ office, coarse, onSaved }: { office: Office; coarse: boolean; onSaved: (office: Office) => void }) {
  const { maps } = useMapNames();
  const online = useOnline();
  const [mapName, setMapName] = useState(office.map_name ?? DEFAULT_MAP);
  const [advanced, setAdvanced] = useState(false);
  const showPerformance = useShowPerformance();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<OfficeUpdate | null>(null);
  const [undo, setUndo] = useState<{ previous: string } | null>(null);
  const expireUndo = useCallback(() => setUndo(null), []);

  const send = async (fields: OfficeUpdate): Promise<Office | null> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await patchOffice(office.id, fields);
      onSaved(updated);
      return updated;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const commit = async (fields: OfficeUpdate) => {
    const previous = office.map_name ?? DEFAULT_MAP;
    if ((await send(fields)) === null) {
      return;
    }
    if (fields.mapName !== undefined) {
      setUndo({ previous });
    } else {
      setSaved(true);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = changedFields(office, { name: form.get('name') as string, description: form.get('description') as string, mapName });
    if (fields.mapName !== undefined) {
      setConfirm(fields);
    } else {
      void commit(fields);
    }
  };

  const undoMap = async () => {
    if (!undo) {
      return;
    }
    const { previous } = undo;
    setUndo(null);
    if ((await send({ mapName: previous })) !== null) {
      setMapName(previous);
    }
  };

  const field = `mt-1 min-h-12 ${FIELD}`;
  const label = 'block text-sm font-semibold text-hud-text-2';
  return (
    <>
      {undo && <UndoToast onUndo={() => void undoMap()} onExpire={expireUndo} />}
      <form onSubmit={submit} onChange={() => setSaved(false)} className="flex flex-col gap-3">
        <fieldset disabled={busy} className="flex flex-col gap-3">
          <label className={label}>
            Name
            <input name="name" required maxLength={MAX_NAME} defaultValue={office.name} className={field} />
          </label>
          <label className={label}>
            Description
            <input name="description" maxLength={MAX_DESCRIPTION} defaultValue={office.description ?? ''} className={field} />
          </label>
          <div>
            <label className={label}>
              Map
              <select value={mapName} onChange={(e) => setMapName(e.target.value)} className={field}>
                {[...new Set([...maps, mapName])].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-1 text-sm text-hud-text-2">Changing the map changes it for everyone.</p>
          </div>
          <Button type="submit" tone="primary" className="min-h-12 w-full" disabled={!online}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </fieldset>
        {!online && <p className="text-sm text-hud-text-2">You are offline.</p>}
        <p role="status" className="text-sm text-hud-sage-text empty:hidden">
          {saved ? 'Saved' : ''}
        </p>
        {error && (
          <p role="alert" className="rounded-hud-control border border-hud-rose-text/30 bg-hud-rose px-3 py-2 text-sm text-hud-rose-text">
            <strong>We could not save.</strong> Check your connection and try again.
            <details className="mt-1">
              <summary className="cursor-pointer">Details</summary>
              {error}
            </details>
          </p>
        )}
      </form>
      <StudioLink coarse={coarse} />
      <div>
        <button
          type="button"
          aria-expanded={advanced}
          aria-controls="office-advanced"
          onClick={() => setAdvanced((a) => !a)}
          className="flex min-h-12 w-full items-center justify-between rounded-xl border border-hud-hairline px-4 text-sm font-semibold text-hud-text-2 focus-visible:outline-2 focus-visible:outline-hud-accent"
        >
          Advanced
          <ChevronDown aria-hidden className={`size-5 transition-transform ${advanced ? 'rotate-180' : ''}`} />
        </button>
        {advanced && (
          <div id="office-advanced" className="mt-2">
            <SettingRow label="Debug mode" hint="Lets you join from several windows.">
              <Switch aria-label="Debug mode" checked={office.debug_enabled} disabled={busy} onCheckedChange={(on) => void send({ debugEnabled: on })} />
            </SettingRow>
            <SettingRow label="Show performance" hint="Shows frame rate and draw calls in a corner of the screen.">
              <Switch aria-label="Show performance" checked={showPerformance} onCheckedChange={setShowPerformance} />
            </SettingRow>
          </div>
        )}
      </div>
      {confirm && (
        <ConfirmMapChange
          officeName={office.name}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const fields = confirm;
            setConfirm(null);
            void commit(fields);
          }}
        />
      )}
    </>
  );
}
