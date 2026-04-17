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

  // ── Refs for animation loop (no React re-render needed) ───────────────────────
  const phaseRef = useRef<ZombieGamePhase>('inactive');
  const waveRef = useRef(0);
  const totalKillsRef = useRef(0);
  const deadPlayersRef = useRef<Set<string>>(new Set());
  const playerHealthsRef = useRef<Map<string, number>>(new Map());
  const localPlayerHpRef = useRef(PLAYER_MAX_HP);
  const isLocalPlayerDeadRef = useRef(false);
  const zombieEntitiesRef = useRef<Map<string, ZombieEntity>>(new Map());
  const zombieMeshesRef = useRef<Map<string, THREE.Group>>(new Map());
  const waveZombieCountRef = useRef(0); // expected zombies for current wave
  const waveKillsRef = useRef(0); // kills in current wave
  const waveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameOverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const damageAccumRef = useRef(0); // accumulated damage time for 1-sec ticks

  // ── helpers ──────────────────────────────────────────────────────────────────

  const channelSend = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!channelRef.current || !channelSubscribedRef.current) return;
    channelRef.current.send({ type: 'broadcast', event, payload });
  }, []);

  /** Set both React state and its mirror ref atomically. */
  const setPhaseSync = (p: ZombieGamePhase) => { phaseRef.current = p; setPhase(p); };
  const setWaveSync = (w: number) => { waveRef.current = w; setWave(w); };

  const clearWaveTimer = () => {
    if (waveTimerRef.current) { clearTimeout(waveTimerRef.current); waveTimerRef.current = null; }
  };

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
          (mats as THREE.Material[]).forEach((mat) => mat.dispose());
        }
      });
    }
    zombieMeshesRef.current.delete(id);
    zombieEntitiesRef.current.delete(id);
  }, []);

  const removeAllZombies = useCallback(() => {
    for (const id of [...zombieMeshesRef.current.keys()]) removeZombieMesh(id);
  }, [removeZombieMesh]);

  // ── Scene / Jitsi management ─────────────────────────────────────────────────

  const enterZombieSceneMode = useCallback(() => {
    const scene = sceneRef.current;
    if (scene) applyZombieSceneEffects(scene);
    // Force all online users into one Jitsi room
    pauseProximityDetectionRef.current = true;
    const allIds = new Set(onlineUsers.map(u => u.id));
    handleProximityChange(allIds);
  }, [onlineUsers, handleProximityChange]);

  const exitZombieSceneMode = useCallback(() => {
    const scene = sceneRef.current;
    if (scene) removeZombieSceneEffects(scene);
    pauseProximityDetectionRef.current = false;
    // Return Jitsi to proximity-based control by resetting nearby set
    handleProximityChange(new Set());
    // Restore ghost avatars
    avatarsRef.current.forEach((avatar: THREE.Group) => restoreAvatarOpacity(avatar));
  }, [avatarsRef, handleProximityChange]);

  // ── Wave lifecycle ────────────────────────────────────────────────────────────

  const spawnZombiesForWave = useCallback((waveNum: number) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const count = zombiesForWave(waveNum);
    waveZombieCountRef.current = count;
    waveKillsRef.current = 0;

    for (let i = 0; i < count; i++) {
      const id = `zombie-${waveNum}-${i}`;
      const pos = zombieSpawnPosition(waveNum, i, ZOMBIE_ROOM_HALF_SIZE);
      const entity: ZombieEntity = { id, x: pos.x, z: pos.z, hp: ZOMBIE_MAX_HP };
      zombieEntitiesRef.current.set(id, entity);

      const mesh = createZombieMesh(id);
      mesh.position.set(pos.x, 0.35, pos.z);
      scene.add(mesh);
      zombieMeshesRef.current.set(id, mesh);
    }
  }, []);

  const beginWave = useCallback((waveNum: number) => {
    clearWaveTimer();
    setWaveSync(waveNum);
    setPhaseSync('wave-intro');
    waveTimerRef.current = setTimeout(() => {
      spawnZombiesForWave(waveNum);
      setPhaseSync('playing');
    }, WAVE_INTRO_MS);
  }, [spawnZombiesForWave]);

  // ── Game start / end ─────────────────────────────────────────────────────────

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
    totalKillsRef.current = 0;
    setTotalKills(0);
    initPlayerHealths(allPlayerIds);
    removeAllZombies();
    enterZombieSceneMode();
    beginWave(1);
  }, [initPlayerHealths, removeAllZombies, enterZombieSceneMode, beginWave]);

  const resetGame = useCallback(() => {
    clearWaveTimer();
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
  }, [removeAllZombies, exitZombieSceneMode]);

  const triggerGameOver = useCallback(() => {
    setPhaseSync('game-over');
    clearWaveTimer();
    removeAllZombies();
    gameOverTimerRef.current = setTimeout(() => {
      resetGame();
    }, GAME_OVER_DISPLAY_MS);
  }, [removeAllZombies, resetGame]);

  // ── Public: trigger zombie mode (called by chat trigger) ──────────────────────

  const triggerZombieMode = useCallback(() => {
    if (phaseRef.current !== 'inactive') return;
    const allIds = onlineUsers.map(u => u.id);
    if (currentUser && !allIds.includes(currentUser.id)) allIds.push(currentUser.id);
    startGame(allIds);
    channelSend('zombie-start', { allPlayerIds: allIds });
  }, [onlineUsers, currentUser, startGame, channelSend]);

  // ── Public: handle bullet hitting a zombie ────────────────────────────────────

  const applyZombieHitLocal = useCallback((zombieId: string) => {
    const entity = zombieEntitiesRef.current.get(zombieId);
    if (!entity || entity.hp <= 0) return;

    entity.hp -= 1;
    if (entity.hp <= 0) {
      removeZombieMesh(zombieId);
      totalKillsRef.current += 1;
      setTotalKills(totalKillsRef.current);
      waveKillsRef.current += 1;

      // Check wave complete
      if (waveKillsRef.current >= waveZombieCountRef.current) {
        const nextWave = waveRef.current + 1;
        beginWave(nextWave);
      }
    }
  }, [removeZombieMesh, beginWave]);

  const onZombieHit = useCallback((zombieId: string) => {
    const entity = zombieEntitiesRef.current.get(zombieId);
    if (!entity || entity.hp <= 0) return;
    // Apply locally (self: false, sender doesn't receive own broadcasts)
    applyZombieHitLocal(zombieId);
    // Broadcast to others
    channelSend('zombie-hit', { zombieId });
  }, [applyZombieHitLocal, channelSend]);

  // ── Player death handling ────────────────────────────────────────────────────

  const applyPlayerDeadLocal = useCallback((userId: string) => {
    if (deadPlayersRef.current.has(userId)) return;
    deadPlayersRef.current = new Set([...deadPlayersRef.current, userId]);
    setDeadPlayers(new Set(deadPlayersRef.current));

    const hp = playerHealthsRef.current;
    hp.set(userId, 0);
    setPlayerHealths(new Map(hp));

    // Make avatar ghost
    const avatar = avatarsRef.current.get(userId);
    if (avatar) makeAvatarGhost(avatar);

    // Check if all players are dead
    const allPlayers = [...playerHealthsRef.current.keys()];
    const allDead = allPlayers.every(id => deadPlayersRef.current.has(id));
    if (allDead && phaseRef.current === 'playing') {
      channelSend('zombie-end', {});
      triggerGameOver();
    }
  }, [avatarsRef, channelSend, triggerGameOver]);

  // ── Public: register channel listeners ──────────────────────────────────────

  const registerZombieListeners = useCallback((channel: RealtimeChannel) => {
    channel.on('broadcast', { event: 'zombie-start' }, (msg: { payload: Record<string, unknown> }) => {
      const { allPlayerIds } = msg.payload as { allPlayerIds: string[] };
      startGame(allPlayerIds);
    });

    channel.on('broadcast', { event: 'zombie-hit' }, (msg: { payload: Record<string, unknown> }) => {
      const { zombieId } = msg.payload as { zombieId: string };
      applyZombieHitLocal(zombieId);
    });

    channel.on('broadcast', { event: 'zombie-player-dead' }, (msg: { payload: Record<string, unknown> }) => {
      const { userId } = msg.payload as { userId: string };
      applyPlayerDeadLocal(userId);
    });

    channel.on('broadcast', { event: 'zombie-end' }, () => {
      if (phaseRef.current !== 'game-over') triggerGameOver();
    });
  }, [startGame, applyZombieHitLocal, applyPlayerDeadLocal, triggerGameOver]);

  // ── Public: per-frame update ──────────────────────────────────────────────────

  const updateZombies = useCallback((delta: number, scene: THREE.Scene) => {
    if (phaseRef.current !== 'playing') return;

    const speed = zombieSpeedForWave(waveRef.current);
    const myId = currentUser?.id;

    // Find closest living player to a zombie position
    const closestLivingPlayerPos = (zx: number, zz: number): { x: number; z: number } | null => {
      let best: { x: number; z: number } | null = null;
      let bestDist = Infinity;

      // Check local player
      if (myId && !deadPlayersRef.current.has(myId)) {
        const lp = playerPositionRef.current;
        const d = Math.hypot(lp.x - zx, lp.z - zz);
        if (d < bestDist) { bestDist = d; best = { x: lp.x, z: lp.z }; }
      }

      // Check remote players
      for (const [uid, entry] of presenceDataRef.current) {
        if (deadPlayersRef.current.has(uid)) continue;
        const pos = entry.position;
        const d = Math.hypot(pos.x - zx, pos.z - zz);
        if (d < bestDist) { bestDist = d; best = { x: pos.x, z: pos.z }; }
      }

      return best;
    };

    // Move each zombie toward its target
    for (const [id, entity] of zombieEntitiesRef.current) {
      if (entity.hp <= 0) continue;
      const mesh = zombieMeshesRef.current.get(id);
      if (!mesh) continue;

      const target = closestLivingPlayerPos(entity.x, entity.z);
      if (!target) continue;

      const dx = target.x - entity.x;
      const dz = target.z - entity.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.01) {
        const step = Math.min(speed * delta, dist);
        entity.x += (dx / dist) * step;
        entity.z += (dz / dist) * step;
        mesh.position.set(entity.x, 0.35, entity.z);
        // Face target
        mesh.rotation.y = Math.atan2(dx, dz);
      }
    }

    // Check damage to local player
    if (myId && !isLocalPlayerDeadRef.current) {
      let touchingZombie = false;
      for (const entity of zombieEntitiesRef.current.values()) {
        if (entity.hp <= 0) continue;
        const lp = playerPositionRef.current;
        if (Math.hypot(lp.x - entity.x, lp.z - entity.z) < ZOMBIE_HIT_RADIUS) {
          touchingZombie = true;
          break;
        }
      }

      if (touchingZombie) {
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

    // Wobble animation on zombie meshes (simple oscillation)
    const t = performance.now() * 0.003;
    let meshIdx = 0;
    for (const [, mesh] of zombieMeshesRef.current) {
      mesh.rotation.z = Math.sin(t + meshIdx * 1.3) * 0.08;
      meshIdx++;
    }
  }, [currentUser?.id, playerPositionRef, presenceDataRef, applyPlayerDeadLocal, channelSend]);

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
    registerZombieListeners,
    updateZombies,
  };
}
