import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible.tsx';
import { Switch } from '../../components/ui/switch.tsx';
import { cn } from '../../lib/utils.ts';

interface SectionProps {
  title: string;
  /** When provided, an enable-toggle in the header that gates the
   *  section's contents. `null` enabled state means the body is
   *  visible AND disabled (rare); typically pass `true`/`false`. */
  enabled?: boolean;
  onEnabledChange?: (next: boolean) => void;
  defaultOpen?: boolean;
  /** Hide the body when disabled. Defaults to true — matches the
   *  Leva-style "uncheck → fields vanish" behaviour. */
  hideBodyWhenDisabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Collapsible folder. Replaces Leva's `folder(...)` wrapper. The
 * header is a row with a chevron + title and (optionally) an enable
 * switch on the right. The body holds nested `<Field>`s.
 *
 * Two collapsible behaviours composed:
 *   - `Collapsible` open/closed state controls the visual fold.
 *   - `enabled` toggle (if present) controls whether the body
 *     renders at all OR is just visually dimmed.
 */
export function Section({
  title,
  enabled,
  onEnabledChange,
  defaultOpen = true,
  hideBodyWhenDisabled = true,
  children,
  className,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasEnable = typeof enabled === 'boolean' && !!onEnabledChange;
  const showBody =
    open && (enabled === undefined || enabled || !hideBodyWhenDisabled);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn('border-b border-border', className)}
    >
      <div className="flex items-center justify-between px-3 py-1.5 bg-card">
        <CollapsibleTrigger
          className={cn(
            'flex flex-1 items-center gap-1.5 text-left cursor-pointer',
            'text-[11px] uppercase tracking-wider font-semibold text-secondary-foreground',
            'hover:text-foreground',
          )}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
          )}
          <span>{title}</span>
        </CollapsibleTrigger>
        {hasEnable ? (
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            aria-label={`Enable ${title}`}
            onClick={(e) => e.stopPropagation()}
          />
        ) : null}
      </div>
      <CollapsibleContent>
        {showBody ? <div className="py-1">{children}</div> : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
