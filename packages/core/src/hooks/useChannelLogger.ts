import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface ChannelLogEntry {
  id: string;
  timestamp: number;
  event: string;
  senderId: string | null;
  senderName: string | null;
  summary: string;
}

export interface UserLastSeen {
  userId: string;
  userName: string;
  event: string;
  timestamp: number;
}

export interface ChannelLoggerResult {
  log: ChannelLogEntry[];
  lastSeenByUser: Map<string, UserLastSeen>;
}

const MAX_LOG_ENTRIES = 200;

// Tracked for lastSeen but not added to the log (too high frequency)
const SKIP_LOG = new Set(['position', 'net-ping', 'net-pong']);

const BROADCAST_EVENTS = [
  'position', 'avatar-update', 'bubble-prefs', 'chat', 'wave', 'confetti',
  'environment-change', 'net-ping', 'net-pong',
  'whiteboard-stroke', 'whiteboard-undo', 'whiteboard-clear',
  'screen-offer', 'screen-answer', 'screen-ice', 'screen-stop',
];

function getSenderId(event: string, payload: any): string | null {
  return payload?.userId
    ?? payload?.senderId
    ?? payload?.responderId
    ?? payload?.from
    ?? payload?.message?.userId
    ?? null;
}

function makeSummary(event: string, payload: any): string {
  try {
    switch (event) {
      case 'chat': {
        const text: string = payload?.message?.message ?? '';
        return text.length > 60 ? text.slice(0, 60) + '…' : text;
      }
      case 'wave': return `→ ${(payload?.toUserId ?? '').slice(0, 8)}`;
      case 'confetti': return `key=${payload?.key}`;
      case 'environment-change': return payload?.environment ?? '';
      case 'whiteboard-stroke': return `${payload?.stroke?.points?.length ?? 0} pts`;
      case 'whiteboard-undo': return `id=${(payload?.strokeId ?? '').slice(0, 8)}`;
      case 'bubble-prefs': return `r=${payload?.prefs?.radius}`;
      case 'position': {
        const p = payload?.position;
        return p ? `(${p.x?.toFixed(1)}, ${p.z?.toFixed(1)})` : '';
      }
      case 'screen-offer':
      case 'screen-answer': return `→ ${(payload?.to ?? '').slice(0, 8)}`;
      case 'screen-ice': return `→ ${(payload?.to ?? '').slice(0, 8)}`;
      case 'avatar-update': return '';
      default: return '';
    }
  } catch { return ''; }
}

/**
 * Logs all Supabase Realtime broadcast and presence events on the channel.
 * High-frequency events (position, net-ping/pong) are tracked for lastSeen
 * but not added to the scrollable log.
 */
export function useChannelLogger(
  channelRef: React.RefObject<RealtimeChannel | null>,
  channelSubscribedRef: React.RefObject<boolean>,
  currentUserId: string | undefined,
  onlineUsers: Array<{ id: string; name: string }>,
  enabled: boolean,
): ChannelLoggerResult {
  const [log, setLog] = useState<ChannelLogEntry[]>([]);
  const [lastSeenByUser, setLastSeenByUser] = useState<Map<string, UserLastSeen>>(new Map());
  const counterRef = useRef(0);
  // Track which channel instance we've registered on to avoid duplicate listeners
  const registeredChannelRef = useRef<RealtimeChannel | null>(null);
  const onlineUsersRef = useRef(onlineUsers);
  onlineUsersRef.current = onlineUsers;

  useEffect(() => {
    if (!enabled || !channelRef.current || !channelSubscribedRef.current || !currentUserId) return;
    if (registeredChannelRef.current === channelRef.current) return;
    registeredChannelRef.current = channelRef.current;

    const channel = channelRef.current;

    const handleBroadcast = (event: string) => ({ payload }: { payload: any }) => {
      const senderId = getSenderId(event, payload);
      if (senderId === currentUserId) return;

      const users = onlineUsersRef.current;
      const senderName = senderId ? (users.find(u => u.id === senderId)?.name ?? null) : null;
      const timestamp = Date.now();
      const summary = makeSummary(event, payload);

      if (senderId) {
        setLastSeenByUser(prev => {
          const next = new Map(prev);
          next.set(senderId, { userId: senderId, userName: senderName ?? senderId.slice(0, 8), event, timestamp });
          return next;
        });
      }

      if (!SKIP_LOG.has(event)) {
        const id = String(++counterRef.current);
        setLog(prev => {
          const entry: ChannelLogEntry = { id, timestamp, event, senderId, senderName, summary };
          const next = [...prev, entry];
          return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
        });
      }
    };

    for (const event of BROADCAST_EVENTS) {
      channel.on('broadcast', { event }, handleBroadcast(event));
    }

    channel.on('presence', { event: 'join' }, ({ newPresences }: { newPresences: any[] }) => {
      const timestamp = Date.now();
      for (const p of (newPresences ?? [])) {
        const id = String(++counterRef.current);
        setLog(prev => {
          const entry: ChannelLogEntry = {
            id, timestamp, event: 'presence:join',
            senderId: p.id ?? null, senderName: p.name ?? null, summary: '',
          };
          const next = [...prev, entry];
          return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
        });
      }
    });

    channel.on('presence', { event: 'leave' }, ({ leftPresences }: { leftPresences: any[] }) => {
      const timestamp = Date.now();
      for (const p of (leftPresences ?? [])) {
        const id = String(++counterRef.current);
        setLog(prev => {
          const entry: ChannelLogEntry = {
            id, timestamp, event: 'presence:leave',
            senderId: p.id ?? null, senderName: p.name ?? null, summary: '',
          };
          const next = [...prev, entry];
          return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
        });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, currentUserId, channelRef, channelSubscribedRef]);

  if (!enabled) return { log: [], lastSeenByUser: new Map() };
  return { log, lastSeenByUser };
}
