import type { PresenceIndicator } from '@officexr/sdk';

/** `dot` colours an HTML element, `fill` the same colour for SVG. */
export const PRESENCE_INDICATOR = {
  available: { label: 'Available', dot: 'bg-green-500', fill: 'fill-green-500' },
  away: { label: 'Away', dot: 'bg-yellow-400', fill: 'fill-yellow-400' },
  unresponsive: { label: 'Unresponsive', dot: 'bg-red-500', fill: 'fill-red-500' },
  offline: { label: 'Offline', dot: 'bg-red-500', fill: 'fill-red-500' },
} satisfies Record<PresenceIndicator, { label: string; dot: string; fill: string }>;
