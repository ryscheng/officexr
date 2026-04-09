import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAvatarCustomization } from '@/hooks/useAvatarCustomization';
import { supabase } from '@/lib/supabase';
import { createAvatar } from '@/components/Avatar';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Helper: build the options bag with sensible defaults, overridable per-test
// ---------------------------------------------------------------------------
function renderUseAvatarCustomization(overrides: Record<string, any> = {}) {
  const defaults = {
    user: null as { id: string; name: string | null; email?: string | null; image?: string | null } | null,
    anonymousUserRef: { current: null },
    officeId: 'office-1',
    channelRef: { current: null } as React.MutableRefObject<any>,
    channelSubscribedRef: { current: false },
    myPresenceRef: { current: null } as React.MutableRefObject<any>,
    sceneRef: { current: null } as React.MutableRefObject<any>,
    localAvatarRef: { current: null } as React.MutableRefObject<any>,
    localAvatarAnimationRef: { current: null } as React.MutableRefObject<any>,
    localBubbleSphereRef: { current: null } as React.MutableRefObject<any>,
    cameraModeRef: { current: 'first-person' as const },
    jitsiRoomRef: { current: null } as React.MutableRefObject<string | null>,
  };

  const opts = { ...defaults, ...overrides };
  return renderHook(() => useAvatarCustomization(opts));
}

// ---------------------------------------------------------------------------
// Mock query-builder factory — creates a chainable mock matching setup.ts shape
// ---------------------------------------------------------------------------
function mockQueryBuilder(resolvedValue: { data: any; error: any }) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(resolvedValue),
    maybeSingle: vi.fn().mockResolvedValue(resolvedValue),
    upsert: vi.fn().mockResolvedValue(resolvedValue),
    update: vi.fn().mockReturnThis(),
    then: vi.fn((cb: Function) => Promise.resolve(resolvedValue).then(cb)),
  };
  return builder;
}

// ---------------------------------------------------------------------------
describe('useAvatarCustomization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  describe('initial state', () => {
    it('starts with default avatarCustomization (blue body, default style)', () => {
      const { result } = renderUseAvatarCustomization();
      expect(result.current.avatarCustomization).toEqual({
        bodyColor: '#3498db',
        skinColor: '#ffdbac',
        style: 'default',
        accessories: [],
      });
    });

    it('starts with currentUserRole = undefined', () => {
      const { result } = renderUseAvatarCustomization();
      expect(result.current.currentUserRole).toBeUndefined();
    });

    it('starts with showSettings = false', () => {
      const { result } = renderUseAvatarCustomization();
      expect(result.current.showSettings).toBe(false);
    });
  });

  // =========================================================================
  describe('loading on mount', () => {
    it('does not query Supabase when user is null', () => {
      renderUseAvatarCustomization({ user: null });
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('queries profiles table for avatar data on mount (global context)', () => {
      const profilesBuilder = mockQueryBuilder({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue(profilesBuilder);

      renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        officeId: 'global',
      });

      expect(supabase.from).toHaveBeenCalledWith('profiles');
      expect(profilesBuilder.select).toHaveBeenCalledWith(
        'avatar_body_color, avatar_skin_color, avatar_style, avatar_accessories, avatar_preset_id, avatar_model_url',
      );
      expect(profilesBuilder.eq).toHaveBeenCalledWith('id', 'user-1');
    });

    it('sets avatarCustomization from loaded profile data', async () => {
      const profileData = {
        avatar_body_color: '#e63232',
        avatar_skin_color: '#f1c27d',
        avatar_style: 'athletic',
        avatar_accessories: ['hat'],
        avatar_preset_id: 'mario',
        avatar_model_url: 'https://example.com/model.glb',
      };

      const profilesBuilder = mockQueryBuilder({ data: profileData, error: null });
      const membersBuilder = mockQueryBuilder({ data: null, error: null });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'profiles') return profilesBuilder;
        return membersBuilder;
      });

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
      });

      await waitFor(() => {
        expect(result.current.avatarCustomization).toEqual({
          bodyColor: '#e63232',
          skinColor: '#f1c27d',
          style: 'athletic',
          accessories: ['hat'],
          presetId: 'mario',
          modelUrl: 'https://example.com/model.glb',
        });
      });
    });

    it('queries office_members for user role when officeId is not "global"', () => {
      const profilesBuilder = mockQueryBuilder({ data: null, error: null });
      const membersBuilder = mockQueryBuilder({ data: null, error: null });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'profiles') return profilesBuilder;
        return membersBuilder;
      });

      renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        officeId: 'office-42',
      });

      expect(supabase.from).toHaveBeenCalledWith('office_members');
      expect(membersBuilder.select).toHaveBeenCalledWith(
        'role, avatar_body_color, avatar_skin_color, avatar_style, avatar_accessories, avatar_preset_id, avatar_model_url',
      );
      expect(membersBuilder.eq).toHaveBeenCalledWith('office_id', 'office-42');
      expect(membersBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1');
    });

    it('skips role query when officeId is "global"', () => {
      const profilesBuilder = mockQueryBuilder({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue(profilesBuilder);

      renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        officeId: 'global',
      });

      // Should only have called from('profiles'), never from('office_members')
      const calls = vi.mocked(supabase.from).mock.calls.map((c) => c[0]);
      expect(calls).toContain('profiles');
      expect(calls).not.toContain('office_members');
    });

    it('sets currentUserRole from loaded data', async () => {
      const profilesBuilder = mockQueryBuilder({ data: null, error: null });
      const membersBuilder = mockQueryBuilder({ data: { role: 'admin' }, error: null });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'profiles') return profilesBuilder;
        return membersBuilder;
      });

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        officeId: 'office-42',
      });

      await waitFor(() => {
        expect(result.current.currentUserRole).toBe('admin');
      });
    });

    it('falls back to defaults when profile data fields are null', async () => {
      const profileData = {
        avatar_body_color: null,
        avatar_skin_color: null,
        avatar_style: null,
        avatar_accessories: null,
        avatar_preset_id: null,
        avatar_model_url: null,
      };

      const profilesBuilder = mockQueryBuilder({ data: profileData, error: null });
      const membersBuilder = mockQueryBuilder({ data: null, error: null });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'profiles') return profilesBuilder;
        return membersBuilder;
      });

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
      });

      await waitFor(() => {
        // When fields are null, the hook falls back to default values
        expect(result.current.avatarCustomization).toEqual({
          bodyColor: '#3498db',
          skinColor: '#ffdbac',
          style: 'default',
          accessories: [],
          presetId: null,
          modelUrl: null,
        });
      });
    });
  });

  // =========================================================================
  describe('presence tracking on customization change', () => {
    it('updates avatarCustomizationRef when avatarCustomization changes', async () => {
      const profilesBuilder = mockQueryBuilder({ data: null, error: null });
      const upsertBuilder = mockQueryBuilder({ data: null, error: null });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'profiles') {
          // Return upsertBuilder when upsert is called, profilesBuilder for reads
          const combined = mockQueryBuilder({ data: null, error: null });
          combined.upsert = upsertBuilder.upsert;
          return combined;
        }
        return mockQueryBuilder({ data: null, error: null });
      });

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
      });

      const newSettings = {
        bodyColor: '#e63232',
        skinColor: '#f1c27d',
        style: 'athletic' as const,
        accessories: [],
      };

      await act(async () => {
        await result.current.handleSaveSettings(newSettings);
      });

      expect(result.current.avatarCustomizationRef.current).toEqual(newSettings);
    });

    it('re-tracks presence with new customization when channel and presence exist', async () => {
      const mockChannel = {
        track: vi.fn().mockResolvedValue('ok'),
        send: vi.fn().mockResolvedValue('ok'),
      };
      const myPresenceRef = {
        current: { id: 'user-1', name: 'Alice', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      };
      const channelRef = { current: mockChannel };

      const upsertBuilder = mockQueryBuilder({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue(upsertBuilder);

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        channelRef,
        channelSubscribedRef: { current: true },
        myPresenceRef,
      });

      const newSettings = {
        bodyColor: '#e63232',
        skinColor: '#f1c27d',
        style: 'athletic' as const,
        accessories: [],
      };

      await act(async () => {
        await result.current.handleSaveSettings(newSettings);
      });

      expect(mockChannel.track).toHaveBeenCalledWith(
        expect.objectContaining({ customization: newSettings }),
      );
    });

    it('does not re-track when channel is null', async () => {
      const myPresenceRef = {
        current: { id: 'user-1', name: 'Alice', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      };
      const channelRef = { current: null };

      const upsertBuilder = mockQueryBuilder({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue(upsertBuilder);

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        channelRef,
        myPresenceRef,
      });

      const newSettings = {
        bodyColor: '#e63232',
        skinColor: '#f1c27d',
        style: 'athletic' as const,
        accessories: [],
      };

      await act(async () => {
        await result.current.handleSaveSettings(newSettings);
      });

      // No channel to track on — this should not throw
      // We just verify no error was thrown and the state updated
      expect(result.current.avatarCustomization).toEqual(newSettings);
    });

    it('does not re-track when myPresenceRef is null', async () => {
      const mockChannel = {
        track: vi.fn().mockResolvedValue('ok'),
        send: vi.fn().mockResolvedValue('ok'),
      };
      const channelRef = { current: mockChannel };
      const myPresenceRef = { current: null };

      const upsertBuilder = mockQueryBuilder({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue(upsertBuilder);

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        channelRef,
        myPresenceRef,
      });

      await act(async () => {
        await result.current.handleSaveSettings({
          bodyColor: '#e63232',
          skinColor: '#f1c27d',
          style: 'athletic' as const,
          accessories: [],
        });
      });

      // channel.track should not be called because presence is null
      expect(mockChannel.track).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  describe('handleSaveSettings()', () => {
    it('no-ops when user is null', async () => {
      const { result } = renderUseAvatarCustomization({ user: null });

      await act(async () => {
        await result.current.handleSaveSettings({
          bodyColor: '#e63232',
          skinColor: '#f1c27d',
          style: 'athletic',
          accessories: [],
        });
      });

      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('upserts to profiles table with correct mapped fields (global context)', async () => {
      const upsertBuilder = mockQueryBuilder({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue(upsertBuilder);

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        officeId: 'global',
      });

      const settings = {
        bodyColor: '#e63232',
        skinColor: '#f1c27d',
        style: 'athletic' as const,
        accessories: ['hat', 'glasses'],
        presetId: 'mario',
        modelUrl: 'https://example.com/model.glb',
      };

      await act(async () => {
        await result.current.handleSaveSettings(settings);
      });

      expect(upsertBuilder.upsert).toHaveBeenCalledWith({
        id: 'user-1',
        avatar_body_color: '#e63232',
        avatar_skin_color: '#f1c27d',
        avatar_style: 'athletic',
        avatar_accessories: ['hat', 'glasses'],
        avatar_preset_id: 'mario',
        avatar_model_url: 'https://example.com/model.glb',
      });
    });

    it('throws on Supabase error', async () => {
      const upsertBuilder = mockQueryBuilder({ data: null, error: { message: 'db error' } });
      vi.mocked(supabase.from).mockReturnValue(upsertBuilder);

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
      });

      await expect(
        act(async () => {
          await result.current.handleSaveSettings({
            bodyColor: '#e63232',
            skinColor: '#f1c27d',
            style: 'athletic',
            accessories: [],
          });
        }),
      ).rejects.toThrow('Failed to save settings');
    });

    it('updates local avatarCustomization state', async () => {
      const upsertBuilder = mockQueryBuilder({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue(upsertBuilder);

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
      });

      const newSettings = {
        bodyColor: '#e63232',
        skinColor: '#f1c27d',
        style: 'athletic' as const,
        accessories: ['hat'],
      };

      await act(async () => {
        await result.current.handleSaveSettings(newSettings);
      });

      expect(result.current.avatarCustomization).toEqual(newSettings);
    });

    it('removes old avatar from scene and creates new one', async () => {
      const upsertBuilder = mockQueryBuilder({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue(upsertBuilder);

      const mockScene = { add: vi.fn(), remove: vi.fn() };
      const oldAvatar = {
        position: { x: 0, y: 0, z: 0 },
        visible: true,
        userData: {
          id: 'user-1',
          name: 'Alice',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        },
      };
      const mockMixer = { update: vi.fn(), stopAllAction: vi.fn() };
      const localAvatarAnimationRef = {
        current: { mixer: mockMixer, actions: new Map(), activeAction: null },
      };

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        sceneRef: { current: mockScene },
        localAvatarRef: { current: oldAvatar },
        localAvatarAnimationRef,
        cameraModeRef: { current: 'third-person-behind' as const },
      });

      const newSettings = {
        bodyColor: '#e63232',
        skinColor: '#f1c27d',
        style: 'athletic' as const,
        accessories: [],
      };

      await act(async () => {
        await result.current.handleSaveSettings(newSettings);
      });

      // Old avatar removed from scene
      expect(mockScene.remove).toHaveBeenCalledWith(oldAvatar);
      // Old mixer stopped
      expect(mockMixer.stopAllAction).toHaveBeenCalled();
      // Animation ref cleared then re-populated by createAvatar callback
      // createAvatar called with scene, updated data, and callback
      expect(createAvatar).toHaveBeenCalledWith(
        mockScene,
        expect.objectContaining({ customization: newSettings }),
        expect.any(Function),
      );
    });

    it('broadcasts avatar-update event', async () => {
      const mockChannel = {
        track: vi.fn().mockResolvedValue('ok'),
        send: vi.fn().mockResolvedValue('ok'),
      };
      const channelRef = { current: mockChannel };
      const channelSubscribedRef = { current: true };

      const upsertBuilder = mockQueryBuilder({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue(upsertBuilder);

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        channelRef,
        channelSubscribedRef,
      });

      const newSettings = {
        bodyColor: '#e63232',
        skinColor: '#f1c27d',
        style: 'athletic' as const,
        accessories: [],
      };

      await act(async () => {
        await result.current.handleSaveSettings(newSettings);
      });

      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'avatar-update',
        payload: { userId: 'user-1', customization: newSettings },
      });
    });

    it('does not broadcast when channel is not subscribed', async () => {
      const mockChannel = {
        track: vi.fn().mockResolvedValue('ok'),
        send: vi.fn().mockResolvedValue('ok'),
      };
      const channelRef = { current: mockChannel };
      const channelSubscribedRef = { current: false };

      const upsertBuilder = mockQueryBuilder({ data: null, error: null });
      vi.mocked(supabase.from).mockReturnValue(upsertBuilder);

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        channelRef,
        channelSubscribedRef,
      });

      await act(async () => {
        await result.current.handleSaveSettings({
          bodyColor: '#e63232',
          skinColor: '#f1c27d',
          style: 'athletic' as const,
          accessories: [],
        });
      });

      expect(mockChannel.send).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  describe('handleBubblePrefsChange()', () => {
    it('updates bubblePrefsRef', () => {
      const { result } = renderUseAvatarCustomization();

      const newPrefs = { radius: 5, idleColor: '#ff0000' };

      act(() => {
        result.current.handleBubblePrefsChange(newPrefs);
      });

      expect(result.current.bubblePrefsRef.current).toEqual(newPrefs);
    });

    it('rebuilds local bubble sphere geometry with new radius', () => {
      // Override SphereGeometry with a regular function so `new` works in vitest 4
      const sphereGeoMock = vi.mocked(THREE.SphereGeometry);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      sphereGeoMock.mockImplementation(function (this: any) {
        return { dispose: vi.fn() } as any;
      });

      const mockGeometry = { dispose: vi.fn() };
      const mockMaterial = {
        color: { setHex: vi.fn(), getHex: vi.fn(() => 0), set: vi.fn() },
        transparent: false,
        opacity: 1,
      };
      const localBubbleSphereRef = {
        current: {
          geometry: mockGeometry,
          material: mockMaterial,
        },
      };

      const { result } = renderUseAvatarCustomization({
        localBubbleSphereRef,
        jitsiRoomRef: { current: null },
      });

      const newPrefs = { radius: 6, idleColor: '#ff0000' };

      act(() => {
        result.current.handleBubblePrefsChange(newPrefs);
      });

      // Old geometry should be disposed
      expect(mockGeometry.dispose).toHaveBeenCalled();
      // New SphereGeometry should be created with new radius
      expect(THREE.SphereGeometry).toHaveBeenCalledWith(6, 24, 24);
      // Material color should be updated (since jitsiRoom is null)
      expect(mockMaterial.color.setHex).toHaveBeenCalledWith(0xff0000);
    });

    it('broadcasts bubble-prefs event', () => {
      const mockChannel = {
        track: vi.fn().mockResolvedValue('ok'),
        send: vi.fn().mockResolvedValue('ok'),
      };

      const { result } = renderUseAvatarCustomization({
        user: { id: 'user-1', name: 'Alice' },
        channelRef: { current: mockChannel },
        channelSubscribedRef: { current: true },
      });

      const newPrefs = { radius: 5, idleColor: '#ff0000' };

      act(() => {
        result.current.handleBubblePrefsChange(newPrefs);
      });

      expect(mockChannel.send).toHaveBeenCalledWith({
        type: 'broadcast',
        event: 'bubble-prefs',
        payload: { userId: 'user-1', prefs: newPrefs },
      });
    });
  });
});
