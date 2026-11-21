const BASE =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-[14px] px-5 font-hud-body text-base font-semibold ' +
  'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hud-accent-fill ' +
  'aria-disabled:pointer-events-none disabled:pointer-events-none aria-disabled:opacity-60 disabled:opacity-60 active:scale-[0.98]';

const KIND = {
  primary: 'border border-transparent bg-hud-accent-fill text-hud-on-accent hover:bg-hud-accent-fill-hover',
  secondary: 'border border-hud-edge hud-glass text-hud-text shadow-hud-control hover:bg-hud-panel-thick',
  text: 'border border-transparent bg-transparent text-hud-accent-fill hover:bg-hud-hover',
} as const;

export function pageButton(kind: keyof typeof KIND, className = ''): string {
  return `${BASE} ${KIND[kind]} ${className}`;
}
