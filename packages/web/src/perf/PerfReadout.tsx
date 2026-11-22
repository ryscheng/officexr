import type { CameraMode } from '@officexr/world/renderer';
import { usePerfSummary } from './perfStats';

export function PerfReadout({ mode }: { mode: CameraMode }) {
  const summary = usePerfSummary();
  return (
    <div
      role="status"
      aria-label="Performance"
      className="pointer-events-none fixed bottom-2 left-2 z-40 rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] leading-tight text-white"
    >
      {summary ? (
        <>
          <div>
            {summary.fps.toFixed(0)} fps, {summary.medianMs.toFixed(1)} ms median, {summary.worstMs.toFixed(0)} ms worst (5 s)
          </div>
          <div>
            {summary.drawCalls} draws, {summary.triangles.toLocaleString()} tris, {mode}
          </div>
        </>
      ) : (
        <div>Measuring…</div>
      )}
    </div>
  );
}
