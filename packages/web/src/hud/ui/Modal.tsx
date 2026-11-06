import { useEffect, useRef, type ComponentProps } from 'react';
import { useEscapeLayer } from '../useEscapeLayer';
import { Panel } from './Panel';

/**
 * A backdrop and a focused `role="dialog"` panel. Escape calls `onEscape` as the topmost overlay, even from a
 * field inside. Rest props go on the backdrop.
 */
export function Modal({
  labelledBy,
  onEscape,
  panelClassName,
  className,
  children,
  ...backdropProps
}: ComponentProps<'div'> & { labelledBy: string; onEscape: () => void; panelClassName: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeLayer(true, onEscape, true);
  // Focus must start inside, or Escape never reaches the modal and assistive tech stays behind it.
  // A pointer-locked camera would otherwise keep turning, with the cursor hidden, behind the backdrop.
  useEffect(() => {
    document.exitPointerLock?.();
    ref.current?.focus();
  }, []);
  return (
    <div
      className={`pointer-events-auto fixed inset-0 flex items-center justify-center p-4 ${className}`}
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
