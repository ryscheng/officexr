import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChat } from '@/hooks/useChat';
import { MutableRefObject } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function createMockChannel(overrides: Partial<RealtimeChannel> = {}) {
  return {
    on: vi.fn().mockReturnThis(),
    send: vi.fn().mockResolvedValue('ok'),
    subscribe: vi.fn().mockReturnThis(),
    ...overrides,
  } as unknown as RealtimeChannel;
}

interface RenderOverrides {
  channelRef?: MutableRefObject<RealtimeChannel | null>;
  channelSubscribedRef?: MutableRefObject<boolean>;
  currentUser?: { id: string; name: string | null } | null;
  currentUserRef?: MutableRefObject<{ id: string; name: string | null } | null>;
  showSettings?: boolean;
  keysRef?: MutableRefObject<{ [key: string]: boolean }>;
}

function renderUseChat(overrides: RenderOverrides = {}) {
  const defaultUser = { id: 'user-1', name: 'Alice' };
  const props = {
    channelRef: overrides.channelRef ?? { current: createMockChannel() },
    channelSubscribedRef: overrides.channelSubscribedRef ?? { current: true },
    currentUser: overrides.currentUser !== undefined ? overrides.currentUser : defaultUser,
    currentUserRef: overrides.currentUserRef ?? { current: defaultUser },
    showSettings: overrides.showSettings ?? false,
    keysRef: overrides.keysRef ?? { current: {} },
  };
  return { ...renderHook(() => useChat(props)), props };
}

function pressKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Initial state ────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts with chatVisible = false', () => {
      const { result } = renderUseChat();
      expect(result.current.chatVisible).toBe(false);
    });

    it('starts with chatMessages = []', () => {
      const { result } = renderUseChat();
      expect(result.current.chatMessages).toEqual([]);
    });

    it('starts with chatInput = ""', () => {
      const { result } = renderUseChat();
      expect(result.current.chatInput).toBe('');
    });
  });

  // ── Visibility state machine - keyboard ──────────────────────────────────

  describe('visibility state machine - keyboard', () => {
    it('Enter key when hidden → sets chatVisible = true', () => {
      const { result } = renderUseChat();
      expect(result.current.chatVisible).toBe(false);

      pressKey('Enter');
      expect(result.current.chatVisible).toBe(true);
    });

    it('Enter key when visible and input empty → sets chatVisible = false', () => {
      const { result } = renderUseChat();

      // Open chat
      pressKey('Enter');
      expect(result.current.chatVisible).toBe(true);

      // Close chat (input is still empty)
      pressKey('Enter');
      expect(result.current.chatVisible).toBe(false);
    });

    it('Escape key when visible → hides chat and clears input', () => {
      const { result } = renderUseChat();

      // Open chat
      pressKey('Enter');
      expect(result.current.chatVisible).toBe(true);

      // Type something
      act(() => {
        result.current.setChatInput('hello');
      });
      expect(result.current.chatInput).toBe('hello');

      // Escape should hide and clear
      pressKey('Escape');
      expect(result.current.chatVisible).toBe(false);
      expect(result.current.chatInput).toBe('');
    });

    it('Enter key when visible and input non-empty → sends message, clears input, stays visible', () => {
      const mockChannel = createMockChannel();
      const channelRef = { current: mockChannel };
      const { result } = renderUseChat({ channelRef });

      // Open chat
      pressKey('Enter');
      expect(result.current.chatVisible).toBe(true);

      // Type a message
      act(() => {
        result.current.setChatInput('hello world');
      });

      // Press Enter to send
      pressKey('Enter');

      // Should stay visible, input cleared, message sent
      expect(result.current.chatVisible).toBe(true);
      expect(result.current.chatInput).toBe('');
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'broadcast',
          event: 'chat',
          payload: expect.objectContaining({
            message: expect.objectContaining({ message: 'hello world' }),
          }),
        }),
      );
    });

    it('ignores Enter key when showSettings is true', () => {
      const { result } = renderUseChat({ showSettings: true });

      pressKey('Enter');
      expect(result.current.chatVisible).toBe(false);
    });

    it('ignores Enter key when event.target is chatInputRef', () => {
      const { result } = renderUseChat();

      // Open chat first so we can test that Enter on the input element is ignored
      pressKey('Enter');
      expect(result.current.chatVisible).toBe(true);

      // Simulate Enter from the chatInputRef element itself
      const inputEl = result.current.chatInputRef.current ?? document.createElement('input');
      // Assign the ref if it's not already set
      (result.current.chatInputRef as MutableRefObject<HTMLInputElement>).current = inputEl;

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
        });
        Object.defineProperty(event, 'target', { value: inputEl, writable: false });
        window.dispatchEvent(event);
      });

      // Chat should remain visible (keydown handler returned early)
      expect(result.current.chatVisible).toBe(true);
    });
  });

  // ── Auto-hide timer ──────────────────────────────────────────────────────

  describe('auto-hide timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('starts 10s timer when chat becomes visible with empty input', () => {
      const { result } = renderUseChat();

      pressKey('Enter');
      expect(result.current.chatVisible).toBe(true);

      // Timer should be pending; advance less than 10s
      act(() => {
        vi.advanceTimersByTime(9999);
      });
      expect(result.current.chatVisible).toBe(true);
    });

    it('hides chat when 10s timer fires', () => {
      const { result } = renderUseChat();

      pressKey('Enter');
      expect(result.current.chatVisible).toBe(true);

      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(result.current.chatVisible).toBe(false);
    });

    it('clears timer when chatInput changes to non-empty', () => {
      const { result } = renderUseChat();

      pressKey('Enter');
      expect(result.current.chatVisible).toBe(true);

      // Advance part of the timer
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      // Type something (non-empty input should clear the timer)
      act(() => {
        result.current.setChatInput('typing...');
      });

      // Advance well past 10s total
      act(() => {
        vi.advanceTimersByTime(20000);
      });

      // Chat should still be visible because the input is non-empty
      expect(result.current.chatVisible).toBe(true);
    });
  });

  // ── Key suppression ──────────────────────────────────────────────────────

  describe('key suppression', () => {
    it('clears WASD and arrow keys in keysRef when chat becomes visible', () => {
      const keysRef = {
        current: {
          w: true,
          a: true,
          s: true,
          d: true,
          arrowup: true,
          arrowdown: true,
          arrowleft: true,
          arrowright: true,
        },
      };
      const { result } = renderUseChat({ keysRef });

      pressKey('Enter');
      expect(result.current.chatVisible).toBe(true);

      expect(keysRef.current.w).toBe(false);
      expect(keysRef.current.a).toBe(false);
      expect(keysRef.current.s).toBe(false);
      expect(keysRef.current.d).toBe(false);
      expect(keysRef.current.arrowup).toBe(false);
      expect(keysRef.current.arrowdown).toBe(false);
      expect(keysRef.current.arrowleft).toBe(false);
      expect(keysRef.current.arrowright).toBe(false);
    });
  });

  // ── sendChatMessage() ────────────────────────────────────────────────────

  describe('sendChatMessage()', () => {
    it('adds message locally but skips broadcast when channel is null', () => {
      const channelRef = { current: null };
      const { result } = renderUseChat({ channelRef });

      act(() => {
        result.current.sendChatMessage('hello');
      });

      // Optimistic local display — message appears even without a channel
      expect(result.current.chatMessages).toHaveLength(1);
      expect(result.current.chatMessages[0].message).toBe('hello');
    });

    it('adds message locally but skips broadcast when channelSubscribedRef is false', () => {
      const channelSubscribedRef = { current: false };
      const mockChannel = createMockChannel();
      const channelRef = { current: mockChannel };
      const { result } = renderUseChat({ channelRef, channelSubscribedRef });

      act(() => {
        result.current.sendChatMessage('hello');
      });

      expect(result.current.chatMessages).toHaveLength(1);
      expect(result.current.chatMessages[0].message).toBe('hello');
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('no-ops entirely when currentUserRef is null', () => {
      const mockChannel = createMockChannel();
      const channelRef = { current: mockChannel };
      const { result } = renderUseChat({
        channelRef,
        currentUser: null,
        currentUserRef: { current: null },
      });

      act(() => {
        result.current.sendChatMessage('hello');
      });

      expect(result.current.chatMessages).toEqual([]);
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('broadcasts message with correct event and payload', () => {
      const mockChannel = createMockChannel();
      const channelRef = { current: mockChannel };
      const currentUser = { id: 'user-42', name: 'Bob' };
      const { result } = renderUseChat({
        channelRef,
        currentUser,
        currentUserRef: { current: currentUser },
      });

      act(() => {
        result.current.sendChatMessage('hey there');
      });

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
      const callArgs = (mockChannel.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.type).toBe('broadcast');
      expect(callArgs.event).toBe('chat');
      expect(callArgs.payload.message).toMatchObject({
        userId: 'user-42',
        userName: 'Bob',
        message: 'hey there',
      });
      expect(callArgs.payload.message.id).toBeDefined();
      expect(callArgs.payload.message.timestamp).toBeDefined();
    });

    it('appends own message to local chatMessages immediately', () => {
      const mockChannel = createMockChannel();
      const channelRef = { current: mockChannel };
      const { result } = renderUseChat({ channelRef });

      act(() => {
        result.current.sendChatMessage('message one');
      });

      expect(result.current.chatMessages).toHaveLength(1);
      expect(result.current.chatMessages[0].message).toBe('message one');

      act(() => {
        result.current.sendChatMessage('message two');
      });

      expect(result.current.chatMessages).toHaveLength(2);
      expect(result.current.chatMessages[1].message).toBe('message two');
    });

    it('caps messages at 50 (slices oldest)', () => {
      const mockChannel = createMockChannel();
      const channelRef = { current: mockChannel };
      const { result } = renderUseChat({ channelRef });

      // Send 51 messages
      for (let i = 0; i < 51; i++) {
        act(() => {
          result.current.sendChatMessage(`msg-${i}`);
        });
      }

      expect(result.current.chatMessages).toHaveLength(50);
      // The first message (msg-0) should have been sliced off
      expect(result.current.chatMessages[0].message).toBe('msg-1');
      expect(result.current.chatMessages[49].message).toBe('msg-50');
    });
  });

  // ── registerChatListener() ───────────────────────────────────────────────

  describe('registerChatListener()', () => {
    it('registers broadcast listener for "chat" event on channel', () => {
      const mockChannel = createMockChannel();
      const { result } = renderUseChat();

      act(() => {
        result.current.registerChatListener(mockChannel);
      });

      expect(mockChannel.on).toHaveBeenCalledWith(
        'broadcast',
        { event: 'chat' },
        expect.any(Function),
      );
    });

    it('appends incoming message from other user', () => {
      const mockChannel = createMockChannel();
      let capturedCallback: (args: { payload: any }) => void = () => {};
      (mockChannel.on as ReturnType<typeof vi.fn>).mockImplementation(
        (_type: string, _filter: any, callback: any) => {
          capturedCallback = callback;
          return mockChannel;
        },
      );

      const currentUserRef = { current: { id: 'user-1', name: 'Alice' } };
      const { result } = renderUseChat({ currentUserRef });

      act(() => {
        result.current.registerChatListener(mockChannel);
      });

      const incomingMessage = {
        id: 'msg-remote-1',
        userId: 'user-99',
        userName: 'Charlie',
        message: 'hello from Charlie',
        timestamp: Date.now(),
      };

      act(() => {
        capturedCallback({ payload: { message: incomingMessage } });
      });

      expect(result.current.chatMessages).toHaveLength(1);
      expect(result.current.chatMessages[0]).toEqual(incomingMessage);
    });

    it('ignores incoming message from self (by userId)', () => {
      const mockChannel = createMockChannel();
      let capturedCallback: (args: { payload: any }) => void = () => {};
      (mockChannel.on as ReturnType<typeof vi.fn>).mockImplementation(
        (_type: string, _filter: any, callback: any) => {
          capturedCallback = callback;
          return mockChannel;
        },
      );

      const currentUserRef = { current: { id: 'user-1', name: 'Alice' } };
      const { result } = renderUseChat({ currentUserRef });

      act(() => {
        result.current.registerChatListener(mockChannel);
      });

      const selfMessage = {
        id: 'msg-self-1',
        userId: 'user-1',
        userName: 'Alice',
        message: 'my own message',
        timestamp: Date.now(),
      };

      act(() => {
        capturedCallback({ payload: { message: selfMessage } });
      });

      expect(result.current.chatMessages).toHaveLength(0);
    });

    it('caps messages at 50 when receiving', () => {
      const mockChannel = createMockChannel();
      let capturedCallback: (args: { payload: any }) => void = () => {};
      (mockChannel.on as ReturnType<typeof vi.fn>).mockImplementation(
        (_type: string, _filter: any, callback: any) => {
          capturedCallback = callback;
          return mockChannel;
        },
      );

      const currentUserRef = { current: { id: 'user-1', name: 'Alice' } };
      const { result } = renderUseChat({ currentUserRef });

      act(() => {
        result.current.registerChatListener(mockChannel);
      });

      // Fire 51 incoming messages from other users
      for (let i = 0; i < 51; i++) {
        act(() => {
          capturedCallback({
            payload: {
              message: {
                id: `msg-${i}`,
                userId: `other-user-${i}`,
                userName: `User ${i}`,
                message: `incoming-${i}`,
                timestamp: Date.now() + i,
              },
            },
          });
        });
      }

      expect(result.current.chatMessages).toHaveLength(50);
      // The first message (incoming-0) should have been sliced off
      expect(result.current.chatMessages[0].message).toBe('incoming-1');
      expect(result.current.chatMessages[49].message).toBe('incoming-50');
    });
  });
});
