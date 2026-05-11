import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Leva } from 'leva';
import { Scene } from './renderer/Scene.tsx';
import { CAMERA_MODES, type CameraMode } from './renderer/config.ts';
import {
  buildInMemoryStack,
  buildWsStack,
  createPersistentLocalState,
  type ChannelStack,
  type PersistentLocalState,
} from './realtime/services.ts';
import {
  browserRealtimeConfig,
  isRealtimeServerAvailable,
} from './realtime/realtime-config.ts';
import type { BotMode } from './bot/BotDriver.ts';

const SELF_ID = 'local-player';
const OFFICE_ID = 'debug-office';
/** ≥ this many bots forces the ws-server path (each bot is a real peer
 * in the Node `bots:start` process); below it the in-browser
 * InMemoryChannel pool runs a single bot with zero infra. */
const WS_THRESHOLD = 2;

type AppMode = 'in-memory' | 'ws';

export function DebugOfficePage() {
  const [stack, setStack] = useState<ChannelStack | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  /** Persistent local-player bundle. Built once on mount, survives
   * every promotion/demotion. Held in a ref because we mutate the
   * channel stack around it without wanting to retrigger this effect. */
  const localRef = useRef<PersistentLocalState | null>(null);
  /** Audio element for proximity-driven elevator music. Lives across
   * stack swaps so re-promoting doesn't reset playback position. */
  const audioRef = useRef<HTMLAudioElement | null>(null);
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

  // Alt+P cycles through camera modes.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        setCameraMode((current) => {
          const i = CAMERA_MODES.indexOf(current);
          return CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Bootstrap: persistent local state + initial in-memory stack with 1 bot.
  useEffect(() => {
    let aborted = false;
    let teardown: (() => Promise<void>) | null = null;

    async function bootstrap() {
      const audio = new Audio('/elevator-music.mp3');
      audio.loop = true;
      audio.volume = 0.4;
      audioRef.current = audio;

      const local = createPersistentLocalState({
        selfId: SELF_ID,
        officeId: OFFICE_ID,
      });
      localRef.current = local;
      // Expose the store on window for ad-hoc inspection from the
      // browser console / a Playwright probe. Dev-only; harmless in
      // production but unnecessary.
      (window as unknown as { __OFFICE_STORE__: typeof local.store }).__OFFICE_STORE__ = local.store;

      const initial = await buildInMemoryStack({ local, audio });
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
  }, []);

  /**
   * Drive the bot count. Promotes / demotes between in-memory and ws
   * modes as needed, and forwards the count to whichever pool is
   * authoritative.
   *
   * Wrapped in `transitionChain` so concurrent calls (rapid Leva drags)
   * serialise behind one another and converge on the latest target.
   */
  const onBotCountChange = useCallback((count: number) => {
    targetCountRef.current = Math.max(0, Math.floor(count));
    transitionChain.current = transitionChain.current.then(async () => {
      const current = stackRef.current;
      const local = localRef.current;
      const audio = audioRef.current;
      if (!current || !local || !audio) return;
      const target = targetCountRef.current;

      const wantsWs = target >= WS_THRESHOLD;
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
        const next = await buildWsStack({ local, audio, url: cfg.url });
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
      const next = await buildInMemoryStack({ local, audio });
      next.bots.setMode(targetModeRef.current);
      await next.bots.setCount(target);
      setStack(next);
    }).catch((err) => {
      console.error('[debug-app] mode transition failed:', err);
    });
  }, []);

  /** Apply a bot mode to whichever pool is authoritative. In ws mode
   * that means publishing to the server; in in-memory mode it means
   * calling `setMode` on the in-browser pool directly. */
  const onBotModeChange = useCallback((mode: BotMode) => {
    targetModeRef.current = mode;
    const current = stackRef.current;
    if (!current) return;
    current.bots.setMode(mode);
    if (current.mode === 'ws') {
      current.botControl?.publish({ type: 'set-mode', mode });
    }
  }, []);

  // Keep a ref-mirror of `stack` so the callbacks above can read the
  // latest stack without being recreated on each setStack.
  const stackRef = useRef<ChannelStack | null>(null);
  useEffect(() => {
    stackRef.current = stack;
  }, [stack]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {stack && localRef.current && (
        <Scene
          store={localRef.current.store}
          actions={localRef.current.actions}
          rules={localRef.current.rules}
          bus={localRef.current.bus}
          sync={stack.sync}
          handshake={stack.handshake}
          bots={stack.bots}
          selfId={SELF_ID}
          cameraMode={cameraMode}
          onBotCountChange={onBotCountChange}
          onBotModeChange={onBotModeChange}
        />
      )}
      <Hud cameraMode={cameraMode} mode={stack?.mode ?? 'in-memory'} />
      {errorBanner && (
        <ErrorBanner message={errorBanner} onDismiss={() => setErrorBanner(null)} />
      )}
      <Leva collapsed={false} />
    </div>
  );
}

function Hud({ cameraMode, mode }: { cameraMode: CameraMode; mode: AppMode }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: 12,
        padding: '6px 10px',
        background: 'rgba(0,0,0,0.55)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 4,
        pointerEvents: 'none',
        whiteSpace: 'pre-line',
      }}
    >
      {`Camera: ${cameraMode} (Alt+P to cycle) · Realtime: ${mode}
WASD to move · Click to look · Esc to release mouse`}
    </div>
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 14px',
        background: 'rgba(180, 50, 50, 0.92)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 6,
        cursor: 'pointer',
        maxWidth: '90vw',
      }}
      onClick={onDismiss}
      title="click to dismiss"
    >
      {message}
    </div>
  );
}
