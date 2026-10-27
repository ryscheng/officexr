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
 * the shadcn-based control panels without overlaying the 3D canvas.
 *
 * The `data-studio-panel` attribute is load-bearing for keyboard
 * focus: `useWorldFocus` (and any callsite gating on "is the user
 * interacting with the side panel?") uses `el.closest('[data-studio-
 * panel]')` to decide whether a mousedown/focusin should release
 * keyboard control from the in-world character. The attribute is
 * therefore part of the public contract — keep it on the outermost
 * element this component renders so a descendant click/focus walks
 * up and finds it.
 */
export function SidePanel({ children }: SidePanelProps) {
  return (
    <aside
      data-studio-panel="true"
      style={{
        width: SIDE_PANEL_WIDTH,
        flex: '0 0 auto',
        // `minHeight: 0` lets the inner scroll container honor its
        // overflow when the side panel sits inside a flex parent that
        // would otherwise size to its content.
        minHeight: 0,
        alignSelf: 'stretch',
        display: 'flex',
        flexDirection: 'column',
        background: '#181c20',
        borderLeft: '1px solid #2a2f36',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {children}
      </div>
    </aside>
  );
}
