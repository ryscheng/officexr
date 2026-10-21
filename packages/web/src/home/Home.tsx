import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FilesystemMapStorage } from '@officexr/world/scenes';
import type { Identity, Office } from '../../server/api';
import { Async } from '../Async';
import { useApi, type ApiState } from '../useApi';

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
                  <span className="block text-xs text-gray-500">Map: {office.map_name ?? 'default'}</span>
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
  const [maps, setMaps] = useState<string[]>([]);
  const [mapName, setMapName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    new FilesystemMapStorage()
      .list()
      .then((list) => {
        setMaps(list.map((m) => m.name));
        setMapName((current) => current || (list.some((m) => m.name === 'default') ? 'default' : (list[0]?.name ?? '')));
      })
      .catch((err: Error) => setError(err.message));
  }, []);

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
        throw new Error(body?.error ?? `HTTP ${res.status}`);
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
      {!identified && <p className="text-sm text-gray-600">Creating an office requires being identified via Tailscale.</p>}
      <fieldset disabled={!identified || busy} className="space-y-3">
        <label className="block text-sm">
          Name
          <input name="name" required maxLength={100} className="mt-1 block w-full rounded border p-2" />
        </label>
        <label className="block text-sm">
          Description (optional)
          <textarea name="description" maxLength={500} className="mt-1 block w-full rounded border p-2" />
        </label>
        <label className="block text-sm">
          Map
          <select
            required
            value={mapName}
            onChange={(e) => setMapName(e.target.value)}
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
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

export function Home({ me }: { me: ApiState<Identity> }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <Link to="/" className="text-2xl font-semibold">
          OfficeXR
        </Link>
        {me.type === 'ready' && <span className="text-sm">{me.data.name}</span>}
        {me.type === 'error' && (
          <span role="alert" className="text-sm text-red-600">
            {me.message}
          </span>
        )}
      </header>
      <OfficeList />
      <CreateOfficeForm identified={me.type === 'ready'} />
    </main>
  );
}
