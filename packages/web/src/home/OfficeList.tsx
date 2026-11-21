import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { type Office } from '@officexr/server/shared';
import { paths } from '../apiOrigin';
import { Async } from '../Async';
import { roomPath } from '../inviteFlag';
import { Panel } from '../hud/ui/Panel';
import { FIELD } from '../hud/ui/fieldStyles';
import { ErrorNotice } from '../page/ErrorNotice';
import { pageButton } from '../page/pageButton';
import { useApi } from '../useApi';
import { OfficeThumbnail } from './OfficeThumbnail';
import { lastVisitedId, lastVisitedLabel, readVisits, sortOffices } from './visits';

const SEARCH_FROM = 4;
const officeGrid = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4';

function OfficeCard({ office, visited }: { office: Office; visited: string | null }) {
  return (
    <li>
      <Panel className="group h-full overflow-hidden transition-transform duration-150 focus-within:-translate-y-0.5 hover:-translate-y-0.5">
        <Link
          to={roomPath(office.id)}
          title={office.description ? `${office.name}\n${office.description}` : office.name}
          className="flex h-full flex-col outline-none focus-visible:ring-2 focus-visible:ring-hud-accent-fill focus-visible:ring-inset"
        >
          <span className="block p-3 pb-0">
            <OfficeThumbnail seed={office.id} className="block h-26 w-full rounded-[16px] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]" />
          </span>
          <span className="flex flex-1 flex-col gap-1 p-4">
            <span className="truncate text-lg/6 font-semibold tracking-tight">{office.name}</span>
            {office.description && <span className="line-clamp-2 text-sm/5 text-hud-text-2">{office.description}</span>}
            {visited && (
              <span className="mt-auto pt-2">
                <span className="inline-block rounded-full bg-hud-inset px-2 py-0.5 text-xs/4 font-medium text-hud-text-2">{visited}</span>
              </span>
            )}
          </span>
        </Link>
      </Panel>
    </li>
  );
}

function OfficeListSkeleton() {
  return (
    <ul aria-hidden className={officeGrid}>
      {[0, 1].map((i) => (
        <li key={i} className="h-56 animate-pulse rounded-hud-panel border border-hud-edge bg-hud-surface" />
      ))}
    </ul>
  );
}

function Offices({ offices }: { offices: Office[] }) {
  const [query, setQuery] = useState('');
  const visits = useMemo(readVisits, []);
  const sorted = useMemo(() => sortOffices(offices, visits), [offices, visits]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? sorted.filter((o) => `${o.name} ${o.description ?? ''}`.toLowerCase().includes(needle)) : sorted;
  const now = new Date();

  if (offices.length === 0) {
    return (
      <Panel className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <OfficeThumbnail seed="empty" className="h-24 w-44 rounded-hud-control opacity-80" />
        <p className="text-base/6 text-hud-text-2">No offices yet. Create the first one to get your team in.</p>
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {offices.length >= SEARCH_FROM && (
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-hud-text-2" />
          <input
            type="search"
            aria-label="Search offices"
            placeholder="Search offices"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${FIELD} min-h-12 pl-10 text-base`}
          />
        </div>
      )}
      {shown.length === 0 ? (
        <p className="py-6 text-center text-base/6 text-hud-text-2">No offices match.</p>
      ) : (
        <ul className={officeGrid}>
          {shown.map((office) => (
            <OfficeCard key={office.id} office={office} visited={lastVisitedLabel(visits[office.id], now)} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function OfficeList({ skipToLast }: { skipToLast: boolean }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <Async
      state={useApi<Office[]>(paths.offices, attempt)}
      loading={<OfficeListSkeleton />}
      error={(message, status) => (
        <ErrorNotice
          tone={status === undefined ? 'amber' : 'rose'}
          title="We could not load the offices."
          text="Check your connection and try again."
          details={message}
        >
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={pageButton('primary', 'w-full sm:w-auto sm:self-start')}>
            Try again
          </button>
        </ErrorNotice>
      )}
    >
      {(offices) => {
        const last = skipToLast ? lastVisitedId(readVisits()) : null;
        return last !== null && offices.some((o) => o.id === last) ? <Navigate to={roomPath(last)} replace /> : <Offices offices={offices} />;
      }}
    </Async>
  );
}
