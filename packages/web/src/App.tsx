import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom';
import type { Identity, Office } from '../server/api';
import { WorldLoadingScreen } from '@officexr/world/react';
import { Async } from './Async';
import { Home } from './home/Home';
import { OfficeWorld } from './room/OfficeWorld';
import { useApi } from './useApi';

const roomLoading = <WorldLoadingScreen step="Loading office…" />;

function Room({ me }: { me: Identity }) {
  const { id } = useParams();
  return (
    <div className="relative h-screen">
      <Async state={useApi<Office>(`/api/offices/${id}`)} loading={roomLoading}>
        {(office) => <OfficeWorld key={office.id} office={office} me={me} />}
      </Async>
    </div>
  );
}

export default function App() {
  const me = useApi<Identity>('/api/me');
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home me={me} />} />
        <Route
          path="/room/:id"
          element={
            <Async state={me} loading={roomLoading}>
              {(identity) => <Room me={identity} />}
            </Async>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
