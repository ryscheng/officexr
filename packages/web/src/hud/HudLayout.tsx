import type { ReactNode } from 'react';

type Slots = {
  topLeft?: ReactNode;
  topCentre?: ReactNode;
  topRight?: ReactNode;
  rightEdge?: ReactNode;
  bottomCentre?: ReactNode;
  bottomLeft?: ReactNode;
};

/** Places the in-office HUD in fixed zones around the edges; the top centre stacks toasts and banners. */
export function HudLayout({ topLeft, topCentre, topRight, rightEdge, bottomCentre, bottomLeft }: Slots) {
  return (
    <div className="pointer-events-none absolute inset-3 z-20">
      <div data-hud-zone="topLeft" className="absolute top-0 left-0 flex flex-col items-start gap-2">
        {topLeft}
      </div>
      <div data-hud-zone="topCentre" className="absolute inset-x-0 top-0 flex flex-col items-center gap-2">
        {topCentre}
      </div>
      <div className="absolute top-0 right-0 flex max-h-full flex-col items-end gap-2">
        <div data-hud-zone="topRight" className="flex flex-col items-end gap-2">
          {topRight}
        </div>
        {/* The padding keeps the panels' drop shadows inside the scroll box, which would clip them. */}
        <div
          data-hud-zone="rightEdge"
          className="-mr-3 flex min-h-0 flex-col items-end gap-2 overflow-y-auto overscroll-contain pr-3 pb-10 pl-8"
        >
          {rightEdge}
        </div>
      </div>
      <div
        data-hud-zone="bottomCentre"
        className="absolute inset-x-0 bottom-0 flex justify-center pointer-coarse:justify-end"
      >
        {bottomCentre}
      </div>
      {/* On touch the virtual joystick owns the bottom-left corner, so the zone sits beside it. */}
      <div data-hud-zone="bottomLeft" className="absolute bottom-0 left-0 pointer-coarse:left-30">
        {bottomLeft}
      </div>
    </div>
  );
}
