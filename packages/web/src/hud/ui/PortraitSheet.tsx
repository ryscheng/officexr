import { useId, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useVisualViewport } from '../useVisualViewport';
import { Panel, PanelTitle } from './Panel';

type PortraitSheetProps = {
  title?: string;
  label: string;
  closeLabel: string;
  onClose: () => void;
  /** Takes the whole height the viewport allows, for a sheet whose content scrolls or grows (chat). */
  fill?: boolean;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
};

/**
 * A bottom sheet for phone portrait: it stops under the top bar, follows the visual viewport so an on-screen
 * keyboard never covers its bottom edge, and is the only panel on screen while it is open.
 */
export function PortraitSheet({ title, label, closeLabel, onClose, fill = false, ref, children }: PortraitSheetProps) {
  const { height, keyboard } = useVisualViewport();
  const headingId = useId();
  const available = height > 0 ? `${height}px` : '100dvh';
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
        maxHeight: `calc(${available} - var(--hud-sheet-top))`,
        height: fill ? `calc(${available} - var(--hud-sheet-top))` : undefined,
        paddingBottom: keyboard > 0 ? undefined : 'max(0.5rem, var(--hud-safe-bottom))',
      }}
      className="pointer-events-auto fixed right-(--hud-inset-right) left-(--hud-inset-left) z-40 mx-auto flex max-w-(--hud-sheet-max-width) flex-col gap-2 rounded-b-none p-2"
    >
      {title && (
        <div className="flex shrink-0 items-center gap-2 pl-2">
          <PanelTitle id={headingId} className="flex-1 text-base">
            {title}
          </PanelTitle>
          <button
            type="button"
            aria-label={closeLabel}
            aria-expanded
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-hud-text-2 hover:bg-hud-hover hover:text-hud-text focus-visible:outline-2 focus-visible:outline-hud-accent"
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
