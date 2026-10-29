import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const CloseMenuContext = createContext<() => void>(() => {});

/** An action item: runs `onSelect`, then closes the menu. */
export function RoomMenuItem({ onSelect, children }: { onSelect: () => void; children: ReactNode }) {
  const close = useContext(CloseMenuContext);
  return (
    <button
      type="button"
      onClick={() => {
        onSelect();
        close();
      }}
      className="block w-full rounded px-3 py-2 text-left hover:bg-white/10"
    >
      {children}
    </button>
  );
}

/** A radio or switch row that, unlike `RoomMenuItem`, keeps the menu open. */
export function RoomMenuChoice({ children }: { children: ReactNode }) {
  return (
    <label className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-3 hover:bg-white/10">
      {children}
    </label>
  );
}

export function RoomMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} data-studio-panel className="pointer-events-none absolute top-3 left-3 z-20 flex flex-col items-start gap-2">
      <button
        type="button"
        aria-label="Menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="pointer-events-auto h-11 w-11 rounded bg-black/70 text-xl text-white"
      >
        ☰
      </button>
      {open && (
        <CloseMenuContext.Provider value={close}>
          <div className="pointer-events-auto w-56 space-y-1 rounded bg-black/70 p-2 text-sm text-white">{children}</div>
        </CloseMenuContext.Provider>
      )}
    </div>
  );
}
