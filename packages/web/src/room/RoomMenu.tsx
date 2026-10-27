import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const RoomMenuContext = createContext<{ close: () => void }>({ close: () => {} });

/** The menu's close seam, for items that need to dismiss it themselves. */
export const useRoomMenu = () => useContext(RoomMenuContext);

/** An action item: runs `onSelect`, then closes the menu unless `closeOnSelect` is false. */
export function RoomMenuItem({
  onSelect,
  closeOnSelect = true,
  children,
}: {
  onSelect: () => void;
  closeOnSelect?: boolean;
  children: ReactNode;
}) {
  const { close } = useRoomMenu();
  return (
    <button
      type="button"
      onClick={() => {
        onSelect();
        if (closeOnSelect) {
          close();
        }
      }}
      className="block w-full rounded px-3 py-2 text-left hover:bg-white/10"
    >
      {children}
    </button>
  );
}

/** The top-right hamburger button and its dropdown; items are passed as children. */
export function RoomMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    <div ref={ref} data-studio-panel className="pointer-events-none absolute top-3 right-3 z-20 flex flex-col items-end gap-2">
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
        <RoomMenuContext.Provider value={{ close: () => setOpen(false) }}>
          <div className="pointer-events-auto w-56 space-y-1 rounded bg-black/70 p-2 text-sm text-white">{children}</div>
        </RoomMenuContext.Provider>
      )}
    </div>
  );
}
