import { useEffect } from 'react';

export const FOCUS_TOAST_MS = 3500;

export type FocusNotice = { name: string; n: number };

export function FocusPingToast({ notice, onDone }: { notice: FocusNotice | null; onDone: () => void }) {
  useEffect(() => {
    if (notice === null) {
      return;
    }
    const id = setTimeout(onDone, FOCUS_TOAST_MS);
    return () => clearTimeout(id);
  }, [notice, onDone]);
  return (
    <div role="status">
      {notice !== null && (
        <div className="rounded-hud-control bg-hud-amber px-4 py-2 text-center font-hud-body text-sm font-semibold text-hud-amber-text shadow-hud-control">
          {notice.name} is in focus mode. Your ping arrives silently.
        </div>
      )}
    </div>
  );
}
