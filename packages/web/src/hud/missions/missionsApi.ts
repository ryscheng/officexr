import { ZMission, ZNewMission, type Mission, type MissionPatch, type MissionsClient, type NewMission } from '@officexr/sdk';
import { apiFetch } from '../../apiOrigin';

export class MissionsUnsupportedError extends Error {
  constructor() {
    super('The server has no missions API');
  }
}

export class MissionsRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const base = (officeId: string) => `/api/offices/${encodeURIComponent(officeId)}/missions`;

const MESSAGES: Record<number, string> = {
  400: 'The server did not accept that mission',
  403: 'Only the owner can change this mission',
  404: 'That mission no longer exists',
  409: 'Too many open missions',
  413: 'That mission is too large',
  415: 'The server did not accept that mission',
};

function check(res: Response, { unsupportedOn404 = false } = {}): Response {
  if (res.ok) {
    return res;
  }
  if (res.status === 404 && unsupportedOn404) {
    throw new MissionsUnsupportedError();
  }
  throw new MissionsRequestError(res.status, MESSAGES[res.status] ?? `Missions request failed (${res.status})`);
}

async function readMission(res: Response): Promise<Mission> {
  const body = (await check(res).json()) as { mission: unknown };
  return ZMission.parse(body.mission);
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function newMissionError(input: NewMission): string | null {
  const parsed = ZNewMission.safeParse(input);
  if (parsed.success) {
    return null;
  }
  return parsed.error.issues[0]?.path[0] === 'title' ? 'Title needs visible text' : 'That mission is not valid';
}

export function createHttpMissionsClient(fetchFn: typeof apiFetch = apiFetch): MissionsClient {
  return {
    async list(officeId) {
      const body = (await check(await fetchFn(base(officeId)), { unsupportedOn404: true }).json()) as { missions: unknown[] };
      return body.missions.map((m) => ZMission.parse(m));
    },
    async create(officeId, input: NewMission) {
      return readMission(await fetchFn(base(officeId), json('POST', input)));
    },
    async update(officeId, missionId, patch: MissionPatch) {
      return readMission(await fetchFn(`${base(officeId)}/${encodeURIComponent(missionId)}`, json('PATCH', patch)));
    },
    async remove(officeId, missionId) {
      check(await fetchFn(`${base(officeId)}/${encodeURIComponent(missionId)}`, { method: 'DELETE' }));
    },
  };
}
