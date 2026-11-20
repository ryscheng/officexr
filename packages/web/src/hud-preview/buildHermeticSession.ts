import { createInMemoryChannelHub } from '@officexr/sdk';
import { createPersistentLocalState, createStack, startOfficeSync } from '@officexr/core-refactor';
import type { HermeticWorld } from '../room/OfficeWorld';
import { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { getScenario, SELF_ID, SELF_NAME, seedScenario } from './scenarios';

const OFFICE_ID = 'hud-preview';
const UNAVAILABLE = { ok: false, error: 'unavailable' } as const;

/** Joins an in-memory office as the fake self and seeds `scenarioId` into the local store. */
export async function buildHermeticSession(scenarioId: string | null): Promise<HermeticWorld & { dispose: () => void }> {
  const scenario = getScenario(scenarioId);
  const local = createPersistentLocalState({ selfId: SELF_ID, officeId: OFFICE_ID });
  const { channel, voiceAdapter } = createStack({ mode: 'local', hub: createInMemoryChannelHub(), selfId: SELF_ID });
  const office = await startOfficeSync({ local, channel, voice: voiceAdapter, holdSelf: true });
  local.actions.upsertPlayer({ id: SELF_ID, name: SELF_NAME, avatar: { model: 'Mage' } });
  const stopSeeding = seedScenario(scenario, local);
  // Never joins a room, so no Jitsi iframe loads; the call bar only needs the adapter's mute and share state.
  const voice = new JaasVoiceAdapter({ appId: 'hud-preview', getJwt: () => Promise.reject(new Error('no voice')), displayName: SELF_NAME });
  return {
    session: {
      type: 'ready',
      local,
      office,
      voice,
      requestDeskClaim: () => Promise.resolve(UNAVAILABLE),
      requestPropOp: () => Promise.resolve(UNAVAILABLE),
    },
    dispose: () => {
      stopSeeding();
      office.stop();
      voice.dispose();
      voiceAdapter.dispose();
      channel.close();
    },
  };
}
