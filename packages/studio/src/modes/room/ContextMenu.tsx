import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  /** Stable identifier — also the key. */
  id: string;
  /** Visible label. */
  label: string;
  /** Called when the item is activated. */
  onActivate: () => void;
  /** Optional shortcut hint (right-aligned). */
  shortcut?: string;
  /** Set to render the item in a "danger" style (red text). */
  danger?: boolean;
}

interface ContextMenuProps {
  /** Screen position (clientX/clientY of the originating event). */
  x: number;
  y: number;
  items: ContextMenuItem[];
  /** Called when the menu should close — outside-click, Esc, or
   * item activation. */
  onClose: () => void;
}

/**
 * Floating context menu rendered as a `document.body` portal so it
 * can position absolutely without being clipped by the R3F canvas.
 *
 * Auto-closes on:
 *   - Outside click (capture-phase mousedown listener on document)
 *   - Escape key
 *   - Item activation (the item's `onActivate` runs, then `onClose`)
 *
 * The menu owns no state — `RoomApp` owns the open / closed shape
 * and computes the items based on the current selection.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[data-room-context-menu="root"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // Capture phase so we win even if a child stops propagation.
    document.addEventListener('mousedown', onMouseDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [onClose]);

  // Clamp so the menu doesn't disappear off-screen for clicks near
  // the right/bottom edges. We use 220x{N*36+16} as the rough size
  // budget.
  const w = 220;
  const h = items.length * 32 + 16;
  const left = Math.min(x, window.innerWidth - w - 8);
  const top = Math.min(y, window.innerHeight - h - 8);

  return createPortal(
    <div
      data-room-context-menu="root"
      role="menu"
      style={{
        position: 'fixed',
        left,
        top,
        minWidth: w,
        padding: 6,
        background: '#0a0a0a',
        border: '1px solid #2a2f36',
        borderRadius: 6,
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.4)',
        font: '12px system-ui, sans-serif',
        color: '#fafafa',
        zIndex: 1000,
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => {
            item.onActivate();
            onClose();
          }}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            padding: '6px 10px',
            border: 0,
            background: 'transparent',
            color: item.danger ? '#fca5a5' : '#fafafa',
            cursor: 'pointer',
            borderRadius: 4,
            font: 'inherit',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#1f2937';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              'transparent';
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && (
            <span style={{ color: '#94a3b8', fontSize: 11 }}>
              {item.shortcut}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
