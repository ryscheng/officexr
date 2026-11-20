import type { ComponentProps } from 'react';

export function RoundButton({ className = '', tone = 'inset', ...props }: ComponentProps<'button'> & { tone?: 'inset' | 'danger' | 'glass' }) {
  const TONE = {
    inset: 'bg-hud-inset text-hud-text hover:bg-hud-hover',
    danger: 'bg-hud-rose text-hud-rose-text hover:bg-[rgb(255_59_48/0.2)]',
    glass: 'hud-glass border border-hud-edge text-hud-text shadow-hud-panel hover:bg-hud-panel-thick',
  }[tone];
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      className={`pointer-events-auto relative flex size-11 pointer-coarse:size-12 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-hud-accent ${TONE} ${className}`}
      {...props}
    />
  );
}
