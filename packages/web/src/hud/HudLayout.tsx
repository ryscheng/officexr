import type { ReactNode } from 'react';

type Slots = {
  topLeft?: ReactNode;
  topRight?: ReactNode;
  rightEdge?: ReactNode;
  bottomCentre?: ReactNode;
  bottomLeft?: ReactNode;
};

/** Places the in-office HUD in fixed zones around the edges, leaving the top centre to toasts and banners. */
export function HudLayout({ topLeft, topRight, rightEdge, bottomCentre, bottomLeft }: Slots) {
  return (
    <div className="pointer-events-none absolute inset-3 z-20">
      <div data-hud-zone="topLeft" className="absolute top-0 left-0 flex flex-col items-start gap-2">
        {topLeft}
      </div>
      <div className="absolute top-0 right-0 flex max-h-full flex-col items-end gap-2">
        <div data-hud-zone="topRight" className="flex flex-col items-end gap-2">
          {topRight}
        </div>
        <div data-hud-zone="rightEdge" className="flex min-h-0 flex-col items-end gap-2">
          {rightEdge}
        </div>
      </div>
      <div data-hud-zone="bottomCentre" className="absolute bottom-0 left-1/2 -translate-x-1/2">
        {bottomCentre}
      </div>
      {/* On touch the virtual joystick owns the bottom-left corner. */}
      <div data-hud-zone="bottomLeft" className="absolute bottom-0 left-0 pointer-coarse:bottom-30">
        {bottomLeft}
      </div>
    </div>
  );
}
