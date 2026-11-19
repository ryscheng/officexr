import type { ReactNode } from 'react';

type Slots = {
  topLeft?: ReactNode;
  topCentre?: ReactNode;
  topRight?: ReactNode;
  rightEdge?: ReactNode;
  bottomLeft?: ReactNode;
};

/**
 * Places the in-office HUD in fixed zones around the edges; the top centre stacks toasts and banners.
 *
 * A phone held upright is too narrow for three things side by side along the top, so there the top
 * centre drops below the top row, and it and the top left stop short of the right-hand column (whose
 * widest row, the bell and settings buttons, is 96px). The top left stacks above the top centre, so the
 * call tray it opens covers a banner rather than hiding under it.
 */
export function HudLayout({ topLeft, topCentre, topRight, rightEdge, bottomLeft }: Slots) {
  return (
    <div className="pointer-events-none absolute inset-3 z-20">
      <div
        data-hud-zone="topLeft"
        className="absolute top-0 left-0 z-10 flex flex-col items-start gap-2 pointer-coarse:portrait:right-26"
      >
        {topLeft}
      </div>
      <div
        data-hud-zone="topCentre"
        className="absolute inset-x-0 top-0 flex flex-col items-center gap-2 pointer-coarse:portrait:top-17 pointer-coarse:portrait:right-26"
      >
        {topCentre}
      </div>
      <div className="absolute top-0 right-0 flex max-h-full flex-col items-end gap-2">
        <div data-hud-zone="topRight" className="flex flex-col items-end gap-2">
          {topRight}
        </div>
        {/* The padding keeps the panels' drop shadows inside the scroll box, which would clip them. */}
        <div
          data-hud-zone="rightEdge"
          className="-mr-3 flex min-h-0 flex-col items-end gap-2 overflow-y-auto overscroll-contain pr-3 pb-10 pl-8 pointer-coarse:pb-16"
        >
          {rightEdge}
        </div>
      </div>
      {/* On touch the virtual joystick owns the bottom-left corner, so the zone sits beside it. It spans to
          the right edge so what it holds can size itself to the room that is left (max-w-full). */}
      <div data-hud-zone="bottomLeft" className="absolute right-0 bottom-0 left-0 flex flex-col items-start pointer-coarse:left-30">
        {bottomLeft}
      </div>
    </div>
  );
}
