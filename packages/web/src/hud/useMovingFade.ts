import { useEffect, useState } from 'react';
import type { OfficeState } from '@officexr/sdk';

export const FADE_AFTER_MS = 1500;
export const FADE_BACK_MS = 500;

const MOVING_SPEED = 0.1;

export const selectSelfMoving = (s: OfficeState): boolean => {
  const vel = s.players[s.selfId]?.vel;
  return vel !== undefined && Math.hypot(vel.x, vel.z) > MOVING_SPEED;
};

export function useMovingFade(moving: boolean, enabled = true): boolean {
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFaded(moving), moving ? FADE_AFTER_MS : FADE_BACK_MS);
    return () => clearTimeout(timer);
  }, [moving]);
  return enabled && faded;
}
