import { randomUUID } from 'node:crypto';
import type { Mission, MissionPatch } from '@officexr/sdk';

export const MAX_OPEN_MISSIONS = 200;

export type NewMissionData = Pick<Mission, 'title' | 'steps' | 'place' | 'dueAt' | 'personLogin' | 'shared'>;

export interface MissionsStore {
  /** The login's own missions plus shared ones in the office: open first, newest first within each group. */
  list: (officeId: string, login: string) => Promise<Mission[]>;
  get: (officeId: string, id: string) => Promise<Mission | undefined>;
  /** 'limit' when the owner already has `MAX_OPEN_MISSIONS` open missions in the office. */
  create: (officeId: string, ownerLogin: string, input: NewMissionData) => Promise<Mission | 'limit'>;
  /** Undefined when missing or when `login` may not apply `patch` to the mission as it is now. Reopening a done mission counts against the open limit. */
  update: (officeId: string, id: string, login: string, patch: MissionPatch) => Promise<Mission | 'limit' | undefined>;
  remove: (officeId: string, id: string) => Promise<boolean>;
}

export const PATCH_KEYS = ['title', 'steps', 'place', 'dueAt', 'personLogin', 'shared', 'done'] as const;

export const patchedFields = (patch: MissionPatch) => PATCH_KEYS.filter((field) => Object.hasOwn(patch, field));

export const mayPatch = (mission: Pick<Mission, 'ownerLogin' | 'shared'>, login: string, patch: MissionPatch) => {
  if (mission.ownerLogin === login) {
    return true;
  }
  const fields = patchedFields(patch);
  return mission.shared && fields.length === 1 && fields[0] === 'done';
};

export function compareMissions(a: Mission, b: Mission): number {
  if (a.done !== b.done) {
    return a.done ? 1 : -1;
  }
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

export function createMemoryMissions(now: () => number = Date.now): MissionsStore {
  const rows = new Map<string, Mission>();
  const key = (officeId: string, id: string) => `${officeId}/${id}`;
  const openCount = (officeId: string, owner: string) =>
    [...rows.values()].filter((m) => m.officeId === officeId && m.ownerLogin === owner && !m.done).length;
  return {
    list: async (officeId, login) =>
      [...rows.values()].filter((m) => m.officeId === officeId && (m.ownerLogin === login || m.shared)).sort(compareMissions),
    get: async (officeId, id) => rows.get(key(officeId, id)),
    create: async (officeId, ownerLogin, input) => {
      if (openCount(officeId, ownerLogin) >= MAX_OPEN_MISSIONS) {
        return 'limit';
      }
      const stamp = new Date(now()).toISOString();
      const mission: Mission = { id: randomUUID(), officeId, source: 'mine', ownerLogin, ...input, done: false, createdAt: stamp, updatedAt: stamp };
      rows.set(key(officeId, mission.id), mission);
      return mission;
    },
    update: async (officeId, id, login, patch) => {
      const current = rows.get(key(officeId, id));
      if (!current || !mayPatch(current, login, patch)) {
        return undefined;
      }
      if (patch.done === false && current.done && openCount(officeId, current.ownerLogin) >= MAX_OPEN_MISSIONS) {
        return 'limit';
      }
      const next: Mission = { ...current, updatedAt: new Date(now()).toISOString() };
      for (const field of PATCH_KEYS) {
        if (Object.hasOwn(patch, field)) {
          Object.assign(next, { [field]: patch[field] });
        }
      }
      rows.set(key(officeId, id), next);
      return next;
    },
    remove: async (officeId, id) => rows.delete(key(officeId, id)),
  };
}
