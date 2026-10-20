import { useEffect, useState } from 'react';
import {
  createPersistentLocalState,
  createStack,
  startOfficeSync,
  type OfficeSync,
  type PersistentLocalState,
} from '@officexr/core-refactor';
import { BotPool } from '@officexr/world/bot';
import type { Identity } from '../../server/api';
import { generateJaaSJwt } from '../voice/jaasJwt';
import { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { getJaasConfig } from '../voice/runtimeConfig';

export type OfficeSession =
  | { type: 'connecting' }
  | { type: 'ready'; local: PersistentLocalState; office: OfficeSync; bots: BotPool; voice: JaasVoiceAdapter | null }
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
    // <Scene> requires a pool; this page never spawns bots.
    const bots = new BotPool({
      createChannel: () => {
        throw new Error('the office page runs no bots');
      },
      localPlayerId: me.login,
    });
    let cancelled = false;
    let office: OfficeSync | undefined;
    // ponytail: a server-initiated close (same login in another tab, sidecar restart) isn't surfaced or retried.
    startOfficeSync({ local, channel, voice: voiceAdapter }).then(
      (started) => {
        if (cancelled) {
          started.stop();
          return;
        }
        office = started;
        // After start, so the sync engine announces the name to the office.
        local.actions.upsertPlayer({ id: me.login, name: me.name });
        setSession({ type: 'ready', local, office: started, bots, voice });
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
      bots.stop();
      voiceAdapter.dispose();
      channel.close();
    };
  }, [officeId, me.login, me.name]);
  return session;
}
