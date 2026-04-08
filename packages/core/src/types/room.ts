import * as THREE from 'three';
import { AvatarData } from '@/components/Avatar';

// ─── Camera & Environment ────────────────────────────────────────────────────

export type CameraMode = 'first-person' | 'third-person-behind' | 'third-person-front';

export type EnvironmentType = string;

// ─── Presence ────────────────────────────────────────────────────────────────

export type PresenceEntry = AvatarData & {
  email?: string | null;
  jitsiRoom?: string | null;
  status?: 'active' | 'inactive';
};

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
}

// ─── Screen Sharing ──────────────────────────────────────────────────────────

export interface ScreenShare {
  stream: MediaStream;
  name: string;
}

// ─── Player State (shared between input + presence hooks) ────────────────────

export interface PlayerState {
  position: THREE.Vector3;
  yaw: number;
  moved: boolean;
}
