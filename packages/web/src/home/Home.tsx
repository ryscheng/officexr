import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Identity, Office } from '../../server/api';
import { MAX_DESCRIPTION, MAX_NAME } from '../../server/officeLimits';
import { Async } from '../Async';
import { SignInLink } from '../SignIn';
import { DEFAULT_MAP } from '../room/withDefaultMap';
import { errorMessage, useApi, type ApiState } from '../useApi';
import { useMapNames } from '../useMapNames';

function OfficeList() {
  return (
    <Async state={useApi<Office[]>('/api/offices')}>
      {(offices) =>
        offices.length === 0 ? (
          <p className="text-gray-600">No offices yet. Create the first one below.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {offices.map((office) => (
              <li key={office.id}>
                <Link to={`/room/${office.id}`} className="block rounded border p-3 hover:bg-gray-50">
                  <span className="font-medium">{office.name}</span>
                  {office.description && <span className="block text-sm text-gray-600">{office.description}</span>}
                  <span className="block text-xs text-gray-500">Map: {office.map_name ?? DEFAULT_MAP}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      }
    </Async>
  );
}

function CreateOfficeForm({ identified }: { identified: boolean }) {
  const navigate = useNavigate();
  const { maps, error: mapsError } = useMapNames();
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
      const res = await fetch('/api/offices', {
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
      const res = await fetch('/auth/logout', { method: 'POST' });
      if (!res.ok) {
        throw new Error(errorMessage(res, await res.json().catch(() => null)));
      }
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
      <OfficeList />
      <CreateOfficeForm identified={me.type === 'ready'} />
    </main>
  );
}
