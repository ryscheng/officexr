import { useEffect, useRef } from 'react';
import { loginOf, type Bus, type Store } from '@officexr/sdk';
import type { SoundCatalog } from '@officexr/world/app';
import { maybeNotify } from './pingNotifier';
import { readPingPrefs, type PingPrefs, type PingSound } from './pingPrefs';
import { playPingSound } from './pingSound';
import { useSoundCatalog } from './useSoundCatalog';

export interface PingReceiverDeps {
  readPrefs(): PingPrefs;
  play(sound: PingSound, catalog: SoundCatalog | null): void;
  notify(prefs: PingPrefs, senderName: string): void;
}

const browserDeps: PingReceiverDeps = { readPrefs: readPingPrefs, play: playPingSound, notify: maybeNotify };

/** Plays the chosen sound, and maybe notifies, when another player pings the local one. */
export function usePingReceiver(bus: Bus, store: Store, deps: PingReceiverDeps = browserDeps): void {
  const catalog = useSoundCatalog();
  const latest = useRef({ catalog, deps });
  latest.current = { catalog, deps };
  useEffect(
    () =>
      bus.on('ping:received', ({ fromId }) => {
        const { catalog, deps } = latest.current;
        const prefs = deps.readPrefs();
        deps.play(prefs.sound, catalog);
        deps.notify(prefs, store.getState().players[fromId]?.name ?? loginOf(fromId));
      }),
    [bus, store],
  );
}
