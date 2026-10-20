import type { ReactNode } from 'react';
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
import type { Office } from '../server/api';
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

function Room() {
  const { id } = useParams();
  return <Async state={useApi<Office>(`/api/offices/${id}`)}>{(office) => <h2 className="text-xl">{office.name}</h2>}</Async>;
}

export default function App() {
  const me = useApi<{ login: string; name: string }>('/api/me');
  return (
    <BrowserRouter>
      <main className="mx-auto max-w-2xl p-6">
        <header className="mb-6 flex items-baseline justify-between">
          <Link to="/" className="text-2xl font-semibold">
            OfficeXR
          </Link>
          {me.type === 'ready' && <span className="text-sm">{me.data.name}</span>}
        </header>
        <Async state={me}>
          {() => (
            <Routes>
              <Route path="/" element={<Offices />} />
              <Route path="/room/:id" element={<Room />} />
            </Routes>
          )}
        </Async>
      </main>
    </BrowserRouter>
  );
}
