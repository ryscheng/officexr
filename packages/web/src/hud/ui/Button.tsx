import type { ComponentProps } from 'react';

const TONE = {
  primary:
    'border-hud-accent-edge bg-hud-accent text-hud-on-accent shadow-[0_3px_0_var(--color-hud-accent-shadow)] hover:bg-hud-accent-edge',
  neutral: 'border-hud-edge bg-hud-panel text-hud-text shadow-hud-control hover:bg-hud-edge',
  ghost: 'border-transparent bg-transparent text-hud-text-2 hover:bg-hud-edge hover:text-hud-text',
} as const;

const SIZE = {
  sm: 'px-3 py-1.5 text-xs pointer-coarse:min-h-11',
  md: 'px-4 py-2 text-sm pointer-coarse:min-h-11',
  lg: 'px-5 py-2.5 text-base',
} as const;

export type ButtonTone = keyof typeof TONE;
export type ButtonSize = keyof typeof SIZE;

/** The classes of a HUD text button, for elements that must stay links (e.g. the Google sign-in). */
export function buttonClass(tone: ButtonTone = 'neutral', size: ButtonSize = 'md', className = ''): string {
  return (
    'inline-flex items-center justify-center gap-2 rounded-hud-control border-2 font-hud-body font-bold whitespace-nowrap ' +
    'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hud-accent ' +
    'disabled:pointer-events-none disabled:opacity-50 active:translate-y-px ' +
    `${TONE[tone]} ${SIZE[size]} ${className}`
  );
}

/** A text button in the HUD's chunky style; `IconButton` is its icon-only sibling. */
export function Button({
  tone = 'neutral',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { tone?: ButtonTone; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(tone, size, className)} {...props} />;
}
