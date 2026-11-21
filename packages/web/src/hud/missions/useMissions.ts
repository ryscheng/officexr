import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mission, MissionPatch, MissionsClient, NewMission } from '@officexr/sdk';
import { MissionsRequestError, MissionsUnsupportedError, newMissionError } from './missionsApi';

export type MissionsStatus = 'loading' | 'ready' | 'unsupported' | 'error';

export interface MissionsApi {
  status: MissionsStatus;
  /** Why the last action failed; cleared by the next success. */
  error: string | null;
  missions: Mission[];
  current: Mission | null;
  setCurrent(id: string | null): void;
  create(input: NewMission): Promise<Mission | null>;
  update(id: string, patch: MissionPatch): Promise<boolean>;
  remove(id: string): Promise<void>;
}

const errorText = (err: unknown) => (err instanceof MissionsRequestError ? err.message : 'Could not reach missions');

export function useMissions(
  client: MissionsClient,
  officeId: string,
  subscribeChanged?: (listener: (officeId: string) => void) => () => void,
): MissionsApi {
  const [status, setStatus] = useState<MissionsStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const request = useRef(0);
  const epoch = useRef(0);
  const inflight = useRef(false);
  const queued = useRef(false);
  const reloadRef = useRef<() => void>(() => {});

  const reload = useCallback(() => {
    if (inflight.current) {
      queued.current = true;
      return;
    }
    inflight.current = true;
    const mine = ++request.current;
    const generation = epoch.current;
    client
      .list(officeId)
      .then(
        (list) => {
          if (generation !== epoch.current) {
            return;
          }
          if (mine === request.current) {
            setMissions(list);
            setStatus('ready');
            setError(null);
          } else {
            queued.current = true;
          }
        },
        (err: unknown) => {
          if (generation === epoch.current && mine === request.current) {
            setStatus(err instanceof MissionsUnsupportedError ? 'unsupported' : 'error');
          }
        },
      )
      .finally(() => {
        if (generation !== epoch.current) {
          return;
        }
        inflight.current = false;
        if (queued.current) {
          queued.current = false;
          reloadRef.current();
        }
      });
  }, [client, officeId]);
  reloadRef.current = reload;

  useEffect(() => {
    reload();
    return () => {
      epoch.current++;
      inflight.current = false;
      queued.current = false;
    };
  }, [reload]);

  useEffect(
    () => subscribeChanged?.((changed) => changed === officeId && reload()),
    [subscribeChanged, officeId, reload],
  );

  const replace = useCallback((next: Mission) => {
    request.current++;
    setMissions((list) => (list.some((m) => m.id === next.id) ? list.map((m) => (m.id === next.id ? next : m)) : [...list, next]));
  }, []);

  const fail = useCallback(
    (err: unknown, id?: string) => {
      setError(errorText(err));
      if (err instanceof MissionsRequestError && err.status === 404 && id) {
        setMissions((list) => list.filter((m) => m.id !== id));
        reload();
      }
    },
    [reload],
  );

  const create = useCallback(
    async (input: NewMission) => {
      const invalid = newMissionError(input);
      if (invalid) {
        setError(invalid);
        return null;
      }
      try {
        const mission = await client.create(officeId, input);
        replace(mission);
        setError(null);
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
        setError(null);
        return true;
      } catch (err) {
        fail(err, id);
        return false;
      }
    },
    [client, officeId, replace, fail],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await client.remove(officeId, id);
        request.current++;
        setMissions((list) => list.filter((m) => m.id !== id));
        setError(null);
      } catch (err) {
        fail(err, id);
      }
    },
    [client, officeId, fail],
  );

  const found = missions.find((m) => m.id === currentId);
  return { status, error, missions, current: found && !found.done ? found : null, setCurrent: setCurrentId, create, update, remove };
}
