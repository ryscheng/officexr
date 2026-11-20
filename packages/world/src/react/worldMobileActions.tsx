import React from 'react';
import type { InteractKind } from '../input/action-context.ts';
import type { MobileAction } from './mobile-actions.ts';
import { DismountIcon, JumpIcon, PokeIcon, RideIcon, SitIcon, SprintIcon } from './mobileIcons.tsx';

const INTERACT: Record<InteractKind, { label: string; icon: React.ReactNode; action: string }> = {
  ride: { label: 'Ride', icon: <RideIcon />, action: 'mount' },
  dismount: { label: 'Get off', icon: <DismountIcon />, action: 'mount' },
  sit: { label: 'Sit', icon: <SitIcon />, action: 'sit' },
};

/** The movement actions the world itself handles; each presses the action its keyboard key stands for. */
export const WORLD_MOBILE_ACTIONS: readonly MobileAction[] = [
  {
    id: 'jump',
    slot: 0,
    icon: <JumpIcon />,
    label: 'Jump',
    onPress: ({ input }) => input.press('jump'),
    onRelease: ({ input }) => input.release('jump'),
  },
  {
    id: 'sprint',
    slot: 1,
    icon: <SprintIcon />,
    label: 'Sprint',
    onPress: ({ input }) => input.press('sprint'),
    onRelease: ({ input }) => input.release('sprint'),
  },
  {
    id: 'interact',
    slot: 2,
    icon: ({ interact }) => INTERACT[interact ?? 'ride'].icon,
    label: ({ interact }) => INTERACT[interact ?? 'ride'].label,
    visible: ({ interact }) => interact !== null,
    onPress: ({ input, interact }) => interact && input.press(INTERACT[interact].action),
    onRelease: ({ input }) => {
      input.release('mount');
      input.release('sit');
    },
  },
  {
    id: 'poke',
    slot: 3,
    icon: <PokeIcon />,
    label: 'Poke',
    onPress: ({ input }) => input.press('poke'),
    onRelease: ({ input }) => input.release('poke'),
  },
];
