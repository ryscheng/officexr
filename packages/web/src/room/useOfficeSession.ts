import { useEffect, useState } from 'react';
import {
  createPersistentLocalState,
  createStack,
  startOfficeSync,
  type OfficeSync,
  type PersistentLocalState,
} from '@officexr/core-refactor';
import type { Identity } from '../../server/api';
import { generateJaaSJwt } from '../voice/jaasJwt';
import { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { getJaasConfig } from '../voice/runtimeConfig';
import { loadCharacter } from './character';
import { fetchRealtimeToken } from './realtimeToken';

export type OfficeSession =
  | { type: 'connecting' }
  | { type: 'ready'; local: PersistentLocalState; office: OfficeSync; voice: JaasVoiceAdapter | null }
  | { type: 'replaced' }
  | { type: 'error'; message: string };

function createJaasVoice(me: Identity, selfId: string): JaasVoiceAdapter | null {
  const jaas = getJaasConfig();
  if (!jaas) {
    return null;
  }
  const jwt = generateJaaSJwt(jaas.appId, jaas.apiKeyId, jaas.privateKeyPem, { id: selfId, name: me.name, email: '' });
  return new JaasVoiceAdapter({ appId: jaas.appId, jwt, displayName: me.name });
}

/**
 * Joins `officeId` on the realtime server (proxied at `/ws`) as player `selfId` of `me`, once `enabled`, with JaaS
 * voice when `/config.js` has keys. The self player stays unannounced until `office.sync.releaseSelf()`.
 */
export function useOfficeSession(
  officeId: string,
  me: Identity,
  selfId: string,
  enabled: boolean,
  start: typeof startOfficeSync = startOfficeSync,
): OfficeSession {
  const [session, setSession] = useState<OfficeSession>({ type: 'connecting' });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    setSession({ type: 'connecting' });
    const local = createPersistentLocalState({ selfId, officeId });
    const voice = createJaasVoice(me, selfId);
    const { channel, voiceAdapter } = createStack({
      mode: 'ws',
      url: `${window.location.origin.replace(/^http/, 'ws')}/ws`,
      selfId,
      login: me.login,
      officeId,
      getToken: () => fetchRealtimeToken(),
      voiceAdapter: voice ?? undefined,
    });
    let cancelled = false;
    let office: OfficeSync | undefined;
    const character = loadCharacter(officeId, me.login);
    start({ local, channel, voice: voiceAdapter, holdSelf: true }).then(
      async (started) => {
        if (cancelled) {
          started.stop();
          return;
        }
        // Owned by the cleanup from here on, so it's stopped whatever happens next.
        office = started;
        const model = await character;
        if (cancelled) {
          return;
        }
        // After start, so the sync engine announces the name and character to the office.
        local.actions.upsertPlayer({ id: selfId, name: me.name, avatar: { model } });
        setSession({ type: 'ready', local, office: started, voice });
      },
      (err: Error) => {
        if (cancelled) {
          return;
        }
        // Losing the join race closes the socket as replaced before the handshake completes.
        if (local.store.getState().realtime.status === 'replaced') {
          setSession({ type: 'replaced' });
        } else {
          setSession({ type: 'error', message: `Realtime server not reachable: ${err.message}` });
        }
      },
    );
    return () => {
      cancelled = true;
      office?.stop();
      voiceAdapter.dispose();
      channel.close();
    };
  }, [officeId, me.login, me.name, selfId, enabled, start]);
  return session;
}
