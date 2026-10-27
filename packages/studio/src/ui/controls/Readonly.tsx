import React from 'react';

import { Field } from './Field.tsx';

interface ReadonlyProps {
  label: React.ReactNode;
  value: string;
  hint?: string;
  className?: string;
}

/**
 * Display-only field. Replaces Leva's `editable: false` text fields
 * (used by KindEditor for `id` and by RoomInspector for the target
 * command id).
 */
export function Readonly({ label, value, hint, className }: ReadonlyProps) {
  return (
    <Field label={label} hint={hint} className={className}>
      <span
        className="flex-1 rounded-sm border border-input bg-secondary px-2 py-0.5 text-xs text-muted-foreground truncate"
        title={value}
      >
        {value}
      </span>
    </Field>
  );
}
