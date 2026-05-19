/**
 * `<BakeStatusBar>` — slim global indicator that mounts directly
 * below the studio header. Subscribes to the `BakeRegistry` and shows
 * the count of in-flight bakes (`pending` + `running`) plus the
 * number of failed bakes since the tab opened. Clicking the bar
 * toggles a top-anchored drawer with one row per layout the
 * registry knows about.
 *
 * The status bar is the closest thing the studio has to a global
 * activity surface — it intentionally renders even when there is no
 * bake activity, so the user always knows where to look. When idle
 * it's a thin neutral strip; when something is happening the
 * background tints + the count is shown.
 *
 * SRP: this file does NOT trigger bakes. It only renders the state
 * the registry already publishes. Triggering happens inside
 * `useLayoutDocument` (`afterSave` → `scheduleBake`).
 *
 * UI uses shadcn primitives (`Collapsible`, `Button`) so the styling
 * threads into the project's design tokens (`bg-primary`, `text-...`,
 * etc.) rather than carrying bespoke inline color literals. The
 * spinner is the only piece of bespoke CSS — a CSS-keyframes-only
 * 8px spinner injected once.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible.tsx';
import { cn } from '../lib/utils.ts';
import {
  listAllBakes,
  subscribe as registrySubscribe,
  type BakeState,
} from '@officexr/world/app';

interface BakeRow {
  layoutName: string;
  state: BakeState;
  version: number;
  lastError?: string;
}

function useBakeRegistrySnapshot(): BakeRow[] {
  // Synchronous initial snapshot so the bar paints correctly on the
  // first render — no flicker through "no bakes yet."
  const [rows, setRows] = useState<BakeRow[]>(() => listAllBakes());

  useEffect(() => {
    // Re-snapshot the whole registry on any per-name transition. The
    // registry is small (one entry per layout the user has touched
    // this session), so the O(n) re-read is cheap and avoids a
    // bespoke diff path here.
    const unsub = registrySubscribe(() => {
      setRows(listAllBakes());
    });
    return unsub;
  }, []);

  return rows;
}

export function BakeStatusBar() {
  const rows = useBakeRegistrySnapshot();
  const [open, setOpen] = useState(false);

  const counts = useMemo(() => {
    let active = 0;
    let errored = 0;
    let settled = 0;
    for (const r of rows) {
      if (r.state === 'pending' || r.state === 'running') active++;
      else if (r.state === 'error') errored++;
      else if (r.state === 'settled') settled++;
    }
    return { active, errored, settled, total: rows.length };
  }, [rows]);

  const isActive = counts.active > 0;
  const hasError = counts.errored > 0;

  const summary = isActive
    ? `Baking ${counts.active} layout${counts.active === 1 ? '' : 's'}…`
    : hasError
      ? `${counts.errored} bake${counts.errored === 1 ? '' : 's'} failed`
      : counts.total > 0
        ? `${counts.settled} layout${counts.settled === 1 ? '' : 's'} baked`
        : 'No bakes yet this session';

  // Color theme keyed to state — uses Tailwind utility classes so the
  // theme tokens flow through. Active takes priority over error so a
  // recovering bake reads as "in progress."
  const tone = isActive
    ? 'bg-blue-950 text-blue-300'
    : hasError
      ? 'bg-red-950 text-red-300'
      : 'bg-neutral-900 text-neutral-400';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          'flex w-full cursor-pointer select-none items-center justify-between border-b border-neutral-800 px-3 py-1 font-mono text-[11px] tracking-wider transition-colors',
          tone,
        )}
        aria-label="Toggle bake status drawer"
      >
        <span className="flex items-center gap-2">
          {isActive ? <Spinner /> : <Dot />}
          <span>{summary}</span>
        </span>
        <span className="text-[10px] opacity-70">
          {open ? '▲ hide' : '▼ details'}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <BakeDrawer rows={rows} />
      </CollapsibleContent>
    </Collapsible>
  );
}

interface BakeDrawerProps {
  rows: BakeRow[];
}

function BakeDrawer({ rows }: BakeDrawerProps) {
  // Sort: active first (running before pending), then error, then
  // settled, then idle. Within each bucket, alphabetical by name.
  const sorted = useMemo(() => {
    const rank: Record<BakeState, number> = {
      running: 0,
      pending: 1,
      error: 2,
      settled: 3,
      idle: 4,
    };
    return [...rows].sort((a, b) => {
      const r = rank[a.state] - rank[b.state];
      if (r !== 0) return r;
      return a.layoutName.localeCompare(b.layoutName);
    });
  }, [rows]);

  return (
    <div className="absolute inset-x-0 z-50 max-h-[40vh] overflow-y-auto border-b border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-200 shadow-lg">
      {sorted.length === 0 ? (
        <div className="text-neutral-400">
          No layouts have been baked in this session. Open the Layout
          editor and make an edit to trigger a bake.
        </div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-neutral-400">
              <th className="px-2 py-1 text-left">Layout</th>
              <th className="px-2 py-1 text-left">State</th>
              <th className="px-2 py-1 text-left">Version</th>
              <th className="px-2 py-1 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.layoutName} className="border-t border-neutral-800">
                <td className="px-2 py-1 align-middle">{r.layoutName}</td>
                <td className="px-2 py-1 align-middle">
                  <StateChip state={r.state} />
                </td>
                <td className="px-2 py-1 align-middle text-neutral-400">{r.version}</td>
                <td
                  className={cn(
                    'px-2 py-1 align-middle',
                    r.lastError ? 'text-red-400' : 'text-neutral-500',
                  )}
                >
                  {r.lastError ?? (r.state === 'settled' ? 'OK' : '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StateChip({ state }: { state: BakeState }) {
  const tone: Record<BakeState, string> = {
    idle: 'bg-neutral-800 text-neutral-400',
    pending: 'bg-blue-950 text-blue-300',
    running: 'bg-blue-950 text-blue-200',
    settled: 'bg-emerald-950 text-emerald-400',
    error: 'bg-red-950 text-red-300',
  };
  return (
    <span
      className={cn(
        'inline-block rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider',
        tone[state],
      )}
    >
      {state}
    </span>
  );
}

// --- Tiny inline indicators -----------------------------------------------

function Dot() {
  return <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />;
}

function Spinner() {
  injectKeyframesOnce();
  // currentColor border so the spinner picks up the tone class on
  // the parent (text-blue-300 / text-red-300 / ...).
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 rounded-full border-2 border-current"
      style={{
        borderTopColor: 'transparent',
        animation: 'officexr-bake-spinner 0.8s linear infinite',
      }}
    />
  );
}

// Keyframes can't be expressed as Tailwind utilities (the rule needs
// a `@keyframes` block). Inject once at first render in the browser;
// no-op in SSR / test environments where `document` is absent.
let keyframesInjected = false;
function injectKeyframesOnce() {
  if (keyframesInjected) return;
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent =
    '@keyframes officexr-bake-spinner { to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
  keyframesInjected = true;
}
