import type { ReactNode } from 'react';

/** The `data-studio-panel` attribute keeps typing inside from driving the avatar. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-studio-panel
      className={`rounded-hud-panel border-2 border-hud-edge bg-hud-panel font-hud-body text-hud-text shadow-hud-panel ${className}`}
    >
      {children}
    </div>
  );
}

export function PanelTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-hud-title text-sm font-normal tracking-widest text-hud-text uppercase">{children}</h2>;
}
