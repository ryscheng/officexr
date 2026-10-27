/**
 * `<CanvasFrameStats>` — one-liner for editor canvases: mounts the
 * renderer's `<FrameStatsProbe>` pre-wired to the studio frame-stats
 * bus, so every mode's Canvas feeds the shared `<PerfFooter>` the
 * same way. Must be rendered INSIDE an R3F `<Canvas>`.
 *
 * (Debug mode doesn't use this — it owns no raw Canvas; it passes
 * `publishFrameStats` to `<Scene onFrameStats>` instead.)
 */

import React from 'react';
import { FrameStatsProbe } from '@officexr/world/renderer';
import { publishFrameStats } from './frame-stats.ts';

export function CanvasFrameStats() {
  return <FrameStatsProbe onSample={publishFrameStats} />;
}
