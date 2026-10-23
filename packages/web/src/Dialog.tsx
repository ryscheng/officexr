import { useEffect, useId, useRef, type ReactNode } from 'react';

/** A modal over the room; `data-studio-panel` keeps typing in it from driving the avatar. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Focus must start inside, or Escape never reaches the dialog and assistive tech stays behind it.
  useEffect(() => ref.current?.focus(), []);
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
      <div
        ref={ref}
        tabIndex={-1}
        data-studio-panel
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded bg-white p-4 text-sm text-black outline-none"
      >
        <h2 id={titleId} className="mb-3 text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
