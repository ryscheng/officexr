import { useCallback, useEffect, useRef } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { PresenceEntry } from '@/types/room';

export interface RealtimeChannelHandle {
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  channelSubscribedRef: React.MutableRefObject<boolean>;
  myPresenceRef: React.MutableRefObject<PresenceEntry | null>;
  /** Convenience wrapper — sends a broadcast event if channel is subscribed. */
  send: (event: string, payload: Record<string, unknown>) => void;
  /** Update own presence data and re-track on the channel. */
  track: (data: PresenceEntry) => void;
}

interface UseRealtimeChannelOptions {
  officeId: string;
  userId: string | undefined;
}

/**
 * Creates and manages a Supabase Realtime channel for the given office.
 *
 * The channel is created but NOT subscribed — the caller (or another hook) is
 * responsible for registering listeners and calling `channelRef.current.subscribe()`.
 * This lets multiple hooks register their `.on()` handlers before the channel goes live.
 *
 * On cleanup the channel is untracked and removed.
 */
export function useRealtimeChannel({ officeId, userId }: UseRealtimeChannelOptions): RealtimeChannelHandle {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const channelSubscribedRef = useRef(false);
  const myPresenceRef = useRef<PresenceEntry | null>(null);

  useEffect(() => {
    if (!userId) return;

    const channelName = `office:${officeId}`;
    const channel = supabase.channel(channelName, {
      config: {
        presence: { key: userId },
        broadcast: { ack: true, self: false },
      },
    });

    channelRef.current = channel;

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
      channelSubscribedRef.current = false;
      myPresenceRef.current = null;
    };
  }, [officeId, userId]);

  const send = useCallback((event: string, payload: Record<string, unknown>) => {
    if (!channelRef.current || !channelSubscribedRef.current) return;
    channelRef.current.send({ type: 'broadcast', event, payload })
      .then((result: string) => {
        if (result !== 'ok') console.error(`[Broadcast] ${event} failed:`, result);
      });
  }, []);

  const track = useCallback((data: PresenceEntry) => {
    if (!channelRef.current) return;
    myPresenceRef.current = data;
    channelRef.current.track(data);
  }, []);

  return { channelRef, channelSubscribedRef, myPresenceRef, send, track };
}
