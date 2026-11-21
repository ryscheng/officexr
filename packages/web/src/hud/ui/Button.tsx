import type { ComponentProps } from 'react';

const TONE = {
  primary: 'border-transparent bg-hud-accent-fill text-hud-on-accent shadow-[0_1px_3px_var(--color-hud-accent-shadow)] hover:bg-hud-accent-fill-hover',
  neutral: 'border-hud-edge hud-glass text-hud-text shadow-hud-control hover:bg-hud-panel-thick',
  ghost: 'border-transparent bg-transparent text-hud-text-2 hover:bg-hud-hover hover:text-hud-text',
} as const;

const SIZE = {
  sm: 'px-3 py-1.5 text-xs pointer-coarse:min-h-12',
  md: 'px-4 py-2 text-sm pointer-coarse:min-h-12',
  lg: 'px-5 py-2.5 text-base',
} as const;

export type ButtonTone = keyof typeof TONE;
export type ButtonSize = keyof typeof SIZE;

/** The classes of a HUD text button, for elements that must stay links (e.g. the Google sign-in). */
export function buttonClass(tone: ButtonTone = 'neutral', size: ButtonSize = 'md', className = ''): string {
  return (
    'inline-flex items-center justify-center gap-2 rounded-hud-control border font-hud-body font-semibold whitespace-nowrap ' +
    'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hud-accent ' +
    'disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98] ' +
    `${TONE[tone]} ${SIZE[size]} ${className}`
  );
}

/** A text button in the HUD's glass style; `IconButton` is its icon-only sibling. */
export function Button({
  tone = 'neutral',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { tone?: ButtonTone; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(tone, size, className)} {...props} />;
}
