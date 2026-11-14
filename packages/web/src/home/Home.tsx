import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MAX_DESCRIPTION, MAX_NAME, isOfficeCreator, type Identity, type Office } from '@officexr/server/shared';
import { apiFetch, paths } from '../apiOrigin';
import { Async } from '../Async';
import { clearPreviewToken } from '../previewToken';
import { SignInLink } from '../SignIn';
import { DEFAULT_MAP } from '@officexr/world/scenes';
import { errorMessage, useApi, type ApiState } from '../useApi';
import { useMapNames } from '../useMapNames';

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
    <div className="border-t px-3 py-2 text-xs text-gray-500">
      <label className="flex items-center gap-2">
        Map
        <select
          aria-label={`Map for ${office.name}`}
          value={current}
          disabled={busy}
          onChange={(e) => void change(e.target.value)}
          className="rounded border p-1 text-gray-900 disabled:opacity-50"
        >
          {/* Keeps the current map selectable even when the studio no longer lists it. */}
          {[...new Set([...maps, current])].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function OfficeCard({ office: initial, me, maps }: { office: Office; me: Identity | null; maps: string[] }) {
  const [office, setOffice] = useState(initial);
  const canChangeMap = me !== null && isOfficeCreator(me, office);
  return (
    <li className="rounded border">
      <Link to={`/room/${office.id}`} className="block p-3 hover:bg-gray-50">
        <span className="font-medium">{office.name}</span>
        {office.description && <span className="block text-sm text-gray-600">{office.description}</span>}
        {!canChangeMap && <span className="block text-xs text-gray-500">Map: {office.map_name ?? DEFAULT_MAP}</span>}
      </Link>
      {canChangeMap && <OfficeMapPicker office={office} maps={maps} onSaved={setOffice} />}
    </li>
  );
}

function OfficeList({ me, maps }: { me: Identity | null; maps: string[] }) {
  return (
    <Async state={useApi<Office[]>(paths.offices)}>
      {(offices) =>
        offices.length === 0 ? (
          <p className="text-gray-600">No offices yet. Create the first one below.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
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
      navigate(`/room/${(body as Office).id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-8 space-y-3">
      <h2 className="text-lg font-semibold">Create an office</h2>
      {!identified && <p className="text-sm text-gray-600">Creating an office requires signing in.</p>}
      <fieldset disabled={!identified || busy} className="space-y-3">
        <label className="block text-sm">
          Name
          <input name="name" required maxLength={MAX_NAME} className="mt-1 block w-full rounded border p-2" />
        </label>
        <label className="block text-sm">
          Description (optional)
          <textarea name="description" maxLength={MAX_DESCRIPTION} className="mt-1 block w-full rounded border p-2" />
        </label>
        <label className="block text-sm">
          Map
          <select
            required
            value={mapName}
            onChange={(e) => setPicked(e.target.value)}
            className="mt-1 block w-full rounded border p-2"
          >
            {maps.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          Create office
        </button>
      </fieldset>
      {(error ?? mapsError) && (
        <p role="alert" className="text-red-600">
          {error ?? mapsError}
        </p>
      )}
    </form>
  );
}

function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(paths.signOut, { method: 'POST' });
      if (!res.ok) {
        throw new Error(errorMessage(res, await res.json().catch(() => null)));
      }
      clearPreviewToken();
      window.location.assign('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={signOut} disabled={busy} className="underline disabled:opacity-50">
        Sign out
      </button>
      {error && (
        <span role="alert" className="text-red-600">
          {error}
        </span>
      )}
    </>
  );
}

export function Home({ me }: { me: ApiState<Identity> }) {
  const { maps, error: mapsError } = useMapNames();
  const identity = me.type === 'ready' ? me.data : null;
  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <Link to="/" className="text-2xl font-semibold">
          OfficeXR
        </Link>
        {me.type === 'ready' && (
          <span className="flex items-baseline gap-3 text-sm">
            {me.data.name}
            <SignOutButton />
          </span>
        )}
        {me.type === 'error' && (
          <span className="flex items-baseline gap-3 text-sm">
            <span role="alert" className="text-red-600">
              {me.message}
            </span>
            <SignInLink className="rounded bg-black px-3 py-1 text-white" />
          </span>
        )}
      </header>
      <OfficeList me={identity} maps={maps} />
      <CreateOfficeForm identified={identity !== null} maps={maps} mapsError={mapsError} />
    </main>
  );
}
