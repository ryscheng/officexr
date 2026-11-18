import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';

/** The app mark: the office-name plate's badge beside the wordmark. */
export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const badge = size === 'lg' ? 'size-12 [&>svg]:size-6' : 'size-9 [&>svg]:size-4.5';
  return (
    <span className="flex items-center gap-3">
      <span className={`flex shrink-0 items-center justify-center rounded-hud-control bg-hud-accent text-hud-on-accent shadow-[0_3px_0_var(--color-hud-accent-shadow)] ${badge}`}>
        <Building2 aria-hidden />
      </span>
      <span className={`font-hud-title tracking-widest text-hud-text ${size === 'lg' ? 'text-3xl' : 'text-xl'}`}>OfficeXR</span>
    </span>
  );
}

/** The mark as a link home; needs a router. */
export function BrandLink() {
  return (
    <Link to="/" aria-label="OfficeXR" className="rounded-hud-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hud-accent">
      <BrandMark />
    </Link>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 font-hud-body text-sm text-hud-text-2">
      <span aria-hidden className="size-7 animate-spin rounded-full border-3 border-hud-edge border-t-hud-accent" />
      {label}
    </div>
  );
}

/**
 * A full page outside the world (office list, sign-in, loading): the HUD's navy on a faint
 * tile grid, so leaving the map never feels like leaving the product.
 */
export function PageShell({ header, centred = false, children }: { header?: ReactNode; centred?: boolean; children: ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-hud-inset font-hud-body text-hud-text">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-60 [background-image:linear-gradient(var(--color-hud-panel)_1px,transparent_1px),linear-gradient(90deg,var(--color-hud-panel)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
      />
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,rgb(127_178_255/0.14),transparent_70%)]" />
      <div className={`relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 sm:px-6 ${centred ? 'items-center justify-center py-10' : 'py-6'}`}>
        {header}
        {children}
      </div>
    </div>
  );
}
