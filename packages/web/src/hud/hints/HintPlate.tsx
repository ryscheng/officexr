import { forwardRef, type CSSProperties } from 'react';
import type { HintArrow } from './placeHint';

const ARROW_HALF = 6;

function arrowStyle({ side, offset }: HintArrow): CSSProperties {
  if (side === 'down') {
    return { left: offset - ARROW_HALF, bottom: -5 };
  }
  if (side === 'up') {
    return { left: offset - ARROW_HALF, top: -5 };
  }
  return { right: -5, top: offset - ARROW_HALF };
}

export const HintPlate = forwardRef<HTMLDivElement, { name: string; text: string; arrow: HintArrow | null; visible: boolean; style?: CSSProperties; className?: string }>(
  function HintPlate({ name, text, arrow, visible, style, className = '' }, ref) {
    return (
      <div
        ref={ref}
        role="status"
        data-hint={name}
        style={style}
        className={`pointer-events-none z-30 w-max max-w-60 rounded-2xl bg-hud-text px-4 py-2.5 font-hud-body text-base leading-[22px] font-semibold text-hud-panel-solid shadow-hud-panel transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'} ${className}`}
      >
        {text}
        {arrow && <span aria-hidden className="absolute size-3 rotate-45 bg-hud-text" style={arrowStyle(arrow)} />}
      </div>
    );
  },
);
