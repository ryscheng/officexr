import type { ReactNode } from 'react';

export function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block min-w-6 rounded-md border border-hud-hairline bg-hud-surface px-1.5 py-px text-center font-hud-body text-[11px] font-medium text-hud-text-2 shadow-[0_1px_0_rgb(0_0_0/0.08)]">
      {children}
    </kbd>
  );
}
