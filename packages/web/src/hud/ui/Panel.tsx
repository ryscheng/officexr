import type { ComponentProps } from 'react';

/** The `data-studio-panel` attribute keeps typing inside from driving the avatar. */
export function Panel({ className = '', ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-studio-panel
      className={`rounded-hud-panel border-2 border-hud-edge bg-hud-panel font-hud-body text-hud-text shadow-hud-panel ${className}`}
      {...props}
    />
  );
}

export function PanelTitle({ className = 'text-sm', ...props }: ComponentProps<'h2'>) {
  return <h2 className={`font-hud-title font-normal tracking-widest text-hud-text uppercase ${className}`} {...props} />;
}
