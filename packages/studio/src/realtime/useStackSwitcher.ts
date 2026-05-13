import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotMode } from '@officexr/world/bot';
import {
  buildInMemoryStack,
  buildWsStack,
  type ChannelStack,
  type PersistentLocalState,
} from './services.ts';
import {
  browserRealtimeConfig,
  isRealtimeServerAvailable,
} from './realtime-config.ts';

export interface UseStackSwitcherOpts {
  /** Persistent local-player state (created once on mount and reused
   * across stack swaps). The hook does not own this — the caller does
   * — so its lifetime survives any temporary teardown the hook does. */
  local: PersistentLocalState | null;
  /** Audio element used for the proximity-driven elevator music. Same
   * persistence reasoning as `local`. */
  audio: HTMLAudioElement | null;
  /** ≥ this many bots forces the ws-server path (each bot is a real
   * peer in the Node `bots:start` process); below it the in-browser
   * InMemoryChannel pool runs the bots with zero infra. */
  wsThreshold?: number;
}

export interface UseStackSwitcherResult {
  /** The current channel stack — null until bootstrap finishes. */
  stack: ChannelStack | null;
  /** Persistent error string set when ws promotion was requested but
   * the realtime-server failed its health probe. Click-to-dismiss
   * is wired via {@link dismissError}. */
  errorBanner: string | null;
  dismissError: () => void;
  /** Apply a new target bot count. Promotes to ws if `count ≥
   * wsThreshold` (default 2) and we aren't already there; demotes
   * back to in-memory otherwise. Rapid changes are serialised
   * behind a single transitionChain so they converge to the latest
   * target value rather than interleaving teardowns. */
  onBotCountChange: (count: number) => void;
  /** Apply a new bot mode. In ws mode this publishes the mode to
   * the realtime-server CLI; in in-memory mode it forwards to the
   * in-browser BotPool directly. */
  onBotModeChange: (mode: BotMode) => void;
}

/**
 * Owns the in-memory ↔ ws stack-swap state machine that used to live
 * inline in `DebugOfficePage`. Bundles the transition chain, target
 * count/mode refs, stack ref-mirror, and error-banner state behind a
 * single hook so the page becomes a thin render shell.
 */
export function useStackSwitcher(
  opts: UseStackSwitcherOpts,
): UseStackSwitcherResult {
  const { local, audio, wsThreshold = 2 } = opts;
  const [stack, setStack] = useState<ChannelStack | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  /** Latest target bot count requested by the user. The promotion
   * promise reads this so a rapid slider drag converges to the most
   * recent value rather than each intermediate one. */
  const targetCountRef = useRef<number>(1);
  /** Latest mode chosen via Leva buttons. Replays into the new pool
   * after a stack swap. */
  const targetModeRef = useRef<BotMode>('idle');
  /** Serialise stack swaps + count applies so a drag-storm in Leva
   * doesn't interleave teardowns and rebuilds. */
  const transitionChain = useRef<Promise<void>>(Promise.resolve());
  /** Ref-mirror of `stack` so the callbacks can read the latest
   * stack without being recreated on each setStack. */
  const stackRef = useRef<ChannelStack | null>(null);
  useEffect(() => {
    stackRef.current = stack;
  }, [stack]);
  /** Ref-mirrors of `local` and `audio` so the callbacks below can
   * read them without listing them in their dep arrays — listing them
   * would flip the callback's identity once during bootstrap (when
   * both go from null → object refs), which in turn re-fires the
   * count-mirror `useEffect` in `BotPanel` and causes a redundant
   * `bots.setCount(1)` on the freshly-built stack. */
  const localRef = useRef<PersistentLocalState | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    localRef.current = local;
  }, [local]);
  useEffect(() => {
    audioRef.current = audio;
  }, [audio]);

  // Bootstrap: build the initial in-memory stack once we have a
  // persistent local-player bundle to attach it to.
  useEffect(() => {
    if (!local || !audio) return;
    let aborted = false;
    let teardown: (() => Promise<void>) | null = null;

    async function bootstrap() {
      const initial = await buildInMemoryStack({ local: local!, audio: audio! });
      if (aborted) {
        await initial.teardown();
        return;
      }
      await initial.bots.setCount(targetCountRef.current);
      setStack(initial);
      teardown = async () => {
        await initial.teardown();
      };
    }

    void bootstrap().catch((err) => {
      console.error('[debug-app] bootstrap error:', err);
    });

    return () => {
      aborted = true;
      if (teardown) {
        void teardown();
        teardown = null;
      }
    };
  }, [local, audio]);

  // Deps are deliberately `[wsThreshold]` only. `local`/`audio` are
  // read through refs so the callback identity stays stable across
  // the bootstrap state-set — see the ref-mirrors above.
  const onBotCountChange = useCallback(
    (count: number) => {
      targetCountRef.current = Math.max(0, Math.floor(count));
      transitionChain.current = transitionChain.current
        .then(async () => {
          const current = stackRef.current;
          const localNow = localRef.current;
          const audioNow = audioRef.current;
          if (!current || !localNow || !audioNow) return;
          const target = targetCountRef.current;

          const wantsWs = target >= wsThreshold;
          const isWs = current.mode === 'ws';

          if (!wantsWs && !isWs) {
            // 0/1 in in-memory → just resize the in-browser pool.
            await current.bots.setCount(target);
            return;
          }

          if (wantsWs && !isWs) {
            // Promote.
            const cfg = browserRealtimeConfig();
            const ok = await isRealtimeServerAvailable(cfg.healthUrl, 1500);
            if (!ok) {
              setErrorBanner(
                'Realtime server not reachable — run `pnpm bots:start` to use ≥ 2 bots.',
              );
              // Snap the target back to 1 so subsequent edits don't keep retrying.
              targetCountRef.current = 1;
              await current.bots.setCount(1);
              return;
            }
            setErrorBanner(null);
            await current.teardown();
            const next = await buildWsStack({ local: localNow, audio: audioNow, url: cfg.url });
            setStack(next);
            // Tell the server how many bots to spawn.
            next.botControl?.publish({ type: 'set-count', count: target });
            if (targetModeRef.current !== 'idle') {
              next.botControl?.publish({
                type: 'set-mode',
                mode: targetModeRef.current,
              });
            }
            return;
          }

          if (wantsWs && isWs) {
            // Already ws — just forward to the server.
            current.botControl?.publish({ type: 'set-count', count: target });
            return;
          }

          // Demote: ws → in-memory.
          // Tell server to drain its pool first so the bots disappear
          // before we tear down the ws channel locally.
          current.botControl?.publish({ type: 'set-count', count: 0 });
          await current.teardown();
          const next = await buildInMemoryStack({ local: localNow, audio: audioNow });
          next.bots.setMode(targetModeRef.current);
          await next.bots.setCount(target);
          setStack(next);
        })
        .catch((err) => {
          console.error('[debug-app] mode transition failed:', err);
        });
    },
    [wsThreshold],
  );

  const onBotModeChange = useCallback((mode: BotMode) => {
    targetModeRef.current = mode;
    const current = stackRef.current;
    if (!current) return;
    current.bots.setMode(mode);
    if (current.mode === 'ws') {
      current.botControl?.publish({ type: 'set-mode', mode });
    }
  }, []);

  const dismissError = useCallback(() => setErrorBanner(null), []);

  return { stack, errorBanner, dismissError, onBotCountChange, onBotModeChange };
}
