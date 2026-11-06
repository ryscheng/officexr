import type { OfficeState, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';

type Status = OfficeState['realtime']['status'];

const MESSAGE: Record<Status, { title: string; detail?: string } | null> = {
  live: null,
  replaced: null,
  connecting: { title: 'Connecting…' },
  'snapshot-pending': { title: 'Connecting…' },
  reconnecting: { title: 'Reconnecting…', detail: 'You can keep moving; others will catch up' },
};

const selectStatus = (s: OfficeState) => s.realtime.status;

/** Shown only while the connection is not live; `replaced` is reported by the replaced banner. */
export function ConnectionToast({ store }: { store: Store }) {
  const message = MESSAGE[useStoreSelector(store, selectStatus)];
  return (
    <div role="status" className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2">
      {message && (
        <div className="rounded-hud-control bg-hud-amber px-4 py-2 text-center font-hud-body text-hud-amber-text shadow-hud-control">
          <div className="font-hud-title text-sm tracking-widest uppercase">{message.title}</div>
          {message.detail && <div className="text-xs">{message.detail}</div>}
        </div>
      )}
    </div>
  );
}
