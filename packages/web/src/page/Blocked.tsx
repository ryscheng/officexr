import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppWindow, SearchX, TriangleAlert, Unplug, WifiOff, type LucideIcon } from 'lucide-react';
import { pageButton } from './pageButton';
import { PageShell } from './PageShell';

export type BlockedVariant = 'officeNotFound' | 'pageNotFound' | 'offline' | 'cannotConnect' | 'otherWindow' | 'crashed';

type Spec = {
  icon: LucideIcon;
  tone: 'rose' | 'amber';
  title: string;
  text: string;
  primary: string;
  backLabel: string | null;
};

const SPECS: Record<BlockedVariant, Spec> = {
  officeNotFound: {
    icon: SearchX,
    tone: 'rose',
    title: 'We can not find this office',
    text: 'The link may be old, or the office was removed.',
    primary: 'Back to offices',
    backLabel: null,
  },
  pageNotFound: {
    icon: SearchX,
    tone: 'rose',
    title: 'This page does not exist',
    text: 'Check the address, or go to the list of offices.',
    primary: 'Go to offices',
    backLabel: null,
  },
  offline: {
    icon: WifiOff,
    tone: 'amber',
    title: 'You are offline',
    text: 'Check your connection. Your place is saved.',
    primary: 'Try again',
    backLabel: 'Back to offices',
  },
  cannotConnect: {
    icon: Unplug,
    tone: 'amber',
    title: 'We can not reach the office',
    text: 'The connection to the office did not work. This is usually a short problem.',
    primary: 'Try again',
    backLabel: 'Back to offices',
  },
  otherWindow: {
    icon: AppWindow,
    tone: 'amber',
    title: 'You are in this office in another window',
    text: 'Only one window can be in an office at a time. Use this window to take over.',
    primary: 'Use this window',
    backLabel: 'Back to offices',
  },
  crashed: {
    icon: TriangleAlert,
    tone: 'rose',
    title: 'The office view stopped',
    text: 'Something went wrong while drawing the office. Try again.',
    primary: 'Try again',
    backLabel: 'Back to offices',
  },
};

const TONE = { rose: 'bg-hud-rose text-hud-rose-text', amber: 'bg-hud-amber text-hud-amber-text' } as const;

/** `page` fills the page; `cover` hides the world behind the wallpaper; `dim` leaves the world dimmed behind. */
export type BlockedSurface = 'page' | 'cover' | 'dim';

export type BlockedProps = {
  variant: BlockedVariant;
  details?: string;
  onPrimary?: () => void | Promise<unknown>;
  surface?: BlockedSurface;
};

function Card({ variant, details, onPrimary }: Omit<BlockedProps, 'surface'>) {
  const spec = SPECS[variant];
  const Icon = spec.icon;
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async () => {
    if (!onPrimary) {
      return;
    }
    setBusy(true);
    try {
      await onPrimary();
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };
  const back = (
    <a href="/" className={pageButton(onPrimary ? 'secondary' : 'primary', 'w-full sm:w-auto')}>
      {spec.backLabel ?? spec.primary}
    </a>
  );
  return (
    <div className="flex w-full max-w-100 flex-col items-center gap-5 text-center">
      <span aria-hidden className={`flex size-16 items-center justify-center rounded-[18px] shadow-hud-control [&>svg]:size-8 ${TONE[spec.tone]}`}>
        <Icon />
      </span>
      <div className="flex flex-col gap-2">
        <h1 role="alert" className="font-hud-title text-2xl/7 font-semibold tracking-tight text-balance text-hud-text [overflow-wrap:anywhere] min-[360px]:text-[28px]/8">
          {spec.title}
        </h1>
        <p className="text-base/6 text-hud-text-2">{spec.text}</p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:flex-row-reverse sm:justify-center">
        {onPrimary ? (
          <button type="button" disabled={busy} onClick={() => void run()} className={pageButton('primary', 'w-full sm:w-auto')}>
            {busy ? 'Trying…' : spec.primary}
          </button>
        ) : null}
        {onPrimary ? (spec.backLabel ? back : null) : back}
      </div>
      {details ? (
        <details className="w-full text-left">
          <summary className={pageButton('text', 'w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>Details</summary>
          <pre className="mt-2 rounded-hud-control bg-hud-inset p-3 font-mono text-sm/5 whitespace-pre-wrap text-hud-text [overflow-wrap:anywhere]">{details}</pre>
        </details>
      ) : null}
    </div>
  );
}

function Layer({ surface, children }: { surface: Exclude<BlockedSurface, 'page'>; children: ReactNode }) {
  const bg = surface === 'dim' ? 'bg-hud-backdrop backdrop-blur-sm' : '[background:var(--hud-wallpaper)]';
  return (
    <div className={`absolute inset-0 z-40 overflow-y-auto overflow-x-hidden font-hud-body text-hud-text ${bg}`}>
      <div className="flex min-h-full items-center justify-center px-4 py-10">{children}</div>
    </div>
  );
}

export function Blocked({ surface = 'page', ...card }: BlockedProps) {
  const content = <Card {...card} />;
  if (surface === 'page') {
    return (
      <PageShell centred>
        <main className="flex w-full justify-center">{content}</main>
      </PageShell>
    );
  }
  return (
    <Layer surface={surface}>
      <main className="w-full max-w-100 rounded-hud-panel hud-glass-thick border border-hud-edge p-6 shadow-hud-panel">{content}</main>
    </Layer>
  );
}
