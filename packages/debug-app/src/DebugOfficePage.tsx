import React, { useEffect, useState } from 'react';
import { Leva } from 'leva';
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
import type {
  Actions,
  Bus,
  RuleRegistry,
  Store,
} from '@officexr/sdk';
import { createStack, Communication } from '@officexr/core-refactor';
import { Scene } from './renderer/Scene.tsx';
import { CAMERA_MODES, type CameraMode } from './renderer/config.ts';
import { BotDriver } from './bot/BotDriver.ts';
import { BotControlPanel } from './bot/BotControlPanel.tsx';

const SELF_ID = 'local-player';
const BOT_ID = 'bot-001';

interface SceneServices {
  store: Store;
  actions: Actions;
  rules: RuleRegistry;
  bus: Bus;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  bot: BotDriver;
}

export function DebugOfficePage() {
  const [services, setServices] = useState<SceneServices | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('first-person');

  // Alt+P cycles through camera modes.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Use e.code (physical key) — on macOS Alt/Option+P produces 'π' for e.key.
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

  useEffect(() => {
    let cleanup: (() => void) | null = null;
    let aborted = false;

    async function bootstrap() {
      const audio = new Audio('/elevator-music.mp3');
      audio.loop = true;
      audio.volume = 0.4;

      const hub = createInMemoryChannelHub();
      const { channel, voiceAdapter } = createStack({
        mode: 'local',
        hub,
        selfId: SELF_ID,
        onRoomJoined: () => {
          audio.play().catch((err) => {
            console.warn('[debug-app] audio autoplay blocked:', err);
          });
        },
        onRoomLeft: () => {
          audio.pause();
          audio.currentTime = 0;
        },
      });

      const store = createStore({ selfId: SELF_ID, officeId: 'debug-office' });
      const bus = createBus();
      const actions = createActions(store, bus);

      actions.upsertPlayer({
        id: SELF_ID,
        name: 'You',
        pos: { x: 0, y: 0, z: 0 },
        vel: { x: 0, y: 0, z: 0 },
        yaw: 0,
      });

      const rules = createRuleRegistry();
      rules.addRule(proximityRule);
      attachProximityReducer(store, bus);

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

      const comm = new Communication({
        selfId: SELF_ID,
        store,
        actions,
        bus,
        voice: voiceAdapter,
      });

      const bot = new BotDriver({
        hub,
        localPlayerPosGetter: () =>
          store.getState().players[SELF_ID]?.pos ?? { x: 0, y: 0, z: 0 },
        botId: BOT_ID,
        startPos: { x: 4, y: 0, z: 0 },
      });

      await channel.subscribe();
      channel.trackPresence({});
      sync.start();
      handshake.start();
      comm.start();
      await bot.start();

      if (aborted) {
        comm.stop();
        sync.stop();
        handshake.stop();
        bot.stop();
        channel.close();
        audio.pause();
        audio.src = '';
        return;
      }

      actions.upsertPlayer({
        id: BOT_ID,
        name: 'Bot',
        pos: { x: 4, y: 0, z: 0 },
        vel: { x: 0, y: 0, z: 0 },
        yaw: 0,
      });

      setServices({ store, actions, rules, bus, sync, handshake, bot });

      cleanup = () => {
        comm.stop();
        sync.stop();
        handshake.stop();
        bot.stop();
        channel.close();
        audio.pause();
        audio.src = '';
      };
    }

    bootstrap().catch((err) => {
      console.error('[debug-app] bootstrap error:', err);
    });

    return () => {
      aborted = true;
      cleanup?.();
    };
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {services && (
        <Scene
          store={services.store}
          actions={services.actions}
          rules={services.rules}
          bus={services.bus}
          sync={services.sync}
          handshake={services.handshake}
          bot={services.bot}
          selfId={SELF_ID}
          cameraMode={cameraMode}
        />
      )}
      <Hud cameraMode={cameraMode} />
      <Leva collapsed={false} />
      <BotControlPanel botDriver={services?.bot ?? null} />
    </div>
  );
}

function Hud({ cameraMode }: { cameraMode: CameraMode }) {
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
      {`Camera: ${cameraMode} (Alt+P to cycle)
WASD to move · Click to look · Esc to release mouse`}
    </div>
  );
}
