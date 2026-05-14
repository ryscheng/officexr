import React from 'react';

import { cn } from '../../lib/utils.ts';

interface FieldProps {
  label: React.ReactNode;
  /** Right-aligned control. */
  children: React.ReactNode;
  /** When provided, render a small hover tooltip explaining the field. */
  hint?: string;
  /** Custom layout — by default the label sits in a 32%-width column
   *  and the control fills the rest. `wide` lets the control take the
   *  full row (good for sliders that need horizontal space). */
  layout?: 'inline' | 'stacked';
  className?: string;
}

/**
 * One row of a panel: `<label / control>`. The label is consistently
 * sized + colored across every panel so the UI feels unified.
 *
 * Layout choice:
 *   - `inline` (default): 1/3 label column, 2/3 control column. Best
 *     for short controls (color swatch, switch, small select).
 *   - `stacked`: label on top, control below at full width. Best for
 *     sliders with a numeric display where the slider track needs the
 *     full row.
 */
export function Field({
  label,
  children,
  hint,
  layout = 'inline',
  className,
}: FieldProps) {
  if (layout === 'stacked') {
    return (
      <div className={cn('flex flex-col gap-1 px-3 py-1.5', className)}>
        <label
          title={hint}
          className="text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          {label}
        </label>
        <div className="flex w-full items-center">{children}</div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1 min-h-7',
        className,
      )}
    >
      <label
        title={hint}
        className="w-[35%] shrink-0 text-[11px] text-muted-foreground"
      >
        {label}
      </label>
      <div className="flex flex-1 items-center min-w-0">{children}</div>
    </div>
  );
}
