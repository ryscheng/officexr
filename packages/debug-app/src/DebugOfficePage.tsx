import React, { useEffect, useState } from 'react';
import { Leva } from 'leva';
import {
  createStore,
  createActions,
  createBus,
  createRuleRegistry,
  attachProximityReducer,
  collisionBumpRule,
  proximityInnerRule,
  proximityOuterRule,
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
import { BotPool } from './bot/BotPool.ts';

const SELF_ID = 'local-player';

interface SceneServices {
  store: Store;
  actions: Actions;
  rules: RuleRegistry;
  bus: Bus;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  bots: BotPool;
}

export function DebugOfficePage() {
  const [services, setServices] = useState<SceneServices | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');

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
      rules.addRule(proximityOuterRule);
      rules.addRule(proximityInnerRule);
      rules.addRule(collisionBumpRule);
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

      const bots = new BotPool({
        hub,
        localPlayerPosGetter: () =>
          store.getState().players[SELF_ID]?.pos ?? { x: 0, y: 0, z: 0 },
      });

      await channel.subscribe();
      channel.trackPresence({});
      sync.start();
      handshake.start();
      comm.start();
      // Spawn 1 bot by default — Leva slider in the Bot folder lets users
      // grow / shrink this. Bots announce themselves via their own
      // SyncEngine.start() spawn broadcast; applyRemotePosition upserts
      // them into the local store on receipt.
      await bots.setCount(1);

      if (aborted) {
        comm.stop();
        sync.stop();
        handshake.stop();
        bots.stop();
        channel.close();
        audio.pause();
        audio.src = '';
        return;
      }

      setServices({ store, actions, rules, bus, sync, handshake, bots });

      cleanup = () => {
        comm.stop();
        sync.stop();
        handshake.stop();
        bots.stop();
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
          bots={services.bots}
          selfId={SELF_ID}
          cameraMode={cameraMode}
        />
      )}
      <Hud cameraMode={cameraMode} />
      <Leva collapsed={false} />
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
