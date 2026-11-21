import { useEffect, useState, useSyncExternalStore } from 'react';
import type { OfficeState, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';

export type ConnectionView = 'live' | 'connecting' | 'reconnecting' | 'cannot' | 'offline' | 'recovered';

export const STALL_MS = 20_000;
export const RECOVERED_MS = 3_000;

const selectStatus = (s: OfficeState) => s.realtime.status;

const subscribeOnline = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};
const isOnline = () => navigator.onLine;
const assumeOnline = () => true;

type Phase = 'up' | 'down' | 'recovered';

export function useConnectionView(store: Store, stallMs = STALL_MS): { view: ConnectionView; online: boolean } {
  const status = useStoreSelector(store, selectStatus);
  const online = useSyncExternalStore(subscribeOnline, isOnline, assumeOnline);
  const [phase, setPhase] = useState<Phase>('up');
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (status === 'reconnecting' || !online) {
      setPhase('down');
    } else if (status === 'live') {
      setPhase((p) => (p === 'down' ? 'recovered' : p));
    }
  }, [status, online]);

  useEffect(() => {
    if (phase !== 'recovered') {
      return;
    }
    const timer = setTimeout(() => setPhase('up'), RECOVERED_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'down') {
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), stallMs);
    return () => clearTimeout(timer);
  }, [phase, stallMs]);

  return { view: viewOf(status, online, phase, stalled), online };
}

function viewOf(status: OfficeState['realtime']['status'], online: boolean, phase: Phase, stalled: boolean): ConnectionView {
  if (status === 'replaced') {
    return 'live';
  }
  if (!online) {
    return 'offline';
  }
  if (status === 'reconnecting' || phase === 'down') {
    return stalled ? 'cannot' : 'reconnecting';
  }
  if (status === 'connecting' || status === 'snapshot-pending') {
    return 'connecting';
  }
  return phase === 'recovered' ? 'recovered' : 'live';
}
