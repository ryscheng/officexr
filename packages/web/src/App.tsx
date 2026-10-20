import type { ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import type { Identity, Office } from '../server/api';
import { OfficeWorld } from './room/OfficeWorld';
import { useApi, type ApiState } from './useApi';

function Async<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  return state.type === 'loading' ? (
    <p>Loading…</p>
  ) : state.type === 'error' ? (
    <p role="alert" className="text-red-600">
      {state.message}
    </p>
  ) : (
    children(state.data)
  );
}

function Offices() {
  return (
    <Async state={useApi<Office[]>('/api/offices')}>
      {(offices) => (
        <ul className="space-y-2">
          {offices.map((office) => (
            <li key={office.id}>
              <Link to={`/room/${office.id}`} className="font-medium underline">
                {office.name}
              </Link>
              {office.description && <p className="text-sm text-gray-600">{office.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </Async>
  );
}

function Room({ me }: { me: Identity }) {
  const { id } = useParams();
  return (
    <div className="h-screen">
      <Async state={useApi<Office>(`/api/offices/${id}`)}>
        {(office) => <OfficeWorld key={office.id} office={office} me={me} />}
      </Async>
    </div>
  );
}

function Home({ me }: { me: ApiState<Identity> }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6 flex items-baseline justify-between">
        <Link to="/" className="text-2xl font-semibold">
          OfficeXR
        </Link>
        {me.type === 'ready' && <span className="text-sm">{me.data.name}</span>}
      </header>
      <Async state={me}>{() => <Offices />}</Async>
    </main>
  );
}

export default function App() {
  const me = useApi<Identity>('/api/me');
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home me={me} />} />
        <Route path="/room/:id" element={<Async state={me}>{(identity) => <Room me={identity} />}</Async>} />
      </Routes>
    </BrowserRouter>
  );
}
