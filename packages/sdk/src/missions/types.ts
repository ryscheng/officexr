import { z } from 'zod';

export const MISSIONS_CHANGED_KIND = 'missions:changed';

const noNul = (value: string) => !value.includes('\u0000');
const hasVisible = (value: string) => /[^\p{Cf}\s]/u.test(value);
const text = (max: number) => z.string().trim().min(1).max(max).refine(noNul, 'no NUL').refine(hasVisible, 'must have visible text');
const plain = (max: number) => z.string().min(1).max(max).refine(noNul, 'no NUL');
const instant = z
  .string()
  .datetime()
  .refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return year >= 1970 && year <= 9999;
  }, 'year out of range');
const MAX_LOGIN = 200;

export const MISSION_SOURCES = ['mine', 'artio', 'linear', 'github', 'calendar', 'slack'] as const;
export const ZMissionSource = z.enum(MISSION_SOURCES);
export type MissionSource = z.infer<typeof ZMissionSource>;

export const ZMissionStep = z.object({ text: text(140), done: z.boolean() });
export type MissionStep = z.infer<typeof ZMissionStep>;

/** Where "Go" leads: a room or desk id from the office map, with a label for display. */
export const ZMissionPlace = z.object({
  kind: z.enum(['room', 'desk']),
  id: plain(100),
  label: plain(80),
});
export type MissionPlace = z.infer<typeof ZMissionPlace>;

export const ZMission = z.object({
  id: z.string().min(1),
  officeId: z.string().min(1),
  source: ZMissionSource,
  ownerLogin: z.string().min(1),
  title: z.string().min(1).max(140),
  steps: z.array(ZMissionStep).max(20),
  place: ZMissionPlace.nullable(),
  /** ISO instant, so each viewer formats it in their own zone. */
  dueAt: z.string().min(1).nullable(),
  personLogin: plain(MAX_LOGIN).nullable(),
  shared: z.boolean(),
  done: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type Mission = z.infer<typeof ZMission>;

export const ZNewMission = z.object({
  title: text(140),
  steps: z.array(ZMissionStep).max(20).default([]),
  place: ZMissionPlace.nullable().default(null),
  dueAt: instant.nullable().default(null),
  personLogin: plain(MAX_LOGIN).nullable().default(null),
  shared: z.boolean().default(false),
});
export type NewMission = z.input<typeof ZNewMission>;

export const ZMissionPatch = z
  .object({
    title: text(140),
    steps: z.array(ZMissionStep).max(20),
    place: ZMissionPlace.nullable(),
    dueAt: instant.nullable(),
    personLogin: plain(MAX_LOGIN).nullable(),
    shared: z.boolean(),
    done: z.boolean(),
  })
  .partial();
export type MissionPatch = z.infer<typeof ZMissionPatch>;

/** Realtime hint after a mission changes; clients re-read the list over HTTP. */
export const ZMissionsChanged = z.object({ officeId: z.string().min(1) });
export type MissionsChanged = z.infer<typeof ZMissionsChanged>;

/**
 * HTTP contract (web backend):
 *   GET    /api/offices/:officeId/missions             -> { missions: Mission[] }  (own + shared in that office)
 *   POST   /api/offices/:officeId/missions             body NewMission   -> { mission: Mission }  201
 *   PATCH  /api/offices/:officeId/missions/:missionId  body MissionPatch -> { mission: Mission }
 *   DELETE /api/offices/:officeId/missions/:missionId                    -> 204
 * Only the owner edits or deletes; anyone in the office may set `done` on a shared mission.
 */
export interface MissionsClient {
  list(officeId: string): Promise<Mission[]>;
  create(officeId: string, input: NewMission): Promise<Mission>;
  update(officeId: string, missionId: string, patch: MissionPatch): Promise<Mission>;
  remove(officeId: string, missionId: string): Promise<void>;
}
