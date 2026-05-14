import React from 'react';

export const LEFT_PANEL_WIDTH = 240;

interface LeftPanelProps {
  children?: React.ReactNode;
}

/**
 * Thin left-column container, mirrors the right-side `<SidePanel>`
 * styling. Mounted by mode controllers that have a left palette
 * (Scenes mode's object types). Hidden when `children` is null.
 */
export function LeftPanel({ children }: LeftPanelProps) {
  if (!children) return null;
  return (
    <aside
      data-studio-panel="true"
      style={{
        width: LEFT_PANEL_WIDTH,
        flexShrink: 0,
        background: '#171717',
        borderRight: '1px solid #262626',
        color: '#fafafa',
        font: '12px system-ui, sans-serif',
        overflowY: 'auto',
      }}
    >
      {children}
    </aside>
  );
}
