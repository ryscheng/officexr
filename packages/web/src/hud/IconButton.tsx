import * as Tooltip from '@radix-ui/react-tooltip';
import type { LucideIcon } from 'lucide-react';

const TONE = {
  neutral: 'bg-black/55 hover:bg-black/70',
  danger: 'bg-red-700/80 hover:bg-red-700',
  success: 'bg-green-700/80 hover:bg-green-700',
};

const SIZE = {
  md: { button: 'p-2', icon: 'h-4 w-4' },
  sm: { button: 'p-0.5', icon: 'h-3 w-3' },
};

/** A HUD button showing one icon, named and tooltipped by `label`. It never takes focus from the world on click. */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  pressed,
  disabled,
  tone = 'neutral',
  size = 'md',
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  tone?: keyof typeof TONE;
  size?: keyof typeof SIZE;
}) {
  return (
    <Tooltip.Provider delayDuration={300}>
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
              disabled={disabled}
              onClick={onClick}
              className={`rounded text-white disabled:pointer-events-none disabled:opacity-50 ${SIZE[size].button} ${TONE[tone]}`}
            >
              <Icon aria-hidden className={SIZE[size].icon} />
            </button>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content sideOffset={6} className="z-50 rounded bg-black/80 px-2 py-1 text-xs text-white">
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
