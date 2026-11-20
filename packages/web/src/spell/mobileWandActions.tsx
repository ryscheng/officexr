import { useMemo, useSyncExternalStore } from 'react';
import { Check, Hammer, Repeat, Wand2 } from 'lucide-react';
import { cycleSpell, SPELLS, type Actions, type SpellId, type Store } from '@officexr/sdk';
import type { PlaceModeStore } from '@officexr/world/motion';
import { useMobileActions, type MobileAction } from '@officexr/world/react';
import { useStoreSelector } from '@officexr/world/top-down';

export interface WandPadState {
  holdingWand: boolean;
  spell: SpellId;
  buildOpen: boolean;
}

/** Cast, spell cycle, place and build buttons of the touch pad; they do what Q, 1-4, Enter and B do. */
export function wandMobileActions(state: WandPadState, handlers: { cycleSpell(): void; toggleBuild(): void; place(): void }): MobileAction[] {
  return [
    {
      id: 'cast',
      slot: 6,
      icon: <Wand2 aria-hidden size={22} />,
      label: `Cast ${SPELLS[state.spell].label}`,
      visible: () => state.holdingWand,
      onPress: ({ input }) => input.press('cast'),
      onRelease: ({ input }) => input.release('cast'),
    },
    {
      id: 'spell-cycle',
      slot: 7,
      icon: <Repeat aria-hidden size={22} />,
      label: `Spell: ${SPELLS[state.spell].label}`,
      visible: () => state.holdingWand && !state.buildOpen,
      onPress: handlers.cycleSpell,
    },
    {
      id: 'place',
      slot: 7,
      icon: <Check aria-hidden size={22} />,
      label: 'Place',
      visible: () => state.buildOpen,
      onPress: handlers.place,
    },
    {
      id: 'build',
      slot: 8,
      icon: <Hammer aria-hidden size={22} />,
      label: state.buildOpen ? 'Stop building' : 'Build',
      active: () => state.buildOpen,
      onPress: handlers.toggleBuild,
    },
  ];
}

/** Adds the wand and build buttons to the touch action pad; renders nothing. */
export function WandMobileActions({ store, actions, selfId, placeMode }: { store: Store; actions: Actions; selfId: string; placeMode: PlaceModeStore }) {
  const holdingWand = useStoreSelector(store, (s) => s.players[selfId]?.held === 'wand');
  const spell = useStoreSelector(store, (s) => s.selectedSpell);
  const buildOpen = useSyncExternalStore(placeMode.subscribe, () => placeMode.get().open);
  const pad = useMemo(
    () =>
      wandMobileActions(
        { holdingWand, spell, buildOpen },
        {
          cycleSpell: () => actions.setSelectedSpell(cycleSpell(store.getState().selectedSpell, 1)),
          toggleBuild: () => placeMode.setOpen(!placeMode.get().open),
          place: () => placeMode.place(),
        },
      ),
    [holdingWand, spell, buildOpen, actions, store, placeMode],
  );
  useMobileActions(pad);
  return null;
}
