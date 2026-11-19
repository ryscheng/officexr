import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';

/** The app icon: a rounded, softly lit square like a macOS app icon, beside the wordmark. */
export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const icon = size === 'lg' ? 'size-14 rounded-[16px] [&>svg]:size-7' : 'size-9 rounded-[10px] [&>svg]:size-[18px]';
  return (
    <span className="flex items-center gap-3">
      <span
        className={`flex shrink-0 items-center justify-center bg-[linear-gradient(160deg,#5ab0ff,#0a6cff_55%,#4b3bff)] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_4px_14px_rgb(10_108_255/0.35)] ${icon}`}
      >
        <Building2 aria-hidden />
      </span>
      <span className={`font-hud-title font-semibold tracking-tight text-hud-text ${size === 'lg' ? 'text-3xl' : 'text-lg'}`}>OfficeXR</span>
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
      <span aria-hidden className="size-6 animate-spin rounded-full border-[2.5px] border-hud-track border-t-hud-accent" />
      {label}
    </div>
  );
}

/** A soft, colourful wallpaper the glass refracts, like a macOS desktop behind its windows (`--hud-wallpaper`, per theme). */
const WALLPAPER = '[background:var(--hud-wallpaper)]';

/** A full page outside the world (office list, sign-in, loading): glass over the wallpaper. */
export function PageShell({ header, centred = false, children }: { header?: ReactNode; centred?: boolean; children: ReactNode }) {
  return (
    <div className={`relative min-h-dvh overflow-x-hidden font-hud-body text-hud-text ${WALLPAPER}`}>
      <div className={`relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 sm:px-8 ${centred ? 'items-center justify-center py-10' : 'py-6'}`}>
        {header}
        {children}
      </div>
    </div>
  );
}
