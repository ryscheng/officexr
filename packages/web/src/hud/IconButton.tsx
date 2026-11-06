import { createContext, useContext } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import type { LucideIcon } from 'lucide-react';

const TONE = {
  neutral: 'bg-hud-panel text-hud-text hover:bg-hud-edge',
  accent: 'bg-hud-accent text-hud-on-accent hover:bg-hud-accent-edge',
  danger: 'bg-hud-rose text-hud-rose-text hover:brightness-125',
  success: 'bg-hud-sage text-hud-sage-text hover:brightness-125',
};

const SIZE = {
  md: { button: 'p-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11', icon: 'h-4 w-4' },
  sm: { button: 'p-0.5 pointer-coarse:min-h-11 pointer-coarse:min-w-11', icon: 'h-3 w-3' },
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
              className={`inline-flex items-center justify-center rounded-hud-control disabled:pointer-events-none disabled:opacity-50 ${SIZE[size].button} ${TONE[tone]}`}
            >
              <Icon aria-hidden className={SIZE[size].icon} />
            </button>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal container={tooltipContainer}>
          <Tooltip.Content sideOffset={6} className="z-50 rounded-lg bg-hud-inset px-2 py-1 font-hud-body text-xs text-hud-text">
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
