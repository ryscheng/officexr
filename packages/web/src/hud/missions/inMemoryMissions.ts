import type { Mission, MissionPatch, MissionsClient, NewMission } from '@officexr/sdk';

export interface InMemoryMissions extends MissionsClient {
  onChanged(listener: () => void): () => void;
}

export function createInMemoryMissionsClient(me: string, seed: Mission[] = [], now: () => Date = () => new Date()): InMemoryMissions {
  let missions = [...seed];
  let counter = 0;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());
  return {
    list: async (officeId) => missions.filter((m) => m.officeId === officeId),
    create: async (officeId, input: NewMission) => {
      const at = now().toISOString();
      const mission: Mission = {
        id: `local-${++counter}`,
        officeId,
        source: 'mine',
        ownerLogin: me,
        title: input.title.trim(),
        steps: input.steps ?? [],
        place: input.place ?? null,
        dueAt: input.dueAt ?? null,
        personLogin: input.personLogin ?? null,
        shared: input.shared ?? false,
        done: false,
        createdAt: at,
        updatedAt: at,
      };
      missions = [...missions, mission];
      changed();
      return mission;
    },
    update: async (_officeId, missionId, patch: MissionPatch) => {
      const current = missions.find((m) => m.id === missionId);
      if (!current) {
        throw new Error('No such mission');
      }
      const next: Mission = { ...current, ...patch, updatedAt: now().toISOString() };
      missions = missions.map((m) => (m.id === missionId ? next : m));
      changed();
      return next;
    },
    remove: async (_officeId, missionId) => {
      missions = missions.filter((m) => m.id !== missionId);
      changed();
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
