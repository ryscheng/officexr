/**
 * `<PerfFooter>` — slim global status strip pinned to the bottom of
 * the studio. The bottom counterpart of `<BakeStatusBar>`: where the
 * top bar reports bake activity, this one reports live render
 * performance for whichever mode's canvas is currently mounted —
 * FPS, frame time, WebGL draw calls, triangles, and live
 * geometry/texture counts.
 *
 * Draw calls + triangles are the headline numbers for judging whether
 * a baked layout actually beats the instanced per-object path: the
 * instanced renderer costs ~one draw call per kind, while a baked GLB
 * costs one draw call per mesh node it ships.
 *
 * SRP: this file does NOT measure anything. It renders the samples
 * the frame-stats bus already publishes; measurement happens inside
 * the canvases (`<FrameStatsProbe>` / Scene's `onFrameStats`).
 */

import React from 'react';
import { cn } from '../lib/utils.ts';
import { useFrameStats } from '../perf/frame-stats.ts';

/** 1234567 → "1,234,567" — keeps big triangle counts scannable. */
function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function PerfFooter() {
  const stats = useFrameStats();

  // FPS tone thresholds: ≥50 healthy, 30–50 strained, <30 in trouble.
  const fpsTone =
    stats === null
      ? 'text-neutral-500'
      : stats.fps >= 50
        ? 'text-green-400'
        : stats.fps >= 30
          ? 'text-amber-400'
          : 'text-red-400';

  return (
    <footer
      className={cn(
        'flex w-full select-none items-center gap-4 border-t border-neutral-800',
        'bg-neutral-900 px-3 py-1 font-mono text-[11px] tracking-wider text-neutral-400',
      )}
    >
      {stats === null ? (
        <span className="text-neutral-600">render stats: no live canvas</span>
      ) : (
        <>
          <Metric label="fps" value={stats.fps.toFixed(0)} valueClass={fpsTone} />
          <Metric label="frame" value={`${stats.frameMs.toFixed(1)} ms`} />
          <Metric label="draws" value={fmt(stats.drawCalls)} />
          <Metric label="tris" value={fmt(stats.triangles)} />
          <Metric label="geom" value={fmt(stats.geometries)} />
          <Metric label="tex" value={fmt(stats.textures)} />
        </>
      )}
    </footer>
  );
}

function Metric({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase text-neutral-600">{label}</span>
      <span className={cn('tabular-nums text-neutral-300', valueClass)}>
        {value}
      </span>
    </span>
  );
}
