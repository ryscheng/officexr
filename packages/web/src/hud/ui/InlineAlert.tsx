import type { ReactNode } from 'react';

/** An error inside a page or panel; `HudBanner` is the floating, dismissable one over the world. */
export function InlineAlert({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={`rounded-hud-control border-2 border-hud-rose-text/30 bg-hud-rose px-3 py-2 font-hud-body text-sm text-hud-rose-text ${className}`}
    >
      {children}
    </p>
  );
}
