import { useCallback, useEffect } from 'react';
import type { OfficeState } from '@officexr/sdk';
import { loginOf, type Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';

const SEPARATOR = '|';

/** Call ids change as people rejoin, so the muted set is re-sent whenever one does. */
export function useMutedVoice(store: Store, voice: Pick<JaasVoiceAdapter, 'setMutedParticipants'> | null, muted: ReadonlySet<string>): void {
  const select = useCallback(
    (s: OfficeState) =>
      Object.values(s.players)
        .filter((p) => p.id !== s.selfId && p.jitsiParticipantId && muted.has(loginOf(p.id)))
        .map((p) => p.jitsiParticipantId!)
        .sort()
        .join(SEPARATOR),
    [muted],
  );
  const ids = useStoreSelector(store, select);
  useEffect(() => voice?.setMutedParticipants(ids ? ids.split(SEPARATOR) : []), [voice, ids]);
}
