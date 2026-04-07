import { useEffect, useRef, useState, useCallback } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type ConnectionQuality = 'good' | 'fair' | 'poor';

export interface PeerStats {
  peerId: string;
  peerName: string;
  pingHistory: number[];    // rolling window of RTT samples (ms)
  avgPingMs: number;
  updateRate: number;       // position updates received per second
  quality: ConnectionQuality;
  lastUpdated: number;
}

export interface NetworkStats {
  localPingMs: number;
  localPingHistory: number[];
  localQuality: ConnectionQuality;
  peers: Map<string, PeerStats>;
  recordPositionUpdate: (peerId: string) => void;
}

const MAX_PING_SAMPLES = 30;
const PING_INTERVAL_MS = 2000;
const RATE_WINDOW_MS = 5000;

function deriveQuality(avgPing: number, updateRate: number): ConnectionQuality {
  if (avgPing < 150 && updateRate > 12) return 'good';
  if (avgPing < 300 && updateRate > 8) return 'fair';
  return 'poor';
}

/**
 * Hook that measures network quality per peer via Supabase broadcast.
 *
 * Ping: sends timestamped pings on a channel; peers echo them back as pongs.
 * Update rate: counts position broadcasts received per peer over a sliding window.
 */
export function useNetworkStats(
  channelRef: React.RefObject<RealtimeChannel | null>,
  channelSubscribedRef: React.RefObject<boolean>,
  currentUserId: string | undefined,
  onlineUsers: Array<{ id: string; name: string }>,
  enabled: boolean,
): NetworkStats {
  const noopRecord = useCallback((_: string) => {}, []);
  const [stats, setStats] = useState<Omit<NetworkStats, 'recordPositionUpdate'>>({
    localPingMs: 0,
    localPingHistory: [],
    localQuality: 'good',
    peers: new Map(),
  });

  // Track position update timestamps per peer: peerId -> array of timestamps
  const positionTimestampsRef = useRef<Map<string, number[]>>(new Map());
  // Pending pings: pingId -> { sentAt, targetPeerId }
  const pendingPingsRef = useRef<Map<string, { sentAt: number; targetPeerId: string }>>(new Map());
  // Peer ping histories (mutable, synced to state periodically)
  const peerPingHistoriesRef = useRef<Map<string, number[]>>(new Map());
  const localPingHistoryRef = useRef<number[]>([]);
  // Keep onlineUsers in a ref so the stats interval always reads the latest value
  const onlineUsersRef = useRef(onlineUsers);
  onlineUsersRef.current = onlineUsers;

  // Record a position update for a peer
  const recordPositionUpdate = useCallback((peerId: string) => {
    if (!enabled) return;
    const now = Date.now();
    const timestamps = positionTimestampsRef.current.get(peerId) || [];
    timestamps.push(now);
    // Keep only timestamps within the rate window
    const cutoff = now - RATE_WINDOW_MS;
    const filtered = timestamps.filter(t => t > cutoff);
    positionTimestampsRef.current.set(peerId, filtered);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !channelRef.current || !channelSubscribedRef.current || !currentUserId) return;

    const channel = channelRef.current;

    // Listen for pings from other peers and respond with pongs
    const handlePing = ({ payload }: { payload: any }) => {
      const { senderId, pingId, timestamp } = payload as {
        senderId: string; pingId: string; timestamp: number;
      };
      if (senderId === currentUserId) return;
      // Echo back as pong
      channel.send({
        type: 'broadcast',
        event: 'net-pong',
        payload: { responderId: currentUserId, pingId, originalTimestamp: timestamp },
      });
    };

    // Listen for pong responses to our pings
    const handlePong = ({ payload }: { payload: any }) => {
      const { responderId, pingId, originalTimestamp } = payload as {
        responderId: string; pingId: string; originalTimestamp: number;
      };
      const pending = pendingPingsRef.current.get(pingId);
      if (!pending) return;
      pendingPingsRef.current.delete(pingId);

      const rtt = Date.now() - pending.sentAt;

      // Update peer ping history
      const history = peerPingHistoriesRef.current.get(responderId) || [];
      history.push(rtt);
      if (history.length > MAX_PING_SAMPLES) history.shift();
      peerPingHistoriesRef.current.set(responderId, history);
    };

    channel.on('broadcast', { event: 'net-ping' }, handlePing);
    channel.on('broadcast', { event: 'net-pong' }, handlePong);

    // Send pings periodically
    const pingInterval = setInterval(() => {
      if (!channelRef.current || !channelSubscribedRef.current) return;
      const pingId = `${currentUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      pendingPingsRef.current.set(pingId, { sentAt: now, targetPeerId: 'broadcast' });
      // Clean up old pending pings (>10s)
      pendingPingsRef.current.forEach((v, k) => {
        if (now - v.sentAt > 10000) pendingPingsRef.current.delete(k);
      });
      channelRef.current.send({
        type: 'broadcast',
        event: 'net-ping',
        payload: { senderId: currentUserId, pingId, timestamp: now },
      });
    }, PING_INTERVAL_MS);

    // Compute stats periodically
    const statsInterval = setInterval(() => {
      const now = Date.now();
      const peers = new Map<string, PeerStats>();

      const userMap = new Map(onlineUsersRef.current.map(u => [u.id, u.name]));

      userMap.forEach((name, peerId) => {
        if (peerId === currentUserId) return;

        const pingHistory = peerPingHistoriesRef.current.get(peerId) || [];
        const avgPingMs = pingHistory.length > 0
          ? Math.round(pingHistory.reduce((a, b) => a + b, 0) / pingHistory.length)
          : 0;

        // Compute update rate from position timestamps
        const timestamps = positionTimestampsRef.current.get(peerId) || [];
        const recentTimestamps = timestamps.filter(t => t > now - RATE_WINDOW_MS);
        const updateRate = Math.round((recentTimestamps.length / (RATE_WINDOW_MS / 1000)) * 10) / 10;

        const quality = pingHistory.length > 0
          ? deriveQuality(avgPingMs, updateRate)
          : 'good'; // No data yet, assume good

        peers.set(peerId, {
          peerId,
          peerName: name,
          pingHistory: [...pingHistory],
          avgPingMs,
          updateRate,
          quality,
          lastUpdated: now,
        });
      });

      // Local ping: average of all peer pings (our RTT to the server and back)
      const allPings = [...peerPingHistoriesRef.current.values()].flat();
      const localPingMs = allPings.length > 0
        ? Math.round(allPings.reduce((a, b) => a + b, 0) / allPings.length)
        : 0;

      // Local ping history: average per sample across peers
      const localHistory = localPingHistoryRef.current;
      if (allPings.length > 0) {
        localHistory.push(localPingMs);
        if (localHistory.length > MAX_PING_SAMPLES) localHistory.shift();
      }

      const localQuality = allPings.length > 0
        ? (localPingMs < 150 ? 'good' : localPingMs < 300 ? 'fair' : 'poor')
        : 'good';

      setStats({
        localPingMs,
        localPingHistory: [...localHistory],
        localQuality,
        peers,
      });
    }, 1500);

    return () => {
      clearInterval(pingInterval);
      clearInterval(statsInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, currentUserId, channelRef, channelSubscribedRef]);

  return { ...stats, recordPositionUpdate: enabled ? recordPositionUpdate : noopRecord };
}
