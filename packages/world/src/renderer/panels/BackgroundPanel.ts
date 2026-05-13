import { useControls } from 'leva';

export interface BackgroundPanelValues {
  topColor: string;
  bottomColor: string;
}

/**
 * Leva "Background" panel. Drives the GradientBackground inverted-sphere
 * vertex colours. Local-only — not broadcast to peers.
 */
export function useBackgroundPanel(): BackgroundPanelValues {
  return useControls('Background', {
    topColor: { value: '#02030a', label: 'top colour' },
    bottomColor: { value: '#1a1238', label: 'bottom colour' },
  });
}
