import { useId, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useVisualViewport } from '../useVisualViewport';
import { Panel, PanelTitle } from './Panel';

type PortraitSheetProps = {
  title?: string;
  label: string;
  closeLabel: string;
  onClose: () => void;
  onBack?: () => void;
  /** Takes the whole height the viewport allows, for a sheet whose content scrolls or grows (chat). */
  fill?: boolean;
  /** Caps the height at this share of the visible viewport (still below the top bar). */
  heightPct?: number;
  /** Buttons beside the close button, e.g. to snap between half and full height. */
  headerExtra?: ReactNode;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
};

/**
 * A bottom sheet for phone portrait: it stops under the top bar, follows the visual viewport so an on-screen
 * keyboard never covers its bottom edge, and is the only panel on screen while it is open.
 */
export function PortraitSheet({ title, label, closeLabel, onClose, onBack, fill = false, heightPct, headerExtra, ref, children }: PortraitSheetProps) {
  const { height, keyboard } = useVisualViewport();
  const headingId = useId();
  const available = height > 0 ? `${height}px` : '100dvh';
  const cap = `calc(${available} - var(--hud-sheet-top))`;
  const limit = heightPct === undefined ? cap : `min(${cap}, calc(${available} * ${heightPct / 100}))`;
  const sheet = (
    <Panel
      ref={ref}
      material="thick"
      role={title ? 'dialog' : undefined}
      aria-label={title ? undefined : label}
      aria-labelledby={title ? headingId : undefined}
      data-hud-modal
      style={{
        bottom: keyboard,
        maxHeight: limit,
        height: fill ? limit : undefined,
        paddingBottom: keyboard > 0 ? '0.5rem' : 'max(1rem, calc(var(--hud-safe-bottom) + 0.5rem))',
      }}
      className="pointer-events-auto fixed right-(--hud-inset-right) left-(--hud-inset-left) z-40 mx-auto flex max-w-(--hud-sheet-max-width) flex-col gap-2 rounded-b-none p-2"
    >
      {title && (
        <div className={`flex shrink-0 items-center gap-2 ${onBack ? '' : 'pl-2'}`}>
          {onBack && (
            <button
              type="button"
              aria-label="Back"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onBack}
              className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-hud-text hover:bg-hud-hover focus-visible:outline-2 focus-visible:outline-hud-accent"
            >
              <ArrowLeft aria-hidden className="size-5" />
            </button>
          )}
          <PanelTitle id={headingId} className="flex-1 text-base">
            {title}
          </PanelTitle>
          {headerExtra}
          <button
            type="button"
            aria-label={closeLabel}
            aria-expanded
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
            className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-hud-text-2 hover:bg-hud-hover hover:text-hud-text focus-visible:outline-2 focus-visible:outline-hud-accent"
          >
            <ChevronDown aria-hidden className="size-5" />
          </button>
        </div>
      )}
      {children}
    </Panel>
  );
  return createPortal(sheet, document.body);
}
