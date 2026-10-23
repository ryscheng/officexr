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

export type OfficeSession =
  | { type: 'connecting' }
  | { type: 'ready'; local: PersistentLocalState; office: OfficeSync; voice: JaasVoiceAdapter | null }
  | { type: 'error'; message: string };

function createJaasVoice(me: Identity): JaasVoiceAdapter | null {
  const jaas = getJaasConfig();
  if (!jaas) {
    return null;
  }
  const jwt = generateJaaSJwt(jaas.appId, jaas.apiKeyId, jaas.privateKeyPem, { id: me.login, name: me.name, email: '' });
  return new JaasVoiceAdapter({ appId: jaas.appId, jwt, displayName: me.name });
}

/** Joins `officeId` on the realtime server (proxied at `/ws`) as `me`, with JaaS voice when `/config.js` has keys. */
export function useOfficeSession(officeId: string, me: Identity): OfficeSession {
  const [session, setSession] = useState<OfficeSession>({ type: 'connecting' });
  useEffect(() => {
    setSession({ type: 'connecting' });
    const local = createPersistentLocalState({ selfId: me.login, officeId });
    const voice = createJaasVoice(me);
    const { channel, voiceAdapter } = createStack({
      mode: 'ws',
      url: `${window.location.origin.replace(/^http/, 'ws')}/ws`,
      selfId: me.login,
      officeId,
      voiceAdapter: voice ?? undefined,
    });
    let cancelled = false;
    let office: OfficeSync | undefined;
    const character = loadCharacter(officeId, me.login);
    startOfficeSync({ local, channel, voice: voiceAdapter }).then(
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
        local.actions.upsertPlayer({ id: me.login, name: me.name, avatar: { model } });
        setSession({ type: 'ready', local, office: started, voice });
      },
      (err: Error) => {
        if (!cancelled) {
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
  }, [officeId, me.login, me.name]);
  return session;
}
