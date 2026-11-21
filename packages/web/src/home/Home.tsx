import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { type Identity } from '@officexr/server/shared';
import { InlineAlert } from '../hud/ui/InlineAlert';
import { BrandLink, PageShell } from '../page/PageShell';
import { pageButton } from '../page/pageButton';
import { signOut } from '../signOut';
import { useMapNames } from '../useMapNames';
import { type ApiState } from '../useApi';
import { NewOfficeSheet } from './NewOfficeSheet';
import { OfficeList } from './OfficeList';
import { canSkipList, markLanded } from './visits';

function useSignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOut();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return { busy, error, run };
}

const NEW_OFFICE = 'New office';

export function Home({ me }: { me: ApiState<Identity> }) {
  const { maps, error: mapsError } = useMapNames();
  const [creating, setCreating] = useState(false);
  const [skipToLast] = useState(canSkipList);
  const signOutState = useSignOut();
  useEffect(markLanded, []);
  const open = () => setCreating(true);
  return (
    <PageShell
      header={
        <header className="mx-auto mb-4 flex w-full max-w-240 items-center justify-between gap-2">
          <BrandLink />
          <div className="flex items-center gap-2">
            {me.type === 'ready' && (
              <button type="button" disabled={signOutState.busy} onClick={() => void signOutState.run()} className={pageButton('text', 'px-3')}>
                Sign out
              </button>
            )}
            <button type="button" onClick={open} className={pageButton('primary', 'phone:hidden')}>
              <Plus aria-hidden className="size-5" />
              {NEW_OFFICE}
            </button>
          </div>
        </header>
      }
    >
      <main className="mx-auto flex w-full max-w-240 flex-1 flex-col gap-4 phone:pb-24">
        {signOutState.error && <InlineAlert>{signOutState.error}</InlineAlert>}
        <div>
          <h1 className="font-hud-title text-2xl/7 font-semibold tracking-tight min-[360px]:text-[28px]/8">Offices</h1>
          <p className="text-base/6 text-hud-text-2">Pick one to walk in.</p>
        </div>
        <section aria-label="Offices">
          <OfficeList skipToLast={skipToLast} />
        </section>
      </main>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 hidden justify-center px-4 pb-[max(1rem,var(--hud-safe-bottom))] phone:flex">
        <button type="button" onClick={open} className={pageButton('primary', 'pointer-events-auto w-full max-w-120 shadow-hud-panel')}>
          <Plus aria-hidden className="size-5" />
          {NEW_OFFICE}
        </button>
      </div>
      {creating && <NewOfficeSheet identified={me.type === 'ready'} maps={maps} mapsError={mapsError} onClose={() => setCreating(false)} />}
    </PageShell>
  );
}
