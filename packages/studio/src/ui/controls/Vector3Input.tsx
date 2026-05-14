import React from 'react';

import { Field } from './Field.tsx';
import { NumberInput } from './NumberInput.tsx';

type Vec3 = readonly [number, number, number];

interface Vector3InputProps {
  label: React.ReactNode;
  value: Vec3;
  onChange: (next: Vec3) => void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  className?: string;
}

/**
 * Three numeric scrubbers side-by-side, sharing one label. Each axis
 * has its own slider-less `NumberInput` (drag-to-scrub + click-to-
 * type). Common uses:
 *   - placeCube position (integer voxel coords, step=1)
 *   - sun position (continuous coords)
 *
 * The component intentionally renders three INDEPENDENT NumberInputs
 * rather than fabricating a joystick widget — the existing studio
 * panels passed `joystick: false` to Leva, signaling that simple
 * per-axis editing is what's wanted.
 */
export function Vector3Input({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
  digits,
  className,
}: Vector3InputProps) {
  const [x, y, z] = value;
  const set = (i: 0 | 1 | 2, v: number) => {
    const next: [number, number, number] = [x, y, z];
    next[i] = v;
    onChange(next);
  };
  return (
    <Field label={label} layout="stacked" className={className}>
      <div className="grid w-full grid-cols-3 gap-2">
        <AxisInput axis="X" value={x} step={step} min={min} max={max} digits={digits} onChange={(v) => set(0, v)} />
        <AxisInput axis="Y" value={y} step={step} min={min} max={max} digits={digits} onChange={(v) => set(1, v)} />
        <AxisInput axis="Z" value={z} step={step} min={min} max={max} digits={digits} onChange={(v) => set(2, v)} />
      </div>
    </Field>
  );
}

interface AxisProps {
  axis: 'X' | 'Y' | 'Z';
  value: number;
  step: number;
  min?: number;
  max?: number;
  digits?: number;
  onChange: (next: number) => void;
}

function AxisInput(props: AxisProps) {
  // Use the bare `NumberInput` in slider-less mode; wrap with a tiny
  // axis-label badge so the user knows which dimension they're
  // editing. The NumberInput renders a Field internally though — use
  // a custom layout here instead to avoid nested labels.
  return (
    <div className="flex items-center gap-1">
      <span className="w-3 shrink-0 text-[10px] uppercase text-muted-foreground">
        {props.axis}
      </span>
      {/* Wrap NumberInput with negative-margin trick? No — instead
       *  inline a slim variant of NumberInput's value display. */}
      <InlineNumber
        value={props.value}
        step={props.step}
        min={props.min}
        max={props.max}
        digits={props.digits}
        onChange={props.onChange}
      />
    </div>
  );
}

// Compact inline version of NumberInput's scrubbable display — no
// outer Field row, no slider. Re-uses useDragScrub.
import { useDragScrub } from './useDragScrub.ts';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils.ts';

interface InlineNumberProps {
  value: number;
  step: number;
  min?: number;
  max?: number;
  digits?: number;
  onChange: (next: number) => void;
}

function InlineNumber({ value, step, min, max, digits, onChange }: InlineNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(format(value, step, digits));
  useEffect(() => {
    if (!editing) setDraft(format(value, step, digits));
  }, [value, step, digits, editing]);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrub = useDragScrub({ value, step, min, max, onChange });

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      let next = parsed;
      if (typeof min === 'number') next = Math.max(min, next);
      if (typeof max === 'number') next = Math.min(max, next);
      if (next !== value) onChange(next);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={(el) => {
          inputRef.current = el;
          if (el) {
            el.focus();
            el.select();
          }
        }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setDraft(format(value, step, digits));
            setEditing(false);
          }
        }}
        type="text"
        inputMode="numeric"
        className="w-full rounded-sm border border-input bg-secondary px-1.5 py-0.5 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
      />
    );
  }

  return (
    <button
      type="button"
      onPointerDown={scrub.onPointerDown}
      onClick={(e) => {
        if (scrub.isDragging()) {
          e.preventDefault();
          return;
        }
        setEditing(true);
      }}
      className={cn(
        'w-full rounded-sm border border-input bg-secondary px-1.5 py-0.5 text-right text-xs text-foreground cursor-ew-resize select-none tabular-nums hover:bg-accent',
      )}
    >
      {format(value, step, digits)}
    </button>
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
