import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Bus, Store } from '@officexr/sdk';
import { pokeCue, SoundDirector } from '../audio/cues.ts';
import { useSfx } from '../audio/sfx-context.tsx';

/** Feeds the sound engine: the listener is the self player, and every player's pose, hand and pokes become cues. */
export function SoundDriver({ store, bus }: { store: Store; bus: Bus }) {
  const sfx = useSfx();
  const director = useMemo(() => new SoundDirector(), []);

  useEffect(() => {
    if (!sfx) return;
    return bus.on('poke:received', ({ fromId }) => {
      const from = store.getState().players[fromId];
      if (from) sfx.play(pokeCue(from.pos));
    });
  }, [bus, store, sfx]);

  useFrame(() => {
    if (!sfx) return;
    sfx.tick();
    const state = store.getState();
    const self = state.players[state.selfId];
    if (self) sfx.setListener(self.pos);
    for (const cue of director.frame(state.players, performance.now())) sfx.play(cue);
  });
  return null;
}
