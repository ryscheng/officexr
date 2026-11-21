import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Map as MapIcon, Plus } from 'lucide-react';
import { MAX_DESCRIPTION, MAX_NAME, canEditOffice, type Identity, type Office } from '@officexr/server/shared';
import { apiFetch, paths } from '../apiOrigin';
import { Async } from '../Async';
import { roomPath } from '../inviteFlag';
import { signOut } from '../signOut';
import { DEFAULT_MAP } from '@officexr/world/scenes';
import { errorMessage, useApi, type ApiState } from '../useApi';
import { useMapNames } from '../useMapNames';
import { Button } from '../hud/ui/Button';
import { FIELD } from '../hud/ui/fieldStyles';
import { InlineAlert } from '../hud/ui/InlineAlert';
import { Panel, PanelTitle } from '../hud/ui/Panel';
import { BrandLink, PageShell } from '../page/PageShell';
import { OfficeThumbnail } from './OfficeThumbnail';

const LABEL = 'block px-0.5 text-[13px] font-medium text-hud-text-2';

/** Lets the office's creator switch its map from the office list; saves on change. */
function OfficeMapPicker({ office, maps, onSaved }: { office: Office; maps: string[]; onSaved: (office: Office) => void }) {
  const current = office.map_name ?? DEFAULT_MAP;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async (mapName: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(paths.office(office.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapName }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(res, body));
      }
      onSaved(body as Office);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-hud-separator px-4 py-2.5">
      <div className="flex items-center gap-2 text-xs text-hud-text-2">
        <MapIcon aria-hidden className="size-3.5 shrink-0" />
        <select
          aria-label={`Map for ${office.name}`}
          value={current}
          disabled={busy}
          onChange={(e) => void change(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-hud-hairline bg-hud-inset px-2 py-1 text-xs text-hud-text disabled:opacity-50"
        >
          {/* Keeps the current map selectable even when the studio no longer lists it. */}
          {[...new Set([...maps, current])].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {error && <InlineAlert className="mt-2 text-xs">{error}</InlineAlert>}
    </div>
  );
}

function MapChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-hud-inset px-2 py-0.5 text-[11px] font-medium text-hud-text-2">
      <MapIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">Map: {name}</span>
    </span>
  );
}

function OfficeCard({ office: initial, me, maps }: { office: Office; me: Identity | null; maps: string[] }) {
  const [office, setOffice] = useState(initial);
  const canChangeMap = canEditOffice(me);
  return (
    <li>
      <Panel className="group flex h-full flex-col overflow-hidden transition-transform duration-150 hover:-translate-y-0.5 focus-within:-translate-y-0.5">
        <Link
          to={`/room/${office.id}`}
          className="flex flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-hud-accent focus-visible:ring-inset"
        >
          <span className="block p-2 pb-0">
            <OfficeThumbnail seed={office.id} className="block h-32 w-full rounded-[16px] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]" />
          </span>
          <span className="flex flex-1 flex-col gap-1.5 p-4">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{office.name}</span>
              <ArrowRight
                aria-hidden
                className="size-4 shrink-0 text-hud-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              />
            </span>
            {office.description && <span className="line-clamp-2 text-sm text-hud-text-2">{office.description}</span>}
            {!canChangeMap && (
              <span className="mt-auto pt-1">
                <MapChip name={office.map_name ?? DEFAULT_MAP} />
              </span>
            )}
          </span>
        </Link>
        {canChangeMap && <OfficeMapPicker office={office} maps={maps} onSaved={setOffice} />}
      </Panel>
    </li>
  );
}

const officeGrid = 'grid gap-4 sm:grid-cols-2';

function OfficeListSkeleton() {
  return (
    <ul aria-hidden className={officeGrid}>
      {[0, 1].map((i) => (
        <li key={i} className="h-56 animate-pulse rounded-hud-panel border border-hud-edge bg-hud-surface" />
      ))}
    </ul>
  );
}

function OfficeList({ me, maps }: { me: Identity | null; maps: string[] }) {
  return (
    <Async state={useApi<Office[]>(paths.offices)} loading={<OfficeListSkeleton />}>
      {(offices) =>
        offices.length === 0 ? (
          <Panel className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <OfficeThumbnail seed="empty" className="h-24 w-44 rounded-hud-control opacity-80" />
            <p className="text-sm text-hud-text-2">No offices yet. Create the first one to get your team in.</p>
          </Panel>
        ) : (
          <ul className={officeGrid}>
            {offices.map((office) => (
              <OfficeCard key={office.id} office={office} me={me} maps={maps} />
            ))}
          </ul>
        )
      }
    </Async>
  );
}

function CreateOfficeForm({
  identified,
  maps,
  mapsError,
}: {
  identified: boolean;
  maps: string[];
  mapsError: string | null;
}) {
  const navigate = useNavigate();
  const [picked, setPicked] = useState('');
  const mapName = picked || (maps.includes(DEFAULT_MAP) ? DEFAULT_MAP : (maps[0] ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { title: useId(), name: useId(), description: useId(), map: useId() };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(paths.offices, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), description: form.get('description'), mapName }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(errorMessage(res, body));
      }
      navigate(roomPath((body as Office).id, { welcome: true }));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Panel className="p-5 lg:sticky lg:top-6">
      <form onSubmit={submit} aria-labelledby={ids.title} className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-hud-accent/12 text-hud-accent">
            <Plus aria-hidden className="size-4" />
          </span>
          <PanelTitle id={ids.title} className="text-[15px]">
            Create an office
          </PanelTitle>
        </div>
        {!identified && <p className="text-sm text-hud-text-2">Creating an office requires signing in.</p>}
        <fieldset disabled={!identified || busy} className="space-y-4 disabled:opacity-60">
          <div className="space-y-1.5">
            <label htmlFor={ids.name} className={LABEL}>
              Name
            </label>
            <input id={ids.name} name="name" required maxLength={MAX_NAME} placeholder="Design studio" className={`${FIELD} text-sm placeholder:text-hud-text-2/70`} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={ids.description} className={LABEL}>
              Description (optional)
            </label>
            <textarea
              id={ids.description}
              name="description"
              rows={2}
              maxLength={MAX_DESCRIPTION}
              placeholder="Where the team hangs out"
              className={`${FIELD} resize-none text-sm placeholder:text-hud-text-2/70`}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={ids.map} className={LABEL}>
              Map
            </label>
            <select id={ids.map} required value={mapName} onChange={(e) => setPicked(e.target.value)} className={`${FIELD} text-sm`}>
              {maps.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" tone="primary" className="w-full">
            Create office
          </Button>
        </fieldset>
        {(error ?? mapsError) && <InlineAlert>{error ?? mapsError}</InlineAlert>}
      </form>
    </Panel>
  );
}

function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      {error && (
        <span role="alert" className="text-xs text-hud-rose-text">
          {error}
        </span>
      )}
      <Button tone="ghost" size="sm" onClick={submit} disabled={busy}>
        Sign out
      </Button>
    </>
  );
}

/** The signed-in user's chip: initial, name, sign out. */
function UserChip({ me }: { me: Identity }) {
  return (
    <span className="hud-glass flex min-w-0 items-center gap-2 rounded-full border border-hud-edge py-1 pr-1 pl-1 shadow-hud-control">
      <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-hud-avatar text-xs font-bold uppercase">
        {me.name.charAt(0)}
      </span>
      <span className="min-w-0 truncate text-sm font-semibold max-sm:hidden">{me.name}</span>
      <SignOutButton />
    </span>
  );
}

export function Home({ me }: { me: ApiState<Identity> }) {
  const { maps, error: mapsError } = useMapNames();
  const identity = me.type === 'ready' ? me.data : null;
  return (
    <PageShell
      header={
        <header className="mb-10 flex items-center justify-between gap-4">
          <BrandLink />
          {me.type === 'ready' && <UserChip me={me.data} />}
        </header>
      }
    >
      <main className="flex flex-1 flex-col gap-6">
        <div>
          <h1 className="font-hud-title text-4xl font-semibold tracking-tight">Pick an office</h1>
          <p className="mt-1 text-sm text-hud-text-2">Walk in, see who's around, and talk by walking up to them.</p>
        </div>
        {/* The heading spans both columns, so the form's top lines up with the first row of cards. */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-label="Offices">
            <OfficeList me={identity} maps={maps} />
          </section>
          <CreateOfficeForm identified={identity !== null} maps={maps} mapsError={mapsError} />
        </div>
      </main>
    </PageShell>
  );
}
