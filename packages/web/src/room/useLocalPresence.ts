import { useEffect } from 'react';
import type { Actions, MicState, PresenceStatus } from '@officexr/sdk';
import { createMicActivityMeter, type MicActivityMeter } from '../voice/micActivity';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { micState, presenceStatus } from './presence';

export type PresenceVoice = Pick<JaasVoiceAdapter, 'getConnectionState' | 'on' | 'isMicMuted' | 'onMuteChange'>;

export interface LocalPresenceDeps {
  readDocument(): { hidden: boolean; focused: boolean };
  createMeter(): MicActivityMeter;
}

const browserDeps: LocalPresenceDeps = {
  readDocument: () => ({ hidden: document.hidden, focused: document.hasFocus() }),
  createMeter: () => createMicActivityMeter(),
};

/**
 * Reports tab focus and mic activity through `actions.setSelfPresence`, only when either changes.
 * `blur` also fires when focus moves into the Jitsi iframe, so focus is re-read with
 * `document.hasFocus()` on each event instead of inferred from the event.
 */
export function useLocalPresence(
  actions: Pick<Actions, 'setSelfPresence'>,
  voice: PresenceVoice | null,
  { readDocument, createMeter }: LocalPresenceDeps = browserDeps,
): void {
  useEffect(() => {
    // The SDK starts every player as available with no mic.
    let sent: { status: PresenceStatus; mic: MicState } = { status: 'available', mic: 'none' };
    let speaking = false;
    let meter: MicActivityMeter | null = null;
    let stopListening = () => {};

    const push = () => {
      const next = {
        status: presenceStatus(readDocument()),
        mic: micState({ inCall: meter !== null, muted: voice?.isMicMuted() ?? false, speaking }),
      };
      if (next.status !== sent.status || next.mic !== sent.mic) {
        sent = next;
        actions.setSelfPresence(next);
      }
    };

    // One meter per call, so a mic that can't be opened is not retried until the next call.
    const syncCall = () => {
      const inCall = voice?.getConnectionState() === 'connected';
      if (inCall && !meter) {
        meter = createMeter();
        stopListening = meter.onChange((next) => {
          speaking = next;
          push();
        });
      } else if (!inCall && meter) {
        meter.stop();
        stopListening();
        meter = null;
        speaking = false;
      }
      if (meter) {
        if (voice?.isMicMuted()) {
          meter.stop();
        } else {
          meter.start();
        }
      }
      push();
    };

    const subscriptions = [
      voice?.on('connection-state-change', syncCall),
      voice?.onMuteChange(syncCall),
    ];
    document.addEventListener('visibilitychange', push);
    window.addEventListener('focus', push);
    window.addEventListener('blur', push);
    syncCall();

    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe?.());
      document.removeEventListener('visibilitychange', push);
      window.removeEventListener('focus', push);
      window.removeEventListener('blur', push);
      meter?.stop();
      stopListening();
    };
  }, [actions, voice, readDocument, createMeter]);
}
