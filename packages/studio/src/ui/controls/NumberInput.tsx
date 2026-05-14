import React, { useEffect, useRef, useState } from 'react';

import { Slider } from '../../components/ui/slider.tsx';
import { Field } from './Field.tsx';
import { useDragScrub } from './useDragScrub.ts';
import { cn } from '../../lib/utils.ts';

interface NumberInputProps {
  label: React.ReactNode;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  /** Disable the slider track, leaving only the drag-to-scrub value
   *  display. Use this for unbounded values where a slider doesn't
   *  make sense (e.g. open-ended coordinates). */
  sliderless?: boolean;
  /** Number of decimal places to display. Defaults to `step`-derived:
   *  step=1 → 0 decimals, step=0.1 → 1, step=0.05 → 2. */
  digits?: number;
  className?: string;
}

/**
 * Bounded numeric input. Two interaction surfaces:
 *
 *   - **Slider track**: drag the thumb for coarse changes.
 *   - **Numeric display**: click to type an exact value, or
 *     pointer-drag horizontally to "scrub" (Leva's killer feature).
 *     Shift accelerates ×10, alt slows ×0.1.
 *
 * Bounds are optional. When `min` and `max` are both provided, the
 * slider track renders; otherwise the slider is hidden and only the
 * scrubbable value display is shown.
 */
export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.01,
  hint,
  sliderless,
  digits,
  className,
}: NumberInputProps) {
  const showSlider =
    !sliderless && typeof min === 'number' && typeof max === 'number';

  // Editing mode: when true, render an <input> instead of the
  // drag-scrubbable button so the user can type a precise value.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(format(value, step, digits));
  // Sync the displayed value when the source changes (e.g. parent
  // applied a value from elsewhere — a different field, an undo).
  // But skip the sync while the user is typing so their in-progress
  // input doesn't get clobbered.
  useEffect(() => {
    if (!editing) setDraft(format(value, step, digits));
  }, [value, step, digits, editing]);

  const inputRef = useRef<HTMLInputElement>(null);
  const startEdit = () => {
    setDraft(format(value, step, digits));
    setEditing(true);
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };
  const commitEdit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      let next = parsed;
      if (typeof min === 'number') next = Math.max(min, next);
      if (typeof max === 'number') next = Math.min(max, next);
      if (next !== value) onChange(next);
    }
    setEditing(false);
  };
  const cancelEdit = () => {
    setDraft(format(value, step, digits));
    setEditing(false);
  };

  const scrub = useDragScrub({
    value,
    step,
    min,
    max,
    onChange,
  });

  return (
    <Field label={label} hint={hint} className={className}>
      <div className="flex w-full items-center gap-2">
        {showSlider ? (
          <Slider
            value={[value]}
            min={min}
            max={max}
            step={step}
            onValueChange={([v]) => onChange(v)}
            className="flex-1"
          />
        ) : (
          <div className="flex-1" />
        )}
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              else if (e.key === 'Escape') cancelEdit();
            }}
            // type=text (not number) so the input accepts partial
            // typing like "1." without coercing.
            type="text"
            inputMode="numeric"
            className="w-14 shrink-0 rounded-sm border border-input bg-secondary px-1.5 py-0.5 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
          />
        ) : (
          <button
            type="button"
            onPointerDown={scrub.onPointerDown}
            onClick={(e) => {
              // Suppress click after drag (which fires pointerup but
              // also synthesizes a click on the same target). If a
              // drag is in flight or just ended, skip the edit-mode.
              if (scrub.isDragging()) {
                e.preventDefault();
                return;
              }
              startEdit();
            }}
            className={cn(
              'w-14 shrink-0 rounded-sm border border-input bg-secondary px-1.5 py-0.5 text-right text-xs text-foreground cursor-ew-resize select-none tabular-nums hover:bg-accent',
            )}
            title={hint ?? 'Drag to scrub · click to type'}
          >
            {format(value, step, digits)}
          </button>
        )}
      </div>
    </Field>
  );
}

function format(value: number, step: number, digits?: number): string {
  const d =
    typeof digits === 'number'
      ? digits
      : step >= 1
        ? 0
        : Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))));
  return value.toFixed(d);
}
