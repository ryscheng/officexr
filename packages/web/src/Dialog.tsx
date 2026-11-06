import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Panel, PanelTitle } from './hud/ui/Panel';

/** A modal over the room. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Focus must start inside, or Escape never reaches the dialog and assistive tech stays behind it.
  // A pointer-locked camera would otherwise keep turning, with the cursor hidden, behind the backdrop.
  useEffect(() => {
    document.exitPointerLock?.();
    ref.current?.focus();
  }, []);
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
    >
      <Panel
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md p-4 text-sm outline-none"
      >
        <PanelTitle id={titleId} className="mb-3 text-base">
          {title}
        </PanelTitle>
        {children}
      </Panel>
    </div>
  );
}
