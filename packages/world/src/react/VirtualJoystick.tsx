import React, { useEffect, useRef, useState } from 'react';
import { NO_MOVE, type MoveInput } from '../renderer/moveIntent.ts';
import { JOYSTICK_DEAD_ZONE, joystickVector } from './joystick.ts';

const BASE_SIZE = 110;
const KNOB_SIZE = 46;
const TRAVEL = (BASE_SIZE - KNOB_SIZE) / 2;

/** Bottom-left on-screen stick; writes its vector to `inputRef` for the scene to read each frame. */
export function VirtualJoystick({ inputRef }: { inputRef: React.MutableRefObject<MoveInput> }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const activePointer = useRef<number | null>(null);

  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const input = joystickVector(
      e.clientX - (rect.left + rect.width / 2),
      e.clientY - (rect.top + rect.height / 2),
      TRAVEL,
      JOYSTICK_DEAD_ZONE,
    );
    inputRef.current = input;
    setKnob({ x: input.x * TRAVEL, y: -input.z * TRAVEL });
  };
  const release = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== activePointer.current) {
      return;
    }
    activePointer.current = null;
    inputRef.current = NO_MOVE;
    setKnob({ x: 0, y: 0 });
  };

  useEffect(() => () => {
    inputRef.current = NO_MOVE;
  }, [inputRef]);

  return (
    <div
      onPointerDown={(e) => {
        if (activePointer.current !== null) {
          return;
        }
        activePointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === activePointer.current) {
          drag(e);
        }
      }}
      onLostPointerCapture={release}
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
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
        pointerEvents: 'auto',
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
