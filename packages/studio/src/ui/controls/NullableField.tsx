import React from 'react';

import { Checkbox } from '../../components/ui/checkbox.tsx';
import { cn } from '../../lib/utils.ts';

interface NullableFieldProps<T> {
  /** The label shown next to the enable checkbox. The slotted
   *  control (children) provides its own field row when enabled. */
  label: string;
  /** When the value is `null`, the slotted control is hidden and the
   *  checkbox is unchecked. When non-null, the control renders with
   *  the real value. */
  value: T | null;
  /** Pushed by the checkbox: `value=null` when disabled, a default
   *  value (provided by caller) when re-enabled. */
  onChange: (next: T | null) => void;
  /** Value to restore when the user re-enables the field. */
  defaultValue: T;
  /** The actual control, rendered only when `value !== null`. Caller
   *  passes a render fn so it can wire `value`/`onChange` against
   *  the non-null version. */
  children: (value: T, onChange: (next: T) => void) => React.ReactNode;
  className?: string;
}

/**
 * Wraps a control with an enable-checkbox. When unchecked, the
 * underlying value is `null` (meaning "use GLTF default" or "use
 * inherited value" depending on the field's domain).
 *
 * Replaces Leva's "use X" boolean + paired control pattern that
 * KindEditor used 4× for tint/roughness/metalness/emissive.
 *
 * Note that the value type `T` is generic so callers can use this
 * with `number`, `string`, etc. The `defaultValue` prop is what
 * gets restored when the user re-enables the field.
 */
export function NullableField<T>({
  label,
  value,
  onChange,
  defaultValue,
  children,
  className,
}: NullableFieldProps<T>) {
  const enabled = value !== null;
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center gap-2 px-3 py-1">
        <Checkbox
          checked={enabled}
          onCheckedChange={(checked) =>
            onChange(checked ? defaultValue : null)
          }
          aria-label={`Enable ${label}`}
        />
        <label className="text-[11px] text-muted-foreground select-none">
          {label}
        </label>
      </div>
      {enabled ? children(value as T, (next) => onChange(next)) : null}
    </div>
  );
}
