import React, { useEffect, useRef, useState } from 'react';
import {
  createStore,
  createActions,
  createBus,
  createRuleRegistry,
  attachProximityReducer,
  proximityRule,
  serializeOfficeState,
  SyncEngine,
  SnapshotHandshake,
  createInMemoryChannelHub,
} from '@officexr/sdk';
import {
  createStack,
  Communication,
} from '@officexr/core-refactor';
import { WorldRenderer } from './renderer/WorldRenderer.ts';
import { BotDriver } from './bot/BotDriver.ts';
import { BotControlPanel } from './bot/BotControlPanel.tsx';

const SELF_ID = 'local-player';
const BOT_ID = 'bot-001';

export function DebugOfficePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [botDriver, setBotDriver] = useState<BotDriver | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    // Mutable cleanup holder shared between async bootstrap and the sync return
    let cleanup: (() => void) | null = null;
    let effectAborted = false;

    async function bootstrap() {
      // Audio setup
      const audio = new Audio('/elevator-music.mp3');
      audio.loop = true;
      audio.volume = 0.4;

      // 1. Create hub and stack
      const hub = createInMemoryChannelHub();
      const { channel, voiceAdapter } = createStack({
        mode: 'local',
        hub,
        selfId: SELF_ID,
        onRoomJoined: (_roomId: string) => {
          audio.play().catch((err) => {
            console.warn('[debug-app] audio autoplay blocked:', err);
          });
        },
        onRoomLeft: () => {
          audio.pause();
          audio.currentTime = 0;
        },
      });

      // 2. Store + bus + actions
      const store = createStore({ selfId: SELF_ID, officeId: 'debug-office' });
      const bus = createBus();
      const actions = createActions(store, bus);

      // 3. Seed local player
      actions.upsertPlayer({
        id: SELF_ID,
        name: 'You',
        pos: { x: 0, y: 0, z: 0 },
        vel: { x: 0, y: 0, z: 0 },
        yaw: 0,
      });

      // 4. Rules + proximity reducer
      const rules = createRuleRegistry();
      rules.addRule(proximityRule);
      attachProximityReducer(store, bus);

      // 5. SyncEngine + SnapshotHandshake
      const sync = new SyncEngine({
        store,
        actions,
        bus,
        channel,
        clock: { now: () => performance.now() },
      });
      const handshake = new SnapshotHandshake({
        selfId: SELF_ID,
        store,
        actions,
        sync,
        channel,
        clock: { now: () => performance.now() },
        serialize: () => serializeOfficeState(store.getState()),
      });

      // 6. Communication
      const comm = new Communication({
        selfId: SELF_ID,
        store,
        actions,
        bus,
        voice: voiceAdapter,
      });

      // 7. BotDriver
      const bot = new BotDriver({
        hub,
        localPlayerPosGetter: () =>
          store.getState().players[SELF_ID]?.pos ?? { x: 0, y: 0, z: 0 },
        botId: BOT_ID,
        startPos: { x: 10, y: 0, z: 0 },
      });

      // 8. Subscribe, start
      await channel.subscribe();
      channel.trackPresence({});
      sync.start();
      handshake.start();
      comm.start();
      await bot.start();

      if (effectAborted) {
        comm.stop();
        sync.stop();
        handshake.stop();
        bot.stop();
        channel.close();
        audio.pause();
        audio.src = '';
        return;
      }

      // Seed the bot player so it appears in the local store immediately
      actions.upsertPlayer({
        id: BOT_ID,
        name: 'Bot',
        pos: { x: 10, y: 0, z: 0 },
        vel: { x: 0, y: 0, z: 0 },
        yaw: 0,
      });

      setBotDriver(bot);

      // 9. WorldRenderer
      const renderer = new WorldRenderer(container);

      // 10. WASD key tracking
      const keysDown = new Set<string>();
      const onKeyDown = (e: KeyboardEvent) => keysDown.add(e.key.toLowerCase());
      const onKeyUp = (e: KeyboardEvent) => keysDown.delete(e.key.toLowerCase());
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);

      // 11. RAF loop
      let rafId: number;
      let lastTime = performance.now();
      let prevState = store.getState();

      function loop(now: number) {
        const dt = now - lastTime;
        lastTime = now;

        // WASD movement, camera-relative
        const selfState = store.getState().players[SELF_ID];
        if (selfState) {
          const speed = 3; // m/s
          const move = speed * dt / 1000;
          const fwd = (keysDown.has('w') || keysDown.has('arrowup') ? 1 : 0)
                    - (keysDown.has('s') || keysDown.has('arrowdown') ? 1 : 0);
          const strafe = (keysDown.has('d') || keysDown.has('arrowright') ? 1 : 0)
                       - (keysDown.has('a') || keysDown.has('arrowleft') ? 1 : 0);
          if (fwd !== 0 || strafe !== 0) {
            const yaw = renderer.getYaw();
            // Camera looks toward the player from +offset; player-forward is opposite of camera-offset XZ.
            const forwardX = -Math.sin(yaw);
            const forwardZ = -Math.cos(yaw);
            const rightX = Math.cos(yaw);
            const rightZ = -Math.sin(yaw);
            let dx = forwardX * fwd + rightX * strafe;
            let dz = forwardZ * fwd + rightZ * strafe;
            const len = Math.hypot(dx, dz);
            if (len > 0) {
              dx = (dx / len) * move;
              dz = (dz / len) * move;
              const x = selfState.pos.x + dx;
              const z = selfState.pos.z + dz;
              actions.setSelfPosition({ x, y: selfState.pos.y, z }, { x: 0, y: 0, z: 0 }, 0);
            }
          }
        }

        actions.tick(now);
        const current = store.getState();
        rules.tick(current, prevState, bus);
        prevState = store.getState(); // capture post-reducer state
        sync.flushPosition();
        handshake.tickTimers();
        bot.tick(dt);
        renderer.render(store.getState());
        rafId = requestAnimationFrame(loop);
      }
      rafId = requestAnimationFrame(loop);

      cleanup = () => {
        cancelAnimationFrame(rafId);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        comm.stop();
        sync.stop();
        handshake.stop();
        bot.stop();
        channel.close();
        renderer.dispose();
        audio.pause();
        audio.src = '';
      };
    }

    bootstrap().catch((err) => {
      console.error('[debug-app] bootstrap error:', err);
    });

    return () => {
      effectAborted = true;
      cleanup?.();
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
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
        }}
      >
        Click to look · WASD to move · Esc to release mouse
      </div>
      <BotControlPanel botDriver={botDriver} />
    </div>
  );
}
