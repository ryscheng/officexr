import type { ReactNode } from 'react';

export function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block rounded-md border-2 border-b-4 border-hud-edge bg-hud-inset px-1.5 font-hud-title text-xs font-normal text-hud-text">
      {children}
    </kbd>
  );
}
