import type { ReactNode } from 'react';

/** Width of the right-hand control sidebar in CSS pixels. Other code
 * that needs to know the canvas's actual width (e.g. for a future
 * minimap or HUD positioning) imports this constant rather than
 * hard-coding the layout. */
export const SIDE_PANEL_WIDTH = 320;

interface SidePanelProps {
  children: ReactNode;
}

/**
 * Fixed-width vertical panel on the right of the viewport that hosts
 * Leva (or anything else) without overlaying the 3D canvas. The
 * `<Leva fill />` prop family makes Leva adopt this container's box
 * and drop its draggable chrome — but Leva still mounts the
 * `#leva__root` element inside it, so the existing
 * `el.closest('#leva__root')` checks in SceneFrame continue to work
 * for "is the user typing into Leva?" gates.
 */
export function SidePanel({ children }: SidePanelProps) {
  return (
    <aside
      style={{
        width: SIDE_PANEL_WIDTH,
        flex: '0 0 auto',
        height: '100%',
        overflowY: 'auto',
        background: '#181c20',
        borderLeft: '1px solid #2a2f36',
      }}
    >
      {children}
    </aside>
  );
}
