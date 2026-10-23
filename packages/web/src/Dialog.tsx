import type { ReactNode } from 'react';

/** A modal over the room; `data-studio-panel` keeps typing in it from driving the avatar. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        data-studio-panel
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded bg-white p-4 text-sm text-black"
      >
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
