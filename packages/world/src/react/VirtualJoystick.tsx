import React, { useEffect, useRef, useState } from 'react';
import { NO_MOVE, type MoveInput } from '../renderer/moveIntent.ts';
import { floatingOrigin, JOYSTICK_DEAD_ZONE, joystickVector } from './joystick.ts';

const BASE_SIZE = 110;
const KNOB_SIZE = 46;
const TRAVEL = (BASE_SIZE - KNOB_SIZE) / 2;

function safeBottomInset(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:var(--hud-safe-bottom, 0px)';
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return px;
}

export function VirtualJoystick({ inputRef, floating = false }: { inputRef: React.MutableRefObject<MoveInput>; floating?: boolean }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const activePointer = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);

  const moveTo = (x: number, y: number, centre?: { x: number; y: number }) => {
    const c = centre ?? originRef.current ?? { x: 0, y: 0 };
    const input = joystickVector(x - c.x, y - c.y, TRAVEL, JOYSTICK_DEAD_ZONE);
    inputRef.current = input;
    setKnob({ x: input.x * TRAVEL, y: -input.z * TRAVEL });
  };
  const release = (e: { pointerId: number }) => {
    if (e.pointerId !== activePointer.current) {
      return;
    }
    activePointer.current = null;
    originRef.current = null;
    setOrigin(null);
    inputRef.current = NO_MOVE;
    setKnob({ x: 0, y: 0 });
  };
  const fixedHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (activePointer.current !== null) {
        return;
      }
      activePointer.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      const r = e.currentTarget.getBoundingClientRect();
      moveTo(e.clientX, e.clientY, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerId === activePointer.current) {
        const r = e.currentTarget.getBoundingClientRect();
        moveTo(e.clientX, e.clientY, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
    },
    onLostPointerCapture: release,
  };

  useEffect(() => () => {
    inputRef.current = NO_MOVE;
  }, [inputRef]);

  useEffect(() => {
    if (!floating) {
      return;
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || activePointer.current !== null || !(e.target instanceof HTMLCanvasElement)) {
        return;
      }
      activePointer.current = e.pointerId;
      const safeBottom = safeBottomInset();
      originRef.current = floatingOrigin({ x: e.clientX, y: e.clientY }, { width: window.innerWidth, height: window.innerHeight - safeBottom }, BASE_SIZE / 2);
      setOrigin(originRef.current);
      moveTo(e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === activePointer.current) {
        moveTo(e.clientX, e.clientY);
      }
    };
    const onEnd = (e: PointerEvent) => release(e);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [floating]);

  const placement = floating && origin ? { left: origin.x - BASE_SIZE / 2, top: origin.y - BASE_SIZE / 2 } : { left: 'var(--hud-inset-left, 12px)', bottom: 'var(--hud-inset-bottom, 12px)' };
  return (
    <div
      data-hud-item="Joystick"
      data-joystick-floating={floating || undefined}
      {...(floating ? {} : fixedHandlers)}
      style={{
        position: floating && origin ? 'fixed' : 'absolute',
        ...placement,
        opacity: floating && !origin ? 0.4 : 1,
        width: BASE_SIZE,
        height: BASE_SIZE,
        borderRadius: '50%',
        background: 'rgba(0, 0, 0, 0.35)',
        border: '2px solid rgba(255, 255, 255, 0.4)',
        boxSizing: 'border-box',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        pointerEvents: floating ? 'none' : 'auto',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          margin: 'auto',
          width: KNOB_SIZE,
          height: KNOB_SIZE,
          borderRadius: '50%',
          background: 'rgba(255, 255, 255, 0.6)',
          transform: `translate(${knob.x}px, ${knob.y}px)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
