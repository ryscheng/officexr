/**
 * `<FrameStatsProbe>` — null-rendering renderer primitive that samples
 * the live frame rate and WebGL render stats of the R3F canvas it is
 * mounted inside, and reports them through a plain callback.
 *
 * The probe is the renderer-side half of the studio's perf footer:
 * the studio passes a publish function down (Scene's `onFrameStats`
 * prop, or mounting this component directly inside an editor Canvas),
 * and renders the samples in DOM UI outside the canvas. The renderer
 * knows nothing about where the samples go (DIP — same direction as
 * every other Scene callback).
 *
 * Sampling strategy: count frames + accumulate real elapsed time in a
 * `useFrame` callback, and emit one aggregated sample every
 * `intervalMs`. Emitting per-interval (not per-frame) keeps the DOM
 * side from re-rendering 60×/s. `gl.info` is read at the sample
 * boundary — three.js resets those counters every render, so the
 * values describe the most recently completed frame, which is exactly
 * what a status readout wants.
 *
 * `three` types are allowed here (renderer file per CLAUDE.md rules).
 */

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';

/** One aggregated sample of canvas render performance. */
export interface FrameStatsSample {
  /** Frames completed per second, averaged over the sample window. */
  fps: number;
  /** Mean frame-to-frame delta over the window, in milliseconds. */
  frameMs: number;
  /** WebGL draw calls in the last rendered frame (`gl.info.render.calls`). */
  drawCalls: number;
  /** Triangles rasterised in the last rendered frame. */
  triangles: number;
  /** Live geometry count (`gl.info.memory.geometries`). */
  geometries: number;
  /** Live texture count (`gl.info.memory.textures`). */
  textures: number;
}

export interface FrameStatsProbeProps {
  /**
   * Receives a fresh sample once per interval while the probe is
   * mounted, and `null` exactly once on unmount so consumers can
   * clear a "live" readout when the canvas goes away.
   */
  onSample: (sample: FrameStatsSample | null) => void;
  /** Sample window length. Default 500 ms (2 updates/s). */
  intervalMs?: number;
}

export function FrameStatsProbe({
  onSample,
  intervalMs = 500,
}: FrameStatsProbeProps) {
  // Keep the latest callback in a ref so a parent re-render with a new
  // function identity doesn't reset the sample window.
  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;

  const windowRef = useRef({ frames: 0, elapsed: 0 });

  useFrame(({ gl }, delta) => {
    const w = windowRef.current;
    w.frames += 1;
    w.elapsed += delta;
    if (w.elapsed * 1000 < intervalMs) return;

    const { render, memory } = gl.info;
    onSampleRef.current({
      fps: w.frames / w.elapsed,
      frameMs: (w.elapsed / w.frames) * 1000,
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
    });
    w.frames = 0;
    w.elapsed = 0;
  });

  // Clear the consumer's readout when the canvas (or just the probe)
  // unmounts — otherwise the footer would keep showing the last sample
  // of a canvas that no longer exists.
  useEffect(() => {
    return () => onSampleRef.current(null);
  }, []);

  return null;
}
