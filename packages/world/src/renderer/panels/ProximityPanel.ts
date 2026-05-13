import { useEffect } from 'react';
import { useControls } from 'leva';
import type { Actions } from '@officexr/sdk';

export interface ProximityPanelValues {
  sensorRadius: number;
  outerRadius: number;
  enterDebounceMs: number;
  discRadius: number;
  pulseSpeed: number;
  intensity: number;
  enteringColor: string;
  enteredColor: string;
  exitingColor: string;
  meetingBorderInset: number;
  meetingBorderOutset: number;
  sparkleSpeed: number;
  sparkleFloatHeight: number;
  conversationDistance: number;
  conversationHeight: number;
  sparkleSize: number;
}

/**
 * Leva "Proximity" panel. Drives the per-player + MeetingArea visual
 * styling AND broadcasts the proximity-ring geometry / conversation
 * camera framing into world settings so every client (including
 * server-side bots) agrees.
 *
 * Returns the raw values because the ProximityGlow renderer needs
 * several of them (colours, pulse speed, sparkle knobs) directly —
 * they aren't part of the broadcast WorldSettings shape.
 */
export function useProximityPanel(actions: Actions): ProximityPanelValues {
  const values = useControls('Proximity', {
    sensorRadius: {
      value: 3,
      min: 0.5,
      max: 20,
      step: 0.1,
      label: 'inner radius (m)',
    },
    outerRadius: {
      value: 6,
      min: 1,
      max: 30,
      step: 0.1,
      label: 'outer radius (m)',
    },
    enterDebounceMs: {
      value: 500,
      min: 0,
      max: 2000,
      step: 10,
      label: 'enter delay (ms)',
    },
    discRadius: {
      value: 1.6,
      min: 0.2,
      max: 5,
      step: 0.05,
      label: 'disc radius (m)',
    },
    pulseSpeed: {
      value: 0.8,
      min: 0.05,
      max: 4,
      step: 0.05,
      label: 'pulse (Hz)',
    },
    intensity: { value: 1.0, min: 0, max: 3, step: 0.05 },
    enteringColor: { value: '#ffd24a', label: 'entering colour' },
    enteredColor: { value: '#7be67b', label: 'entered colour' },
    exitingColor: { value: '#ff8c42', label: 'exiting colour' },
    meetingBorderInset: {
      value: 0.05,
      min: 0,
      max: 2,
      step: 0.01,
      label: 'border inset (m)',
    },
    meetingBorderOutset: {
      value: 0.05,
      min: 0,
      max: 2,
      step: 0.01,
      label: 'border outset (m)',
    },
    sparkleSpeed: {
      value: 1.5,
      min: 0,
      max: 8,
      step: 0.1,
      label: 'bubble rise speed',
    },
    sparkleFloatHeight: {
      value: 1.5,
      min: 0.1,
      max: 6,
      step: 0.1,
      label: 'bubble rise height (m)',
    },
    conversationDistance: {
      value: 7,
      min: 2,
      max: 30,
      step: 0.25,
      label: 'convo cam dist (m)',
    },
    conversationHeight: {
      value: 5,
      min: 1,
      max: 30,
      step: 0.25,
      label: 'convo cam height (m)',
    },
    sparkleSize: {
      value: 1,
      min: 0.2,
      max: 10,
      step: 0.1,
      label: 'sparkle size ×',
    },
  });

  useEffect(() => {
    actions.setWorldSettings({
      proximityRadius: values.sensorRadius,
      proximityOuterRadius: values.outerRadius,
      proximityEnterDebounceMs: values.enterDebounceMs,
      conversationCameraDistance: values.conversationDistance,
      conversationCameraHeight: values.conversationHeight,
    });
  }, [
    actions,
    values.sensorRadius,
    values.outerRadius,
    values.enterDebounceMs,
    values.conversationDistance,
    values.conversationHeight,
  ]);

  return values;
}
