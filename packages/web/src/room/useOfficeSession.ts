import { useEffect, useState } from 'react';
import {
  createPersistentLocalState,
  createStack,
  startOfficeSync,
  type OfficeSync,
  type PersistentLocalState,
} from '@officexr/core-refactor';
import type { ViewMode } from '@officexr/sdk';
import type { Identity } from '@officexr/server/shared';
import { createDeskClaimRequester, type DeskClaimRequester, type RequestDeskClaim } from '../desk/requestDeskClaim';
import { wsUrl } from '../apiOrigin';
import { fetchJaasToken, jaasTokenSource } from '../voice/jaasToken';
import { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { getJaasAppId } from '../voice/runtimeConfig';
import { loadCharacter } from './character';
import { fetchRealtimeToken } from './realtimeToken';

export type OfficeSession =
  | { type: 'connecting' }
  | { type: 'ready'; local: PersistentLocalState; office: OfficeSync; voice: JaasVoiceAdapter | null; requestDeskClaim: RequestDeskClaim }
  | { type: 'replaced' }
  | { type: 'error'; message: string };

/**
 * JaaS voice in `officeId` shown as `displayName`, or null when this deployment has no JaaS app id or the server mints no token
 * (not configured, signed out, or unreachable): voice is then off and the office still opens.
 */
async function createJaasVoice(officeId: string, displayName: string): Promise<JaasVoiceAdapter | null> {
  const appId = getJaasAppId();
  if (!appId) {
    return null;
  }
  try {
    const first = await fetchJaasToken(officeId);
    const getJwt = jaasTokenSource(first, () => fetchJaasToken(officeId));
    return new JaasVoiceAdapter({ appId, getJwt, displayName });
  } catch (err) {
    console.warn('Voice is off: no JaaS token from the server:', err);
    return null;
  }
}

/**
 * Joins `officeId` on the realtime server (proxied at `/ws`) as player `selfId` of `me`, once `enabled`, with JaaS
 * voice when `/config.js` has an app id and the server mints a voice token. The self player stays unannounced until
 * `office.sync.releaseSelf()`.
 */
export function useOfficeSession(
  officeId: string,
  me: Identity,
  selfId: string,
  enabled: boolean,
  viewMode: ViewMode,
  start: typeof startOfficeSync = startOfficeSync,
): OfficeSession {
  const [session, setSession] = useState<OfficeSession>({ type: 'connecting' });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    setSession({ type: 'connecting' });
    let cancelled = false;
    let teardown: (() => void) | undefined;
    // The stack takes its voice adapter at creation, so the voice token is settled first.
    void createJaasVoice(officeId, me.name).then((voice) => {
      if (cancelled) {
        voice?.dispose();
        return;
      }
      teardown = join(voice);
    });

    function join(voice: JaasVoiceAdapter | null): () => void {
      const local = createPersistentLocalState({ selfId, officeId });
      const { channel, voiceAdapter } = createStack({
        mode: 'ws',
        url: wsUrl(),
        selfId,
        login: me.login,
        officeId,
        getToken: () => fetchRealtimeToken(),
        voiceAdapter: voice ?? undefined,
      });
      let office: OfficeSync | undefined;
      let deskClaims: DeskClaimRequester | undefined;
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
          local.actions.upsertPlayer({ id: selfId, name: me.name, avatar: { model, viewMode } });
          deskClaims = createDeskClaimRequester(channel);
          setSession({ type: 'ready', local, office: started, voice, requestDeskClaim: deskClaims.request });
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
        office?.stop();
        deskClaims?.dispose();
        voiceAdapter.dispose();
        channel.close();
      };
    }

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [officeId, me.login, me.name, selfId, enabled, viewMode, start]);
  return session;
}
