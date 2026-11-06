import { useEffect, useRef, type ComponentProps } from 'react';
import { Panel } from './Panel';

/**
 * A backdrop and a focused `role="dialog"` panel. Escape calls `onEscape` and stops there, so window-level
 * Escape handlers (popovers, the meeting tile) don't also fire. Rest props go on the backdrop.
 */
export function Modal({
  labelledBy,
  onEscape,
  panelClassName,
  className,
  children,
  ...backdropProps
}: Omit<ComponentProps<'div'>, 'onKeyDown'> & { labelledBy: string; onEscape: () => void; panelClassName: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Focus must start inside, or Escape never reaches the modal and assistive tech stays behind it.
  // A pointer-locked camera would otherwise keep turning, with the cursor hidden, behind the backdrop.
  useEffect(() => {
    document.exitPointerLock?.();
    ref.current?.focus();
  }, []);
  return (
    <div
      className={`pointer-events-auto fixed inset-0 flex items-center justify-center p-4 ${className}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
        }
      }}
      {...backdropProps}
    >
      <Panel
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`outline-none ${panelClassName}`}
      >
        {children}
      </Panel>
    </div>
  );
}
