import React, { useEffect, useState } from 'react';
import { HexColorPicker } from 'react-colorful';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover.tsx';
import { Field } from './Field.tsx';
import { cn } from '../../lib/utils.ts';

interface ColorInputProps {
  label: React.ReactNode;
  /** Hex string. Always 7 chars (`#rrggbb`). The hook normalises
   *  uppercase / shorthand input. */
  value: string;
  onChange: (next: string) => void;
  hint?: string;
  className?: string;
}

/**
 * Hex color picker. The trigger is a small swatch chip; clicking it
 * opens a Radix Popover containing react-colorful's `HexColorPicker`
 * + a text input for typing exact values.
 *
 * Why react-colorful (vs e.g. an `<input type="color">`): the native
 * picker varies wildly across OSes and doesn't match the studio
 * chrome at all. react-colorful is 2 kB, fully styleable, and ships
 * a clean H/SV gradient + hue slider.
 */
export function ColorInput({
  label,
  value,
  onChange,
  hint,
  className,
}: ColorInputProps) {
  // Local draft for the text input so partial typing ("#ff" without
  // 6 hex digits) doesn't fire onChange every keystroke.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commitDraft = () => {
    const normalized = normalizeHex(draft);
    if (normalized) onChange(normalized);
    else setDraft(value);
  };

  return (
    <Field label={label} hint={hint} className={className}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex items-center gap-2 rounded-sm border border-input bg-secondary px-1.5 py-0.5 text-xs hover:bg-accent cursor-pointer w-full',
            )}
            title={hint ?? 'Click to pick a color'}
          >
            <span
              className="h-3.5 w-3.5 rounded-sm border border-black/30 shrink-0"
              style={{ background: value }}
              aria-hidden
            />
            <span className="tabular-nums">{value}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-auto p-3 space-y-2"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <HexColorPicker color={value} onChange={onChange} />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDraft();
            }}
            spellCheck={false}
            className="w-full rounded-sm border border-input bg-secondary px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
          />
        </PopoverContent>
      </Popover>
    </Field>
  );
}

function normalizeHex(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    // Expand shorthand: #abc → #aabbcc.
    return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  return null;
}
