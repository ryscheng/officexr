import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { Identity, Office } from '@officexr/server/shared';
import { paths } from './apiOrigin';
import { Async } from './Async';
import { Home } from './home/Home';
import { recordVisit } from './home/visits';
import { Blocked } from './page/Blocked';
import { fetchFailureDetails, fetchFailureVariant } from './page/fetchFailure';
import { PageShell, Spinner } from './page/PageShell';
import { EnteringOffice } from './room/EnteringOffice';
import { OfficeWorld } from './room/OfficeWorld';
import { SignIn } from './SignIn';
import { clearSignInNext } from './signInNext';
import { useApi } from './useApi';

function Room({ me }: { me: Identity }) {
  // The `/room/:id` route guarantees the id.
  const { id } = useParams() as { id: string };
  const [attempt, setAttempt] = useState(0);
  const office = useApi<Office>(paths.office(id), attempt);
  useEffect(() => {
    if (office.type === 'ready') {
      recordVisit(office.data.id);
    }
  }, [office]);
  // Safari reports pinches as gesture events and zooms the page unless they
  // are cancelled; touch-action alone doesn't stop it over the overlays.
  // overscroll-behavior stops iOS rubber-banding the fixed room.
  useEffect(() => {
    const cancel = (e: Event) => e.preventDefault();
    const { documentElement, body } = document;
    const prevOverscroll = [documentElement.style.overscrollBehavior, body.style.overscrollBehavior];
    documentElement.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    document.addEventListener('gesturestart', cancel);
    document.addEventListener('gesturechange', cancel);
    return () => {
      document.removeEventListener('gesturestart', cancel);
      document.removeEventListener('gesturechange', cancel);
      [documentElement.style.overscrollBehavior, body.style.overscrollBehavior] = prevOverscroll;
    };
  }, []);
  return (
    <div className="fixed inset-0 touch-manipulation overflow-hidden">
      <Async
        state={office}
        loading={<EnteringOffice stage={2} />}
        error={(message, status) => (
          <Blocked
            surface="cover"
            variant={fetchFailureVariant(status)}
            details={fetchFailureDetails(message, status, id)}
            onPrimary={status === 404 ? undefined : () => setAttempt((n) => n + 1)}
          />
        )}
      >
        {(office) => <OfficeWorld key={office.id} office={office} me={me} />}
      </Async>
    </div>
  );
}

function PageNotFound() {
  const { pathname, search } = useLocation();
  return <Blocked variant="pageNotFound" details={`${pathname}${search}`} />;
}

export default function App() {
  const [attempt, setAttempt] = useState(0);
  const me = useApi<Identity>(paths.me, attempt);
  useEffect(() => {
    if (me.type === 'ready') {
      clearSignInNext();
    }
  }, [me.type]);
  if (me.type === 'loading') {
    return window.location.pathname.startsWith('/room/') ? (
      <EnteringOffice stage={1} />
    ) : (
      <PageShell centred>
        <Spinner label="Loading…" />
      </PageShell>
    );
  }
  if (me.type === 'error' && me.status === 401) {
    return <SignIn />;
  }
  if (me.type === 'error') {
    return (
      <Blocked
        variant={fetchFailureVariant(me.status, 'cannotConnect')}
        details={fetchFailureDetails(me.message, me.status)}
        onPrimary={() => setAttempt((n) => n + 1)}
      />
    );
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home me={me} />} />
        <Route path="/room/:id" element={<Room me={me.data} />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
