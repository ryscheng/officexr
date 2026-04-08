import { useCallback, useRef, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { PresenceEntry, ScreenShare } from '@/types/room';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface ScreenSharingHandle {
  screenShares: Map<string, ScreenShare>;
  activeShareId: string | null;
  setActiveShareId: (id: string | null) => void;
  isSharing: boolean;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  /** Register screen-sharing broadcast listeners on a channel. Call inside the main scene useEffect. */
  registerScreenListeners: (channel: RealtimeChannel, currentUserId: string) => void;
  /** Clean up peer connections without broadcasting (for component unmount). */
  cleanupPeerConnections: () => void;
}

interface UseScreenSharingOptions {
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  currentUserRef: React.MutableRefObject<{ id: string; name: string | null } | null>;
  presenceDataRef: React.MutableRefObject<Map<string, PresenceEntry>>;
}

export function useScreenSharing({
  channelRef,
  currentUserRef,
  presenceDataRef,
}: UseScreenSharingOptions): ScreenSharingHandle {
  const [screenShares, setScreenShares] = useState<Map<string, ScreenShare>>(new Map());
  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const screenPeerConnsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const closeSharerPeerConns = useCallback(() => {
    screenPeerConnsRef.current.forEach((pc, key) => {
      if (key.startsWith('sharer-')) { pc.close(); screenPeerConnsRef.current.delete(key); }
    });
  }, []);

  const closeViewerPeerConn = useCallback((sharerId: string) => {
    const pc = screenPeerConnsRef.current.get(`viewer-${sharerId}`);
    if (pc) { pc.close(); screenPeerConnsRef.current.delete(`viewer-${sharerId}`); }
  }, []);

  const createSharerPeerConn = useCallback((viewerId: string, stream: MediaStream) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    screenPeerConnsRef.current.set(`sharer-${viewerId}`, pc);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      channelRef.current?.send({
        type: 'broadcast', event: 'screen-ice',
        payload: { from: currentUserRef.current!.id, to: viewerId, candidate: candidate.toJSON() },
      });
    };
    pc.createOffer().then(offer => {
      pc.setLocalDescription(offer);
      channelRef.current?.send({
        type: 'broadcast', event: 'screen-offer',
        payload: { from: currentUserRef.current!.id, to: viewerId, sdp: offer.sdp },
      });
    });
  }, []);

  const stopScreenShare = useCallback(() => {
    localScreenStreamRef.current?.getTracks().forEach(t => t.stop());
    localScreenStreamRef.current = null;
    setIsSharing(false);
    const myId = currentUserRef.current?.id;
    if (myId) {
      setScreenShares(prev => { const m = new Map(prev); m.delete(myId); return m; });
      setActiveShareId(prev => prev === myId ? null : prev);
    }
    closeSharerPeerConns();
    channelRef.current?.send({
      type: 'broadcast', event: 'screen-stop',
      payload: { userId: myId },
    });
  }, [closeSharerPeerConns]);

  const startScreenShare = useCallback(async () => {
    if (!currentUserRef.current || !channelRef.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.contentHint = 'detail';
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') console.error('[ScreenShare] getDisplayMedia failed:', err);
      return;
    }
    localScreenStreamRef.current = stream;
    setIsSharing(true);
    const myId = currentUserRef.current.id;
    const myName = currentUserRef.current.name || 'You';
    setScreenShares(prev => new Map(prev).set(myId, { stream, name: myName }));
    setActiveShareId(myId);
    // Create a peer connection for every other user currently in the room
    presenceDataRef.current.forEach((_, userId) => {
      if (userId !== myId) createSharerPeerConn(userId, stream);
    });
    // Auto-stop when the browser's built-in "Stop sharing" button is clicked
    stream.getVideoTracks()[0]?.addEventListener('ended', stopScreenShare);
  }, [createSharerPeerConn, stopScreenShare]);

  const registerScreenListeners = useCallback((channel: RealtimeChannel, currentUserId: string) => {
    // Screen offer — create viewer peer connection
    channel.on('broadcast', { event: 'screen-offer' }, ({ payload }) => {
      const { from, to, sdp } = payload as { from: string; to: string; sdp: string };
      if (to !== currentUserId) return;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      screenPeerConnsRef.current.set(`viewer-${from}`, pc);
      pc.onicecandidate = ({ candidate }) => {
        if (!candidate) return;
        channelRef.current?.send({
          type: 'broadcast', event: 'screen-ice',
          payload: { from: currentUserId, to: from, candidate: candidate.toJSON() },
        });
      };
      pc.ontrack = ({ streams }) => {
        const stream = streams[0];
        if (!stream) return;
        const sharerName = presenceDataRef.current.get(from)?.name || 'Someone';
        setScreenShares(prev => new Map(prev).set(from, { stream, name: sharerName }));
        setActiveShareId(prev => prev ?? from);
      };
      pc.setRemoteDescription({ type: 'offer', sdp })
        .then(() => {
          const queued = pendingIceCandidatesRef.current.get(from) ?? [];
          pendingIceCandidatesRef.current.delete(from);
          return Promise.all([
            pc.createAnswer(),
            ...queued.map(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error)),
          ]);
        })
        .then(([answer]) => pc.setLocalDescription(answer as RTCSessionDescriptionInit).then(() => answer))
        .then(answer => {
          channelRef.current?.send({
            type: 'broadcast', event: 'screen-answer',
            payload: { from: currentUserId, to: from, sdp: (answer as RTCSessionDescriptionInit).sdp },
          });
        })
        .catch(err => console.error('[ScreenShare] answer failed:', err));
    });

    // Screen answer
    channel.on('broadcast', { event: 'screen-answer' }, ({ payload }) => {
      const { from, to, sdp } = payload as { from: string; to: string; sdp: string };
      if (to !== currentUserId) return;
      const pc = screenPeerConnsRef.current.get(`sharer-${from}`);
      if (pc) pc.setRemoteDescription({ type: 'answer', sdp }).catch(console.error);
    });

    // ICE candidates
    channel.on('broadcast', { event: 'screen-ice' }, ({ payload }) => {
      const { from, to, candidate } = payload as { from: string; to: string; candidate: RTCIceCandidateInit };
      if (to !== currentUserId) return;
      const pc = screenPeerConnsRef.current.get(`sharer-${from}`)
             ?? screenPeerConnsRef.current.get(`viewer-${from}`);
      if (!pc) return;
      if (pc.remoteDescription) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      } else {
        const q = pendingIceCandidatesRef.current.get(from) ?? [];
        q.push(candidate);
        pendingIceCandidatesRef.current.set(from, q);
      }
    });

    // Screen stop
    channel.on('broadcast', { event: 'screen-stop' }, ({ payload }) => {
      const { userId } = payload as { userId: string };
      setScreenShares(prev => { const m = new Map(prev); m.delete(userId); return m; });
      setActiveShareId(prev => prev === userId ? null : prev);
      closeViewerPeerConn(userId);
    });
  }, [closeViewerPeerConn]);

  const cleanupPeerConnections = useCallback(() => {
    localScreenStreamRef.current?.getTracks().forEach(t => t.stop());
    localScreenStreamRef.current = null;
    screenPeerConnsRef.current.forEach(pc => pc.close());
    screenPeerConnsRef.current.clear();
    pendingIceCandidatesRef.current.clear();
  }, []);

  return {
    screenShares,
    activeShareId,
    setActiveShareId,
    isSharing,
    startScreenShare,
    stopScreenShare,
    registerScreenListeners,
    cleanupPeerConnections,
  };
}
