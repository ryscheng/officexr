import { useEffect } from 'react';
import type { Bus, Store } from '@officexr/sdk';
import type { SoundCatalog } from '@officexr/world/app';
import { maybeNotify } from './pingNotifier';
import { readPingPrefs, type PingPrefs, type PingSound } from './pingPrefs';
import { browserPingPlayer, previewPingSound } from './pingSound';
import { senderName } from './senderName';
import { useSoundCatalog } from './useSoundCatalog';

export interface PingReceiverDeps {
  /** Runs on mount, so the sound's gesture unlock is armed before the first ping. */
  prepare(): void;
  readPrefs(): PingPrefs;
  play(sound: PingSound, catalog: SoundCatalog | null): void;
  notify(prefs: PingPrefs, senderName: string): void;
}

const browserDeps: PingReceiverDeps = {
  prepare: () => void browserPingPlayer(),
  readPrefs: () => readPingPrefs(localStorage),
  play: previewPingSound,
  notify: maybeNotify,
};

export function usePingReceiver(bus: Bus, store: Store, deps: PingReceiverDeps = browserDeps): void {
  const catalog = useSoundCatalog();
  useEffect(() => deps.prepare(), [deps]);
  useEffect(
    () =>
      bus.on('ping:received', ({ fromId, intent }) => {
        // The ping inbox still records it; only the sound and notification stay quiet.
        const { players, selfId } = store.getState();
        if (players[selfId]?.focus) {
          return;
        }
        const prefs = deps.readPrefs();
        deps.play(prefs.sound, catalog);
        if (!intent || intent === 'ping') {
          deps.notify(prefs, senderName(store, fromId));
        }
      }),
    [bus, store, catalog, deps],
  );
}
