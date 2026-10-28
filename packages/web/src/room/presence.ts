import type { MicState, PresenceStatus } from '@officexr/sdk';

export const presenceStatus = ({ hidden, focused }: { hidden: boolean; focused: boolean }): PresenceStatus =>
  hidden || !focused ? 'away' : 'available';

export const micState = ({ inCall, muted, speaking }: { inCall: boolean; muted: boolean; speaking: boolean }): MicState =>
  !inCall ? 'none' : muted ? 'muted' : speaking ? 'speaking' : 'silent';
