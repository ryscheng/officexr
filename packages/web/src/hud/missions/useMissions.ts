import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mission, MissionPatch, MissionsClient, NewMission } from '@officexr/sdk';
import { MissionsUnsupportedError } from './missionsApi';

export type MissionsStatus = 'loading' | 'ready' | 'unsupported' | 'error';

export interface MissionsApi {
  status: MissionsStatus;
  missions: Mission[];
  current: Mission | null;
  setCurrent(id: string | null): void;
  create(input: NewMission): Promise<Mission | null>;
  update(id: string, patch: MissionPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

export function useMissions(
  client: MissionsClient,
  officeId: string,
  subscribeChanged?: (listener: (officeId: string) => void) => () => void,
): MissionsApi {
  const [status, setStatus] = useState<MissionsStatus>('loading');
  const [missions, setMissions] = useState<Mission[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const request = useRef(0);

  const fail = useCallback((err: unknown) => {
    setStatus(err instanceof MissionsUnsupportedError ? 'unsupported' : 'error');
  }, []);

  const reload = useCallback(() => {
    const mine = ++request.current;
    client.list(officeId).then(
      (list) => {
        if (mine === request.current) {
          setMissions(list);
          setStatus('ready');
        }
      },
      (err: unknown) => {
        if (mine === request.current) {
          fail(err);
        }
      },
    );
  }, [client, officeId, fail]);

  useEffect(() => {
    reload();
    return () => {
      request.current++;
    };
  }, [reload]);

  useEffect(
    () => subscribeChanged?.((changed) => changed === officeId && reload()),
    [subscribeChanged, officeId, reload],
  );

  const replace = useCallback((next: Mission) => {
    setMissions((list) => (list.some((m) => m.id === next.id) ? list.map((m) => (m.id === next.id ? next : m)) : [...list, next]));
  }, []);

  const create = useCallback(
    async (input: NewMission) => {
      try {
        const mission = await client.create(officeId, input);
        replace(mission);
        return mission;
      } catch (err) {
        fail(err);
        return null;
      }
    },
    [client, officeId, replace, fail],
  );

  const update = useCallback(
    async (id: string, patch: MissionPatch) => {
      try {
        replace(await client.update(officeId, id, patch));
      } catch (err) {
        fail(err);
      }
    },
    [client, officeId, replace, fail],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await client.remove(officeId, id);
        setMissions((list) => list.filter((m) => m.id !== id));
      } catch (err) {
        fail(err);
      }
    },
    [client, officeId, fail],
  );

  const found = missions.find((m) => m.id === currentId);
  return { status, missions, current: found && !found.done ? found : null, setCurrent: setCurrentId, create, update, remove };
}
