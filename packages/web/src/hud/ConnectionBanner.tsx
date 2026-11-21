import { useEffect, useState } from 'react';
import { CheckCircle2, Loader, WifiOff, type LucideIcon } from 'lucide-react';
import type { Store } from '@officexr/sdk';
import { Panel } from './ui/Panel';
import { useConnectionView, type ConnectionView } from './useConnectionView';

const TOASTS: Partial<Record<ConnectionView, { text: string; icon: LucideIcon; tone: 'amber' | 'sage'; spin?: boolean }>> = {
  connecting: { text: 'Connecting…', icon: Loader, tone: 'amber', spin: true },
  reconnecting: { text: 'Reconnecting. You can keep moving.', icon: WifiOff, tone: 'amber' },
  recovered: { text: 'Back online', icon: CheckCircle2, tone: 'sage' },
};

const TONE = { amber: 'text-hud-amber-text', sage: 'text-hud-sage-text' } as const;

const BANNERS: Partial<Record<ConnectionView, { title: string; text: string }>> = {
  cannot: { title: 'Cannot reconnect', text: 'Others can not see you.' },
  offline: { title: 'You are offline', text: 'We keep trying. Your place is saved.' },
};

const ACTION = 'flex h-12 min-w-20 items-center justify-center rounded-hud-control px-4 font-hud-body text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hud-accent';

export function ConnectionBanner({ store, onRetry, onLeave, stallMs }: { store: Store; onRetry: () => void; onLeave: () => void; stallMs?: number }) {
  const { view, online } = useConnectionView(store, stallMs);
  const [trying, setTrying] = useState(false);
  useEffect(() => {
    if (view === 'live' || view === 'recovered') {
      setTrying(false);
    } else if (trying && online) {
      onRetry();
    }
  }, [view, trying, online, onRetry]);
  const toast = TOASTS[view];
  const banner = BANNERS[view];
  return (
    <>
      <div role="status">
        {toast && (
          <div className={`flex items-center gap-2 rounded-hud-control hud-glass border border-hud-edge px-4 py-2 font-hud-body text-sm font-semibold shadow-hud-control ${TONE[toast.tone]}`}>
            <toast.icon aria-hidden className={`size-4 shrink-0 ${toast.spin ? 'motion-safe:animate-spin' : ''}`} />
            {toast.text}
          </div>
        )}
      </div>
      {banner && (
        <Panel role="alert" data-hud-item="Connection banner" className="pointer-events-auto flex w-full max-w-[358px] items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <div className="text-base/6 font-semibold">{banner.title}</div>
            <div className="text-sm/5 text-hud-text-2">{banner.text}</div>
          </div>
          <button
            type="button"
            disabled={trying}
            onClick={() => setTrying(true)}
            className={`${ACTION} bg-hud-accent-fill text-hud-on-accent hover:bg-hud-accent-fill-hover disabled:opacity-60`}
          >
            {trying ? 'Trying…' : 'Retry'}
          </button>
          <button type="button" onClick={onLeave} className={`${ACTION} border border-hud-edge bg-hud-inset text-hud-text hover:bg-hud-hover`}>
            Leave
          </button>
        </Panel>
      )}
    </>
  );
}
