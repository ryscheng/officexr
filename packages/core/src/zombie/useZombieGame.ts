import { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { RealtimeChannel } from '@supabase/supabase-js';
import { PresenceEntry } from '@/types/room';
import {
  ZOMBIE_ROOM_HALF_SIZE,
  ZOMBIE_MAX_HP,
  ZOMBIE_HIT_RADIUS,
  ZOMBIE_DAMAGE_PER_SEC,
  PLAYER_MAX_HP,
  WAVE_INTRO_MS,
  GAME_OVER_DISPLAY_MS,
  zombiesForWave,
  zombieSpeedForWave,
  zombieSpawnPosition,
} from './constants';
import {
  createZombieMesh,
  makeAvatarGhost,
  restoreAvatarOpacity,
  applyZombieSceneEffects,
  removeZombieSceneEffects,
} from './zombieAvatarMesh';
import { ZombieEntity, ZombieGameHandle, ZombieGamePhase, UseZombieGameOptions } from './types';

export function useZombieGame({
  currentUser,
  channelRef,
  channelSubscribedRef,
  sceneRef,
  playerPositionRef,
  cameraRef,
  cameraModeRef,
  presenceDataRef,
  avatarsRef,
  onlineUsers,
  handleProximityChange,
  pauseProximityDetectionRef,
}: UseZombieGameOptions): ZombieGameHandle {

  // ── React state (drives HUD re-renders) ──────────────────────────────────────
  const [phase, setPhase] = useState<ZombieGamePhase>('inactive');
  const [wave, setWave] = useState(0);
  const [totalKills, setTotalKills] = useState(0);
  const [playerHealths, setPlayerHealths] = useState<Map<string, number>>(new Map());
  const [deadPlayers, setDeadPlayers] = useState<Set<string>>(new Set());

  // ── Animation-loop refs ───────────────────────────────────────────────────────
  const phaseRef = useRef<ZombieGamePhase>('inactive');
  const waveRef = useRef(0);
  const totalKillsRef = useRef(0);
  const deadPlayersRef = useRef<Set<string>>(new Set());
  const playerHealthsRef = useRef<Map<string, number>>(new Map());
  const localPlayerHpRef = useRef(PLAYER_MAX_HP);
  const isLocalPlayerDeadRef = useRef(false);
  const zombieEntitiesRef = useRef<Map<string, ZombieEntity>>(new Map());
  const zombieMeshesRef = useRef<Map<string, THREE.Group>>(new Map());
  const waveZombieCountRef = useRef(0);
  const waveKillsRef = useRef(0);
  const waveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameOverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const damageAccumRef = useRef(0);

  // ── Multiplayer coordination refs ─────────────────────────────────────────────
  /** All user IDs participating in the current game. */
  const allPlayerIdsRef = useRef<string[]>([]);
  /** ID of the currently elected zombie-AI host. */
  const hostIdRef = useRef<string | null>(null);
  /** Whether THIS client is currently the host. */
  const isHostRef = useRef(false);
  /** Target positions received from host, used by non-host clients for lerping. */
  const targetZombiePosRef = useRef<Map<string, { x: number; z: number }>>(new Map());
  /** Zombie IDs that have already been processed as kills — prevents double-counting. */
  const processedKillsRef = useRef<Set<string>>(new Set());
  /** setInterval handle for host position broadcasts. */
  const hostBroadcastIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const channelSend = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!channelRef.current || !channelSubscribedRef.current) return;
    channelRef.current.send({ type: 'broadcast', event, payload });
  }, []);

  const setPhaseSync = (p: ZombieGamePhase) => { phaseRef.current = p; setPhase(p); };
  const setWaveSync = (w: number) => { waveRef.current = w; setWave(w); };

  const clearWaveTimer = () => {
    if (waveTimerRef.current) { clearTimeout(waveTimerRef.current); waveTimerRef.current = null; }
  };

  /** Returns the lexicographically smallest living player ID — used as authoritative host. */
  const getHostId = useCallback((): string | null => {
    const alive = allPlayerIdsRef.current.filter(id => !deadPlayersRef.current.has(id));
    return alive.sort()[0] ?? null;
  }, []);

  /** Get the local player's true world-space XZ position regardless of camera mode. */
  const getLocalPos = useCallback((): { x: number; z: number } => {
    if (cameraModeRef.current === 'first-person' && cameraRef.current) {
      return { x: cameraRef.current.position.x, z: cameraRef.current.position.z };
    }
    return { x: playerPositionRef.current.x, z: playerPositionRef.current.z };
  }, []);

  // ── Host broadcast management ─────────────────────────────────────────────────

  const cancelHostBroadcast = useCallback(() => {
    if (hostBroadcastIntervalRef.current) {
      clearInterval(hostBroadcastIntervalRef.current);
      hostBroadcastIntervalRef.current = null;
    }
  }, []);

  const scheduleHostBroadcast = useCallback(() => {
    cancelHostBroadcast();
    hostBroadcastIntervalRef.current = setInterval(() => {
      if (!isHostRef.current || phaseRef.current !== 'playing') return;
      const positions = [...zombieEntitiesRef.current.entries()]
        .filter(([, e]) => e.hp > 0)
        .map(([id, e]) => ({ id, x: e.x, z: e.z }));
      channelSend('zombie-positions', { positions });
    }, 100);
  }, [cancelHostBroadcast, channelSend]);

  // ── Mesh lifecycle ────────────────────────────────────────────────────────────

  const removeZombieMesh = useCallback((id: string) => {
    const scene = sceneRef.current;
    const mesh = zombieMeshesRef.current.get(id);
    if (mesh && scene) {
      scene.remove(mesh);
      mesh.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh) {
          const m = child as THREE.Mesh;
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          (mats as THREE.Material[]).forEach(mat => mat.dispose());
        }
      });
    }
    zombieMeshesRef.current.delete(id);
    zombieEntitiesRef.current.delete(id);
  }, []);

  const removeAllZombies = useCallback(() => {
    for (const id of [...zombieMeshesRef.current.keys()]) removeZombieMesh(id);
  }, [removeZombieMesh]);

  // ── Scene / Jitsi management ──────────────────────────────────────────────────

  const enterZombieSceneMode = useCallback(() => {
    const scene = sceneRef.current;
    if (scene) applyZombieSceneEffects(scene);
    pauseProximityDetectionRef.current = true;
    handleProximityChange(new Set(onlineUsers.map(u => u.id)));
  }, [onlineUsers, handleProximityChange]);

  const exitZombieSceneMode = useCallback(() => {
    const scene = sceneRef.current;
    if (scene) removeZombieSceneEffects(scene);
    pauseProximityDetectionRef.current = false;
    handleProximityChange(new Set());
    avatarsRef.current.forEach((avatar: THREE.Group) => restoreAvatarOpacity(avatar));
  }, [avatarsRef, handleProximityChange]);

  // ── Wave lifecycle ────────────────────────────────────────────────────────────

  const spawnZombiesForWave = useCallback((waveNum: number) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const count = zombiesForWave(waveNum);
    waveZombieCountRef.current = count;
    waveKillsRef.current = 0;
    targetZombiePosRef.current.clear();

    for (let i = 0; i < count; i++) {
      const id = `zombie-${waveNum}-${i}`;
      const pos = zombieSpawnPosition(waveNum, i, ZOMBIE_ROOM_HALF_SIZE);
      zombieEntitiesRef.current.set(id, { id, x: pos.x, z: pos.z, hp: ZOMBIE_MAX_HP });
      const mesh = createZombieMesh(id);
      mesh.position.set(pos.x, 0.35, pos.z);
      scene.add(mesh);
      zombieMeshesRef.current.set(id, mesh);
      // Seed non-host lerp targets with spawn position
      targetZombiePosRef.current.set(id, { x: pos.x, z: pos.z });
    }
  }, []);

  // handleWaveStart is called on ALL clients (host directly, others via zombie-wave-start event)
  const handleWaveStart = useCallback((waveNum: number) => {
    if (phaseRef.current === 'inactive') return; // game not yet initialized
    clearWaveTimer();
    setWaveSync(waveNum);
    setPhaseSync('wave-intro');

    waveTimerRef.current = setTimeout(() => {
      spawnZombiesForWave(waveNum);
      setPhaseSync('playing');
      if (isHostRef.current) scheduleHostBroadcast();
    }, WAVE_INTRO_MS);
  }, [spawnZombiesForWave, scheduleHostBroadcast]);

  // ── Kill processing ───────────────────────────────────────────────────────────

  // Idempotent — safe to call from multiple paths (hit local + kill event).
  const processKillIfFirst = useCallback((zombieId: string) => {
    if (processedKillsRef.current.has(zombieId)) return;
    processedKillsRef.current.add(zombieId);

    removeZombieMesh(zombieId);
    totalKillsRef.current += 1;
    setTotalKills(totalKillsRef.current);
    waveKillsRef.current += 1;

    // Only the host manages wave progression
    if (isHostRef.current && waveKillsRef.current >= waveZombieCountRef.current) {
      const nextWave = waveRef.current + 1;
      cancelHostBroadcast();
      // Broadcast to others first, then handle locally (self: false)
      channelSend('zombie-wave-start', { wave: nextWave });
      handleWaveStart(nextWave);
    }
  }, [removeZombieMesh, cancelHostBroadcast, channelSend, handleWaveStart]);

  // Apply a single hit to a zombie entity. Broadcasts the kill event when HP hits 0.
  const applyZombieHitLocal = useCallback((zombieId: string) => {
    const entity = zombieEntitiesRef.current.get(zombieId);
    if (!entity || entity.hp <= 0) return;
    entity.hp -= 1;
    if (entity.hp <= 0) {
      // Broadcast the authoritative kill to everyone else
      channelSend('zombie-kill', { zombieId });
      processKillIfFirst(zombieId);
    }
  }, [channelSend, processKillIfFirst]);

  // ── Player death ──────────────────────────────────────────────────────────────

  // Forward-declared so triggerGameOver and applyPlayerDeadLocal can reference each other
  const triggerGameOverRef = useRef<(() => void) | null>(null);

  const applyPlayerDeadLocal = useCallback((userId: string) => {
    if (deadPlayersRef.current.has(userId)) return;
    deadPlayersRef.current = new Set([...deadPlayersRef.current, userId]);
    setDeadPlayers(new Set(deadPlayersRef.current));

    const hp = playerHealthsRef.current;
    hp.set(userId, 0);
    setPlayerHealths(new Map(hp));

    const avatar = avatarsRef.current.get(userId);
    if (avatar) makeAvatarGhost(avatar);

    // Re-elect host after a player dies
    const newHostId = getHostId();
    hostIdRef.current = newHostId;
    isHostRef.current = newHostId === currentUser?.id;

    const allIds = allPlayerIdsRef.current;
    const allDead = allIds.length > 0 && allIds.every(id => deadPlayersRef.current.has(id));
    if (allDead && (phaseRef.current === 'playing' || phaseRef.current === 'wave-intro')) {
      channelSend('zombie-end', {});
      triggerGameOverRef.current?.();
    }
  }, [avatarsRef, getHostId, currentUser?.id, channelSend]);

  // ── Game start / end ──────────────────────────────────────────────────────────

  const resetGame = useCallback(() => {
    clearWaveTimer();
    cancelHostBroadcast();
    if (gameOverTimerRef.current) { clearTimeout(gameOverTimerRef.current); gameOverTimerRef.current = null; }
    removeAllZombies();
    exitZombieSceneMode();
    setPhaseSync('inactive');
    setWaveSync(0);
    setTotalKills(0);
    totalKillsRef.current = 0;
    setPlayerHealths(new Map());
    setDeadPlayers(new Set());
    playerHealthsRef.current = new Map();
    deadPlayersRef.current = new Set();
    isLocalPlayerDeadRef.current = false;
    allPlayerIdsRef.current = [];
    hostIdRef.current = null;
    isHostRef.current = false;
    processedKillsRef.current.clear();
    targetZombiePosRef.current.clear();
  }, [cancelHostBroadcast, removeAllZombies, exitZombieSceneMode]);

  const triggerGameOver = useCallback(() => {
    if (phaseRef.current === 'game-over' || phaseRef.current === 'inactive') return;
    cancelHostBroadcast();
    clearWaveTimer();
    removeAllZombies();
    setPhaseSync('game-over');
    gameOverTimerRef.current = setTimeout(() => resetGame(), GAME_OVER_DISPLAY_MS);
  }, [cancelHostBroadcast, removeAllZombies, resetGame]);

  // Resolve forward reference
  triggerGameOverRef.current = triggerGameOver;

  const initPlayerHealths = useCallback((allPlayerIds: string[]) => {
    const map = new Map<string, number>();
    allPlayerIds.forEach(id => map.set(id, PLAYER_MAX_HP));
    playerHealthsRef.current = map;
    setPlayerHealths(new Map(map));
    localPlayerHpRef.current = PLAYER_MAX_HP;
    isLocalPlayerDeadRef.current = false;
    deadPlayersRef.current = new Set();
    setDeadPlayers(new Set());
  }, []);

  const startGame = useCallback((allPlayerIds: string[]) => {
    if (phaseRef.current !== 'inactive') return;
    allPlayerIdsRef.current = allPlayerIds;
    processedKillsRef.current.clear();
    totalKillsRef.current = 0;
    setTotalKills(0);

    const hostId = [...allPlayerIds].sort()[0];
    hostIdRef.current = hostId;
    isHostRef.current = hostId === currentUser?.id;

    initPlayerHealths(allPlayerIds);
    removeAllZombies();
    enterZombieSceneMode();

    // Set a non-inactive phase so handleWaveStart guards pass
    setPhaseSync('wave-intro');

    if (isHostRef.current) {
      // Short delay so all clients finish processing zombie-start before zombies spawn
      setTimeout(() => {
        channelSend('zombie-wave-start', { wave: 1 });
        handleWaveStart(1);
      }, 600);
    }
    // Non-hosts wait for zombie-wave-start broadcast
  }, [currentUser?.id, initPlayerHealths, removeAllZombies, enterZombieSceneMode, channelSend, handleWaveStart]);

  // ── Public API ────────────────────────────────────────────────────────────────

  const triggerZombieMode = useCallback(() => {
    if (phaseRef.current !== 'inactive') return;
    const allIds = [...new Set([
      ...(currentUser ? [currentUser.id] : []),
      ...onlineUsers.map(u => u.id),
    ])];
    startGame(allIds);
    channelSend('zombie-start', { allPlayerIds: allIds });
  }, [currentUser, onlineUsers, startGame, channelSend]);

  const onZombieHit = useCallback((zombieId: string) => {
    const entity = zombieEntitiesRef.current.get(zombieId);
    if (!entity || entity.hp <= 0) return;
    // Apply locally (self: false means sender won't receive their own zombie-hit)
    applyZombieHitLocal(zombieId);
    channelSend('zombie-hit', { zombieId });
  }, [applyZombieHitLocal, channelSend]);

  const forceQuitZombie = useCallback(() => {
    if (phaseRef.current === 'inactive') return;
    channelSend('zombie-end', { quit: true });
    resetGame();
  }, [channelSend, resetGame]);

  // ── Channel listeners ─────────────────────────────────────────────────────────

  const registerZombieListeners = useCallback((channel: RealtimeChannel) => {
    // Another player initiated the game
    channel.on('broadcast', { event: 'zombie-start' }, (msg: { payload: Record<string, unknown> }) => {
      const { allPlayerIds } = msg.payload as { allPlayerIds: string[] };
      startGame(allPlayerIds);
    });

    // Host announces a new wave — all clients spawn zombies and show intro
    channel.on('broadcast', { event: 'zombie-wave-start' }, (msg: { payload: Record<string, unknown> }) => {
      const { wave: w } = msg.payload as { wave: number };
      handleWaveStart(w);
    });

    // Host broadcasting authoritative zombie positions at ~10fps
    channel.on('broadcast', { event: 'zombie-positions' }, (msg: { payload: Record<string, unknown> }) => {
      if (isHostRef.current) return;
      const { positions } = msg.payload as { positions: Array<{ id: string; x: number; z: number }> };
      positions.forEach(p => targetZombiePosRef.current.set(p.id, { x: p.x, z: p.z }));
    });

    // A player shot a zombie — decrement HP on all clients
    channel.on('broadcast', { event: 'zombie-hit' }, (msg: { payload: Record<string, unknown> }) => {
      const { zombieId } = msg.payload as { zombieId: string };
      applyZombieHitLocal(zombieId);
    });

    // Authoritative kill event — idempotent removal on all clients
    channel.on('broadcast', { event: 'zombie-kill' }, (msg: { payload: Record<string, unknown> }) => {
      const { zombieId } = msg.payload as { zombieId: string };
      processKillIfFirst(zombieId);
    });

    // A player's HP reached 0
    channel.on('broadcast', { event: 'zombie-player-dead' }, (msg: { payload: Record<string, unknown> }) => {
      const { userId } = msg.payload as { userId: string };
      applyPlayerDeadLocal(userId);
    });

    // End game — quit (immediate) or all-dead (show game-over screen)
    channel.on('broadcast', { event: 'zombie-end' }, (msg: { payload: Record<string, unknown> }) => {
      const { quit } = (msg.payload ?? {}) as { quit?: boolean };
      if (quit) {
        resetGame();
      } else if (phaseRef.current !== 'game-over' && phaseRef.current !== 'inactive') {
        triggerGameOver();
      }
    });
  }, [startGame, handleWaveStart, applyZombieHitLocal, processKillIfFirst, applyPlayerDeadLocal, triggerGameOver, resetGame]);

  // ── Per-frame update ──────────────────────────────────────────────────────────

  const updateZombies = useCallback((delta: number, scene: THREE.Scene) => {
    if (phaseRef.current !== 'playing') return;

    // Dynamic host re-election (in case the previous host died)
    const currentHostId = getHostId();
    const shouldBeHost = currentHostId === currentUser?.id;
    if (shouldBeHost && !isHostRef.current) {
      isHostRef.current = true;
      hostIdRef.current = currentHostId;
      scheduleHostBroadcast();
    } else if (!shouldBeHost && isHostRef.current) {
      isHostRef.current = false;
      cancelHostBroadcast();
    }

    const speed = zombieSpeedForWave(waveRef.current);
    const myId = currentUser?.id;

    // Returns XZ position of the closest living game participant to a given zombie location
    const closestLivingPlayerPos = (zx: number, zz: number): { x: number; z: number } | null => {
      let best: { x: number; z: number } | null = null;
      let bestDist = Infinity;

      if (myId && allPlayerIdsRef.current.includes(myId) && !deadPlayersRef.current.has(myId)) {
        const lp = getLocalPos();
        const d = Math.hypot(lp.x - zx, lp.z - zz);
        if (d < bestDist) { bestDist = d; best = lp; }
      }

      for (const [uid, entry] of presenceDataRef.current) {
        if (!allPlayerIdsRef.current.includes(uid)) continue;
        if (deadPlayersRef.current.has(uid)) continue;
        const pos = entry.position;
        const d = Math.hypot(pos.x - zx, pos.z - zz);
        if (d < bestDist) { bestDist = d; best = { x: pos.x, z: pos.z }; }
      }

      return best;
    };

    if (isHostRef.current) {
      // ── Host: run authoritative zombie AI ────────────────────────────────────
      for (const [id, entity] of zombieEntitiesRef.current) {
        if (entity.hp <= 0) continue;
        const target = closestLivingPlayerPos(entity.x, entity.z);
        if (!target) continue;
        const dx = target.x - entity.x;
        const dz = target.z - entity.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.01) {
          const step = Math.min(speed * delta, dist);
          entity.x += (dx / dist) * step;
          entity.z += (dz / dist) * step;
          const mesh = zombieMeshesRef.current.get(id);
          if (mesh) {
            mesh.position.set(entity.x, 0.35, entity.z);
            mesh.rotation.y = Math.atan2(dx, dz);
          }
        }
      }
    } else {
      // ── Non-host: lerp toward positions received from host ────────────────────
      const lerpFactor = Math.min(1, 10 * delta);
      for (const [id, entity] of zombieEntitiesRef.current) {
        if (entity.hp <= 0) continue;
        const target = targetZombiePosRef.current.get(id);
        if (!target) continue;
        const dx = target.x - entity.x;
        const dz = target.z - entity.z;
        entity.x += dx * lerpFactor;
        entity.z += dz * lerpFactor;
        const mesh = zombieMeshesRef.current.get(id);
        if (mesh) {
          mesh.position.set(entity.x, 0.35, entity.z);
          if (Math.hypot(dx, dz) > 0.01) mesh.rotation.y = Math.atan2(dx, dz);
        }
      }
    }

    // ── All clients: check damage to the local player ─────────────────────────
    if (myId && !isLocalPlayerDeadRef.current) {
      const lp = getLocalPos();
      let touching = false;
      for (const entity of zombieEntitiesRef.current.values()) {
        if (entity.hp <= 0) continue;
        if (Math.hypot(lp.x - entity.x, lp.z - entity.z) < ZOMBIE_HIT_RADIUS) {
          touching = true;
          break;
        }
      }

      if (touching) {
        damageAccumRef.current += delta;
        while (damageAccumRef.current >= 1) {
          damageAccumRef.current -= 1;
          localPlayerHpRef.current = Math.max(0, localPlayerHpRef.current - ZOMBIE_DAMAGE_PER_SEC);
          const hp = playerHealthsRef.current;
          hp.set(myId, localPlayerHpRef.current);
          setPlayerHealths(new Map(hp));
          if (localPlayerHpRef.current <= 0 && !isLocalPlayerDeadRef.current) {
            isLocalPlayerDeadRef.current = true;
            applyPlayerDeadLocal(myId);
            channelSend('zombie-player-dead', { userId: myId });
          }
        }
      } else {
        damageAccumRef.current = 0;
      }
    }

    // Simple wobble on all visible zombie meshes
    const t = performance.now() * 0.003;
    let idx = 0;
    for (const mesh of zombieMeshesRef.current.values()) {
      mesh.rotation.z = Math.sin(t + idx * 1.3) * 0.08;
      idx++;
    }
  }, [currentUser?.id, getHostId, getLocalPos, presenceDataRef, scheduleHostBroadcast, cancelHostBroadcast, applyPlayerDeadLocal, channelSend]);

  return {
    phase,
    wave,
    totalKills,
    playerHealths,
    deadPlayers,
    zombieMeshesRef,
    isLocalPlayerDeadRef,
    triggerZombieMode,
    onZombieHit,
    forceQuitZombie,
    registerZombieListeners,
    updateZombies,
  };
}
