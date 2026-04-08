import { useCallback, useEffect, useRef, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { generateJaaSJwt } from '@/lib/jaasJwt';
import { PresenceEntry } from '@/types/room';

export interface JitsiHandle {
  jitsiRoom: string | null;
  jitsiConnected: boolean;
  setJitsiConnected: (v: boolean) => void;
  jitsiParticipantCount: number;
  setJitsiParticipantCount: (v: number | ((prev: number) => number)) => void;
  jitsiError: string | null;
  setJitsiError: (e: string | null) => void;
  jitsiRetryCount: number;
  setJitsiRetryCount: (fn: (c: number) => number) => void;
  remoteAudioLevel: number;
  setRemoteAudioLevel: (v: number | ((prev: number) => number)) => void;
  micMuted: boolean;
  micLevel: number;
  micError: string | null;
  handleMuteToggle: () => void;
  startMicRef: React.MutableRefObject<(() => Promise<void>) | null>;
  activeJitsiRoom: string | null;
  jaasJwt: string | null;
  jaasJwtError: string | null;
  jitsiRoomRef: React.MutableRefObject<string | null>;
  jitsiApiRef: React.MutableRefObject<any>;
  jitsiConnectionGenRef: React.MutableRefObject<number>;
  jitsiConnectTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  jitsiHeartbeatRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  jitsiMessageListenerRef: React.MutableRefObject<((evt: MessageEvent) => void) | null>;
  jitsiLeaveDebounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  remoteAudioDecayRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  micStreamRef: React.MutableRefObject<MediaStream | null>;
  /** Called by the presence hook when the set of nearby users changes. */
  handleProximityChange: (nearbyIds: Set<string>) => void;
  /** Clean up all Jitsi resources. */
  cleanupJitsi: () => void;
}

interface UseJitsiOptions {
  officeId: string;
  currentUser: { id: string; name: string | null; email?: string | null } | null;
  userEmail: string | undefined | null;
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  channelSubscribedRef: React.MutableRefObject<boolean>;
  myPresenceRef: React.MutableRefObject<PresenceEntry | null>;
}

export function useJitsi({
  officeId,
  currentUser,
  userEmail,
  channelRef,
  channelSubscribedRef,
  myPresenceRef,
}: UseJitsiOptions): JitsiHandle {
  // Jitsi state
  const [jitsiRoom, setJitsiRoom] = useState<string | null>(null);
  const [jitsiError, setJitsiError] = useState<string | null>(null);
  const [jitsiConnected, setJitsiConnected] = useState(false);
  const [jitsiParticipantCount, setJitsiParticipantCount] = useState(0);
  const [jitsiRetryCount, setJitsiRetryCount] = useState(0);
  const [jaasJwt, setJaasJwt] = useState<string | null>(null);
  const [jaasJwtError, setJaasJwtError] = useState<string | null>(null);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);
  const jitsiApiRef = useRef<any>(null);
  const remoteAudioDecayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jitsiConnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jitsiHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jitsiMessageListenerRef = useRef<((evt: MessageEvent) => void) | null>(null);
  const jitsiLeaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jitsiConnectionGenRef = useRef(0);
  const jitsiRoomRef = useRef<string | null>(null);

  // Mic state
  const [micMuted, setMicMuted] = useState(false);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [micError, setMicError] = useState<string | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const startMicRef = useRef<(() => Promise<void>) | null>(null);

  // Generate JaaS JWT
  useEffect(() => {
    const appId = import.meta.env.VITE_JAAS_APP_ID as string | undefined;
    const apiKeyId = import.meta.env.VITE_JAAS_API_KEY_ID as string | undefined;
    const privateKeyB64 = import.meta.env.VITE_JAAS_PRIVATE_KEY as string | undefined;
    const privateKey = privateKeyB64 ? atob(privateKeyB64) : undefined;

    if (!appId || !apiKeyId || !privateKey || !currentUser) {
      setJaasJwt(null);
      setJaasJwtError(null);
      return;
    }

    setJaasJwtError(null);
    generateJaaSJwt(appId, apiKeyId, privateKey, {
      id: currentUser.id,
      name: currentUser.name || 'User',
      email: userEmail ?? '',
    }).then(jwt => {
      setJaasJwt(jwt);
      setJaasJwtError(null);
    }).catch(err => {
      console.error('JaaS JWT generation failed:', err);
      setJaasJwt(null);
      setJaasJwtError(String(err?.message ?? err));
    });
  }, [currentUser?.id, currentUser?.name, userEmail]);

  // Continuously monitor the local microphone
  useEffect(() => {
    let animFrameId: number;

    const startMic = async () => {
      cancelAnimationFrame(animFrameId);
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
      await micAudioCtxRef.current?.close();
      micAudioCtxRef.current = null;

      setMicError(null);
      setMicLevel(0);

      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setMicLevel(-1);
        setMicError('HTTPS is required — microphone is unavailable on insecure origins');
        return;
      }

      let permState: PermissionState | 'unknown' = 'unknown';
      try {
        const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        permState = status.state;
      } catch { /* API not available on this browser */ }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err: any) {
        setMicLevel(-1);
        const name: string = err?.name ?? '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          if (permState === 'denied') {
            setMicError(
              'Blocked in browser settings. Tap the 🔒 icon in the address bar → Site settings → Microphone → Allow'
            );
          } else {
            setMicError(
              'Permission denied. Check: iOS Settings → ' +
              (navigator.userAgent.includes('CriOS') ? 'Chrome' : 'Safari') +
              ' → Microphone → ON. Then tap "Tap to enable" again.'
            );
          }
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setMicError('No microphone hardware found on this device');
        } else {
          setMicError(`${name || 'Error'}: ${err?.message ?? 'unknown'}`);
        }
        return;
      }

      micStreamRef.current = stream;

      const audioCtx = new AudioContext();
      micAudioCtxRef.current = audioCtx;
      try { await audioCtx.resume(); } catch { /* best-effort */ }

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (audioCtx.state === 'running') {
          analyser.getByteFrequencyData(buf);
          const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length) / 128;
          setMicLevel(rms);
        }
        animFrameId = requestAnimationFrame(tick);
      };
      tick();
    };

    startMicRef.current = startMic;
    startMic();

    return () => {
      cancelAnimationFrame(animFrameId);
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      micAudioCtxRef.current?.close();
    };
  }, []);

  const handleMuteToggle = useCallback(() => {
    setMicMuted(prev => {
      const newMuted = !prev;
      micStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
      jitsiApiRef.current?.executeCommand('toggleAudio');
      return newMuted;
    });
  }, []);

  // Clean up all Jitsi resources
  const cleanupJitsi = useCallback(() => {
    jitsiConnectionGenRef.current++;
    if (jitsiConnectTimeoutRef.current) {
      clearTimeout(jitsiConnectTimeoutRef.current);
      jitsiConnectTimeoutRef.current = null;
    }
    if (jitsiHeartbeatRef.current) {
      clearInterval(jitsiHeartbeatRef.current);
      jitsiHeartbeatRef.current = null;
    }
    if (jitsiMessageListenerRef.current) {
      window.removeEventListener('message', jitsiMessageListenerRef.current);
      jitsiMessageListenerRef.current = null;
    }
    if (remoteAudioDecayRef.current) {
      clearInterval(remoteAudioDecayRef.current);
      remoteAudioDecayRef.current = null;
    }
    if (jitsiApiRef.current) {
      try { jitsiApiRef.current.dispose(); } catch { /* already disposed */ }
      jitsiApiRef.current = null;
    }
  }, []);

  // Pre-warm room
  const jitsiPrewarmRoom = jaasJwt && currentUser
    ? `officexr-${officeId.slice(0, 8)}-${currentUser.id.slice(0, 8)}`
    : null;
  const activeJitsiRoom = jitsiRoom ?? jitsiPrewarmRoom;

  // Reset Jitsi state when the active room changes
  useEffect(() => {
    cleanupJitsi();
    const connectionGen = jitsiConnectionGenRef.current;

    if (!activeJitsiRoom || !jaasJwt) {
      setJitsiError(null);
      setJitsiConnected(false);
      setRemoteAudioLevel(0);
      return;
    }

    const isProximity = jitsiRoomRef.current !== null;
    console.log('[VoiceChat] Connecting — room:', activeJitsiRoom, isProximity ? '(proximity)' : '(prewarm)', 'jwt length:', jaasJwt?.length);
    setJitsiError(null);
    setJitsiConnected(false);
    if (isProximity) {
      jitsiConnectTimeoutRef.current = setTimeout(() => {
        if (jitsiConnectionGenRef.current !== connectionGen) return;
        console.error('[VoiceChat] Jitsi iframe never loaded after 30s. Room:', activeJitsiRoom);
        setJitsiError('Voice chat failed to load. Check your network connection.');
      }, 30000);
    }

    return () => {
      cleanupJitsi();
    };
  }, [activeJitsiRoom, jaasJwt, jitsiRetryCount, cleanupJitsi]);

  // Proximity-based room management
  const handleProximityChange = useCallback((nearbyIds: Set<string>) => {
    if (jitsiLeaveDebounceRef.current) {
      clearTimeout(jitsiLeaveDebounceRef.current);
      jitsiLeaveDebounceRef.current = null;
    }

    if (nearbyIds.size === 0) {
      if (jitsiRoomRef.current !== null) {
        jitsiLeaveDebounceRef.current = setTimeout(() => {
          jitsiLeaveDebounceRef.current = null;
          if (jitsiRoomRef.current === null) return;
          jitsiRoomRef.current = null;
          setJitsiRoom(null);
          if (myPresenceRef.current) {
            const updated = { ...myPresenceRef.current, jitsiRoom: null };
            myPresenceRef.current = updated;
            channelRef.current?.track(updated);
          }
        }, 1500);
      }
      return;
    }

    const seed = [currentUser!.id, ...nearbyIds].sort()[0];
    const roomToJoin = `officexr-${officeId.slice(0, 8)}-${seed.slice(0, 8)}`;
    if (roomToJoin !== jitsiRoomRef.current) {
      jitsiRoomRef.current = roomToJoin;
      setJitsiRoom(roomToJoin);
      if (myPresenceRef.current) {
        const updated = { ...myPresenceRef.current, jitsiRoom: roomToJoin };
        myPresenceRef.current = updated;
        channelRef.current?.track(updated);
      }
    }
  }, [currentUser?.id, officeId]);

  return {
    jitsiRoom,
    jitsiConnected,
    jitsiParticipantCount,
    jitsiError,
    setJitsiError,
    jitsiRetryCount,
    setJitsiRetryCount,
    remoteAudioLevel,
    micMuted,
    micLevel,
    micError,
    handleMuteToggle,
    startMicRef,
    activeJitsiRoom,
    jaasJwt,
    jaasJwtError,
    jitsiRoomRef,
    jitsiApiRef,
    jitsiConnectionGenRef,
    jitsiConnectTimeoutRef,
    jitsiHeartbeatRef,
    jitsiMessageListenerRef,
    jitsiLeaveDebounceRef,
    remoteAudioDecayRef,
    micStreamRef,
    setJitsiConnected,
    setJitsiParticipantCount,
    setRemoteAudioLevel,
    handleProximityChange,
    cleanupJitsi,
  };
}
