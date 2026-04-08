import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RealtimeChannel } from '@supabase/supabase-js';
import { AvatarCustomization, BubblePreferences, loadBubblePrefs } from '@/types/avatar';
import { CameraMode, PresenceEntry } from '@/types/room';
import { createAvatar, AvatarData, AvatarAnimationState } from '@/components/Avatar';
import { supabase } from '@/lib/supabase';

function hexStringToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

export interface AvatarCustomizationHandle {
  avatarCustomization: AvatarCustomization;
  avatarCustomizationRef: React.MutableRefObject<AvatarCustomization>;
  currentUserRole: 'owner' | 'admin' | 'member' | undefined;
  handleSaveSettings: (settings: AvatarCustomization) => Promise<void>;
  handleBubblePrefsChange: (prefs: BubblePreferences) => void;
  bubblePrefsRef: React.MutableRefObject<BubblePreferences>;
  showSettings: boolean;
  setShowSettings: (v: boolean | ((prev: boolean) => boolean)) => void;
}

interface UseAvatarCustomizationOptions {
  user: { id: string; name: string | null; email?: string | null; image?: string | null } | null;
  anonymousUserRef: React.MutableRefObject<{ id: string; name: string } | null>;
  officeId: string;
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  channelSubscribedRef: React.MutableRefObject<boolean>;
  myPresenceRef: React.MutableRefObject<PresenceEntry | null>;
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  localAvatarRef: React.MutableRefObject<THREE.Group | null>;
  localAvatarAnimationRef: React.MutableRefObject<AvatarAnimationState | null>;
  localBubbleSphereRef: React.MutableRefObject<THREE.Mesh | null>;
  cameraModeRef: React.MutableRefObject<CameraMode>;
  jitsiRoomRef: React.MutableRefObject<string | null>;
}

export function useAvatarCustomization({
  user,
  anonymousUserRef,
  officeId,
  channelRef,
  channelSubscribedRef,
  myPresenceRef,
  sceneRef,
  localAvatarRef,
  localAvatarAnimationRef,
  localBubbleSphereRef,
  cameraModeRef,
  jitsiRoomRef,
}: UseAvatarCustomizationOptions): AvatarCustomizationHandle {
  const [showSettings, setShowSettings] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<'owner' | 'admin' | 'member' | undefined>(undefined);
  const [avatarCustomization, setAvatarCustomization] = useState<AvatarCustomization>({
    bodyColor: '#3498db',
    skinColor: '#ffdbac',
    style: 'default',
    accessories: [],
  });
  const avatarCustomizationRef = useRef(avatarCustomization);
  const bubblePrefsRef = useRef<BubblePreferences>(loadBubblePrefs());

  // Load avatar customization from Supabase
  useEffect(() => {
    if (!user) return;

    supabase
      .from('profiles')
      .select('avatar_body_color, avatar_skin_color, avatar_style, avatar_accessories, avatar_preset_id, avatar_model_url')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setAvatarCustomization({
            bodyColor: data.avatar_body_color || '#3498db',
            skinColor: data.avatar_skin_color || '#ffdbac',
            style: (data.avatar_style as AvatarCustomization['style']) || 'default',
            accessories: data.avatar_accessories || [],
            presetId: data.avatar_preset_id || null,
            modelUrl: data.avatar_model_url || null,
          });
        }
      });

    // Fetch this user's role in the current office
    if (officeId && officeId !== 'global') {
      supabase
        .from('office_members')
        .select('role')
        .eq('office_id', officeId)
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setCurrentUserRole(data.role as 'owner' | 'admin' | 'member');
        });
    }
  }, [user, officeId]);

  // Keep the ref in sync and re-track presence whenever customization changes
  useEffect(() => {
    avatarCustomizationRef.current = avatarCustomization;
    const channel = channelRef.current;
    if (!channel || !myPresenceRef.current) return;
    const updated = { ...myPresenceRef.current, customization: avatarCustomization };
    myPresenceRef.current = updated;
    channel.track(updated);
  }, [avatarCustomization]);

  const handleBubblePrefsChange = useCallback((prefs: BubblePreferences) => {
    bubblePrefsRef.current = prefs;
    const newRadius = prefs.radius;
    const newColor = hexStringToInt(prefs.idleColor);
    // Only rebuild the local bubble sphere — remote spheres use their own prefs
    if (localBubbleSphereRef.current) {
      localBubbleSphereRef.current.geometry.dispose();
      localBubbleSphereRef.current.geometry = new THREE.SphereGeometry(newRadius, 24, 24);
      if (!jitsiRoomRef.current) {
        (localBubbleSphereRef.current.material as THREE.MeshStandardMaterial).color.setHex(newColor);
      }
    }
    // Broadcast our bubble prefs to other users
    if (channelRef.current && channelSubscribedRef.current) {
      channelRef.current.send({
        type: 'broadcast', event: 'bubble-prefs',
        payload: { userId: user?.id ?? anonymousUserRef.current?.id, prefs },
      });
    }
  }, [user?.id]);

  const handleSaveSettings = useCallback(async (settings: AvatarCustomization) => {
    if (!user) return;

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      avatar_body_color: settings.bodyColor,
      avatar_skin_color: settings.skinColor,
      avatar_style: settings.style,
      avatar_accessories: settings.accessories,
      avatar_preset_id: settings.presetId ?? null,
      avatar_model_url: settings.modelUrl ?? null,
    });

    if (error) throw new Error('Failed to save settings');

    setAvatarCustomization(settings);

    // Update local avatar (for third-person view)
    if (localAvatarRef.current && sceneRef.current) {
      if (localAvatarAnimationRef.current) {
        localAvatarAnimationRef.current.mixer.stopAllAction();
        localAvatarAnimationRef.current = null;
      }
      const oldData = localAvatarRef.current.userData as AvatarData;
      sceneRef.current.remove(localAvatarRef.current);
      const newLocalAvatar = createAvatar(sceneRef.current, { ...oldData, customization: settings }, (animState) => {
        localAvatarAnimationRef.current = animState;
      });
      newLocalAvatar.visible = cameraModeRef.current !== 'first-person';
      localAvatarRef.current = newLocalAvatar;
    }

    // Broadcast avatar update to other users
    if (channelRef.current && channelSubscribedRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'avatar-update',
        payload: { userId: user.id, customization: settings },
      }).then((result: string) => {
        if (result !== 'ok') console.error('[AvatarUpdate] Broadcast failed:', result);
      });
    }
  }, [user?.id]);

  return {
    avatarCustomization,
    avatarCustomizationRef,
    currentUserRole,
    handleSaveSettings,
    handleBubblePrefsChange,
    bubblePrefsRef,
    showSettings,
    setShowSettings,
  };
}
