import { createContext, useContext } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { LucideIcon } from 'lucide-react';

const TONE = {
  // The glass material, so a button floating over the world keeps its contrast in both appearances.
  neutral: 'hud-glass text-hud-text shadow-hud-control hover:bg-hud-panel-thick',
  accent: 'bg-hud-accent-fill text-hud-on-accent shadow-[0_1px_3px_var(--color-hud-accent-shadow)] hover:bg-hud-accent-fill-hover',
  danger: 'bg-hud-rose text-hud-rose-text hover:bg-[rgb(255_59_48/0.2)]',
  success: 'bg-hud-sage text-hud-sage-text hover:bg-[rgb(52_199_89/0.24)]',
};

const SIZE = {
  md: { button: 'p-2 pointer-coarse:min-h-12 pointer-coarse:min-w-12', icon: 'h-4 w-4' },
  sm: { button: 'p-0.5 pointer-coarse:min-h-12 pointer-coarse:min-w-12', icon: 'h-3 w-3' },
  row: { button: 'h-[26px] w-[26px] pointer-coarse:h-12 pointer-coarse:w-12', icon: 'h-3.5 w-3.5' },
  lg: { button: 'h-11 w-11 p-2.5', icon: 'h-5 w-5' },
};

/** Where `IconButton` tooltips portal to, for buttons rendered into another document; defaults to `document.body`. */
export const TooltipContainer = createContext<HTMLElement | undefined>(undefined);

/** A HUD button showing one icon, named and tooltipped by `label`. It never takes focus from the world on click. */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  pressed,
  expanded,
  disabled,
  tone = 'neutral',
  size = 'md',
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  tone?: keyof typeof TONE;
  size?: keyof typeof SIZE;
}) {
  const tooltipContainer = useContext(TooltipContainer);
  return (
    // Hoverable content closes through a pointermove listener on the global `document`, which never hears
    // another document's pointer, so tooltips portalled elsewhere close on trigger leave instead.
    <Tooltip.Provider delayDuration={300} disableHoverableContent={tooltipContainer !== undefined}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          {/* A disabled button gets no pointer events, so the wrapper carries the hover for the tooltip.
              preventDefault on mousedown keeps focus off the button, so Space/Enter keep driving the world. */}
          <span
            className={`pointer-events-auto inline-flex ${disabled ? 'cursor-not-allowed' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button
              type="button"
              aria-label={label}
              aria-pressed={pressed}
              aria-expanded={expanded}
              disabled={disabled}
              onClick={onClick}
              className={`inline-flex items-center justify-center rounded-hud-control transition-colors focus-visible:outline-2 focus-visible:outline-hud-accent disabled:pointer-events-none disabled:opacity-40 ${SIZE[size].button} ${TONE[tone]}`}
            >
              <Icon aria-hidden className={SIZE[size].icon} />
            </button>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal container={tooltipContainer}>
          <Tooltip.Content sideOffset={6} className="z-50 rounded-lg bg-hud-tooltip px-2 py-1 font-hud-body text-xs font-medium text-white shadow-hud-control backdrop-blur-md">
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
