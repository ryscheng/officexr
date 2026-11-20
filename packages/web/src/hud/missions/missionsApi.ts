import { ZMission, type Mission, type MissionPatch, type MissionsClient, type NewMission } from '@officexr/sdk';
import { apiFetch } from '../../apiOrigin';

export class MissionsUnsupportedError extends Error {
  constructor() {
    super('The server has no missions API');
  }
}

const base = (officeId: string) => `/api/offices/${encodeURIComponent(officeId)}/missions`;

function check(res: Response): Response {
  if (res.status === 404) {
    throw new MissionsUnsupportedError();
  }
  if (!res.ok) {
    throw new Error(`Missions request failed (${res.status})`);
  }
  return res;
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

export function createHttpMissionsClient(fetchFn: typeof apiFetch = apiFetch): MissionsClient {
  return {
    async list(officeId) {
      const body = (await check(await fetchFn(base(officeId))).json()) as { missions: unknown[] };
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
