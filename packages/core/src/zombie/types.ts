import type * as React from 'react';
import type * as THREE from 'three';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { PresenceEntry } from '@/types/room';

export type ZombieGamePhase = 'inactive' | 'wave-intro' | 'playing' | 'game-over';

export interface ZombieEntity {
  id: string;
  x: number;
  z: number;
  hp: number;
}

export interface ZombieGameHandle {
  phase: ZombieGamePhase;
  wave: number;
  totalKills: number;
  playerHealths: Map<string, number>;
  deadPlayers: Set<string>;
  zombieMeshesRef: React.MutableRefObject<Map<string, THREE.Group>>;
  isLocalPlayerDeadRef: React.MutableRefObject<boolean>;
  triggerZombieMode: () => void;
  onZombieHit: (zombieId: string) => void;
  registerZombieListeners: (channel: RealtimeChannel) => void;
  updateZombies: (delta: number, scene: THREE.Scene) => void;
}

export interface UseZombieGameOptions {
  currentUser: { id: string; name: string | null } | null;
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  channelSubscribedRef: React.MutableRefObject<boolean>;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  playerPositionRef: React.MutableRefObject<THREE.Vector3>;
  presenceDataRef: React.MutableRefObject<Map<string, PresenceEntry>>;
  avatarsRef: React.MutableRefObject<Map<string, THREE.Group>>;
  onlineUsers: Array<{ id: string; name: string }>;
  handleProximityChange: (nearbyIds: Set<string>) => void;
  pauseProximityDetectionRef: React.MutableRefObject<boolean>;
}
