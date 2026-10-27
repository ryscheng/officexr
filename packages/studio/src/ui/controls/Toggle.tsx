import React from 'react';

import { Switch } from '../../components/ui/switch.tsx';
import { Field } from './Field.tsx';

interface ToggleProps {
  label: React.ReactNode;
  value: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
  className?: string;
}

/**
 * Labeled boolean toggle (wraps Radix Switch). The switch right-
 * aligns inside the Field's control column.
 */
export function Toggle({
  label,
  value,
  onChange,
  hint,
  className,
}: ToggleProps) {
  const id = React.useId();
  return (
    <Field label={label} hint={hint} className={className} htmlFor={id}>
      <div className="flex w-full justify-end">
        <Switch id={id} checked={value} onCheckedChange={onChange} />
      </div>
    </Field>
  );
}
