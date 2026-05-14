import React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import { Field } from './Field.tsx';

interface SelectOption<V extends string> {
  value: V;
  label?: string;
}

interface SelectInputProps<V extends string> {
  label: React.ReactNode;
  value: V;
  options: readonly V[] | readonly SelectOption<V>[];
  onChange: (next: V) => void;
  hint?: string;
  className?: string;
}

/**
 * Labeled enum dropdown. Replaces Leva's `options` field. Accepts
 * either a flat string list (used as both value + label) or
 * `{ value, label }` pairs.
 */
export function SelectInput<V extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  className,
}: SelectInputProps<V>) {
  const normalized: SelectOption<V>[] = options.map((o) =>
    typeof o === 'string' ? { value: o as V, label: o } : (o as SelectOption<V>),
  );

  return (
    <Field label={label} hint={hint} className={className}>
      <Select value={value} onValueChange={(v) => onChange(v as V)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {normalized.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label ?? o.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
