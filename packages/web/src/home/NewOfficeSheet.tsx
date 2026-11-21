import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, X } from 'lucide-react';
import { MAX_DESCRIPTION, MAX_NAME, type Office } from '@officexr/server/shared';
import { usePortrait } from '@officexr/world/top-down';
import { DEFAULT_MAP } from '@officexr/world/scenes';
import { apiFetch, paths } from '../apiOrigin';
import { errorMessage } from '../useApi';
import { InlineAlert } from '../hud/ui/InlineAlert';
import { FIELD } from '../hud/ui/fieldStyles';
import { Modal } from '../hud/ui/Modal';
import { PanelTitle } from '../hud/ui/Panel';
import { PortraitSheet } from '../hud/ui/PortraitSheet';
import { useEscapeLayer } from '../hud/useEscapeLayer';
import { roomPath } from '../inviteFlag';
import { ErrorNotice } from '../page/ErrorNotice';
import { pageButton } from '../page/pageButton';

const LABEL = 'block px-0.5 text-sm/5 font-medium text-hud-text-2';
const HELP = 'px-0.5 text-sm/5 text-hud-text-2';
const COUNTER_FROM = 80;

function NewOfficeForm({ identified, maps, mapsError, onClose }: { identified: boolean; maps: string[]; mapsError: string | null; onClose: () => void }) {
  const navigate = useNavigate();
  const nameField = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [more, setMore] = useState(false);
  const [picked, setPicked] = useState('');
  const mapName = picked || (maps.includes(DEFAULT_MAP) ? DEFAULT_MAP : (maps[0] ?? DEFAULT_MAP));
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), nameHelp: useId(), description: useId(), map: useId(), more: useId() };

  // The modal moves focus to its panel after this effect, so focus the field once that has run.
  useEffect(() => queueMicrotask(() => nameField.current?.focus()), []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim() === '') {
      setNameError(true);
      nameField.current?.focus();
      return;
    }
    const description = new FormData(event.currentTarget).get('description');
    setBusy(true);
    setFailure(null);
    try {
      const res = await apiFetch(paths.offices, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, mapName }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(res, body));
      }
      navigate(roomPath((body as Office).id, { welcome: true }));
    } catch (err) {
      setFailure((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-2 pb-1">
      {!identified && <p className="text-base/6 text-hud-text-2">Creating an office requires signing in.</p>}
      <fieldset disabled={!identified || busy} className="flex flex-col gap-4 disabled:opacity-60">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.name} className={LABEL}>
            Name
          </label>
          <input
            ref={nameField}
            id={ids.name}
            name="name"
            value={name}
            maxLength={MAX_NAME}
            placeholder="Design studio"
            aria-invalid={nameError}
            aria-describedby={nameError ? `${ids.nameHelp} ${ids.name}-error` : ids.nameHelp}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(false);
            }}
            className={`${FIELD} min-h-12 text-base placeholder:text-hud-text-2/70 ${nameError ? 'border-hud-rose-text' : ''}`}
          />
          {nameError && (
            <p id={`${ids.name}-error`} role="alert" className="px-0.5 text-sm/5 font-medium text-hud-rose-text">
              Give the office a name.
            </p>
          )}
          <p id={ids.nameHelp} className={HELP}>
            {name.length >= COUNTER_FROM ? `${name.length} / ${MAX_NAME}` : `Up to ${MAX_NAME} characters.`}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={more}
          aria-controls={ids.more}
          onClick={() => setMore((open) => !open)}
          className="flex min-h-12 items-center justify-between rounded-[12px] border border-hud-hairline bg-hud-inset px-4 text-base font-semibold focus-visible:outline-2 focus-visible:outline-hud-accent-fill"
        >
          More options
          <ChevronDown aria-hidden className={`size-5 transition-transform ${more ? 'rotate-180' : ''}`} />
        </button>
        <div id={ids.more} hidden={!more} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.description} className={LABEL}>
              Description (optional)
            </label>
            <textarea
              id={ids.description}
              name="description"
              rows={3}
              maxLength={MAX_DESCRIPTION}
              placeholder="Where the team hangs out"
              className={`${FIELD} min-h-18 resize-none text-base placeholder:text-hud-text-2/70`}
            />
            <p className={HELP}>Up to {MAX_DESCRIPTION} characters.</p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.map} className={LABEL}>
              Map
            </label>
            <select id={ids.map} value={mapName} onChange={(e) => setPicked(e.target.value)} className={`${FIELD} min-h-12 text-base`}>
              {[...new Set([...maps, mapName])].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {mapsError && <InlineAlert>{mapsError}</InlineAlert>}
          </div>
        </div>
        {failure !== null && <ErrorNotice title="We could not create the office." text="Check your connection and try again." details={failure} />}
        <div className="flex flex-col gap-2">
          <button type="submit" className={pageButton('primary', 'w-full')}>
            {busy ? 'Creating…' : 'Create office'}
          </button>
          <button type="button" onClick={onClose} className={pageButton('text', 'w-full')}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function NewOfficeSheet({ identified, maps, mapsError, onClose }: { identified: boolean; maps: string[]; mapsError: string | null; onClose: () => void }) {
  const portrait = usePortrait();
  const titleId = useId();
  const form = <NewOfficeForm identified={identified} maps={maps} mapsError={mapsError} onClose={onClose} />;
  useEscapeLayer(portrait, onClose);
  if (portrait) {
    return (
      <>
        <div aria-hidden onClick={onClose} className="fixed inset-0 z-30 bg-hud-backdrop" />
        <PortraitSheet title="New office" label="New office" closeLabel="Close" onClose={onClose} heightPct={86}>
          {form}
        </PortraitSheet>
      </>
    );
  }
  return (
    <Modal labelledBy={titleId} onEscape={onClose} onMouseDown={(e) => e.target === e.currentTarget && onClose()} className="z-40 bg-hud-backdrop" panelClassName="flex max-h-full w-full max-w-110 flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 items-center gap-2 pl-2">
        <PanelTitle id={titleId} className="flex-1 text-xl/6">
          New office
        </PanelTitle>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-hud-text-2 hover:bg-hud-hover hover:text-hud-text focus-visible:outline-2 focus-visible:outline-hud-accent-fill"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      {form}
    </Modal>
  );
}
