import React from 'react';

import { cn } from '../../lib/utils.ts';

interface PanelProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Outer container that replaces `<Leva fill flat>` inside a mode's
 * `<SidePanel>`. Provides:
 *   - vertical scroll
 *   - consistent padding
 *   - the dark studio chrome (background + foreground colors)
 *
 * The container is intentionally `flex-col` so children can stretch
 * across the full panel width. Each child is typically a `<Section>`
 * (collapsible folder) or a top-level `<Field>` (label + control row).
 */
export function Panel({ children, className }: PanelProps) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col gap-1 overflow-y-auto bg-background text-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}
