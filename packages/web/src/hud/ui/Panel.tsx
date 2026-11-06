import type { ComponentProps } from 'react';

export const TITLE_TEXT = 'font-hud-title font-normal tracking-widest text-hud-text uppercase';

/** A compact control-sized surface, e.g. a folded panel's tab. */
export const CHIP =
  'rounded-hud-control border-2 border-hud-edge bg-hud-panel text-hud-text shadow-hud-control hover:bg-hud-edge';

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
  return <h2 className={`${TITLE_TEXT} ${className}`} {...props} />;
}
