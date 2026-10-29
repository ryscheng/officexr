import type { PresenceIndicator } from '@officexr/sdk';

export const PRESENCE_INDICATOR = {
  available: { label: 'Available', dot: 'bg-green-500' },
  away: { label: 'Away', dot: 'bg-yellow-400' },
  unresponsive: { label: 'Unresponsive', dot: 'bg-red-500' },
  offline: { label: 'Offline', dot: 'bg-red-500' },
} satisfies Record<PresenceIndicator, { label: string; dot: string }>;
