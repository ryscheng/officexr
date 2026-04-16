import { useCallback, useEffect, useRef, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { ChatMessage } from '@/types/room';

export interface ChatHandle {
  chatMessages: ChatMessage[];
  chatVisible: boolean;
  setChatVisible: (v: boolean) => void;
  chatInput: string;
  setChatInput: (v: string) => void;
  chatInputRef: React.MutableRefObject<HTMLInputElement | null>;
  chatScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  chatVisibleRef: React.MutableRefObject<boolean>;
  sendChatMessage: (message: string) => void;
  onChatInputFocus: () => void;
  onChatInputBlur: () => void;
  /** Register the chat broadcast listener on a channel. Call inside the main scene useEffect. */
  registerChatListener: (channel: RealtimeChannel) => void;
}

interface UseChatOptions {
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  channelSubscribedRef: React.MutableRefObject<boolean>;
  currentUser: { id: string; name: string | null } | null;
  currentUserRef: React.MutableRefObject<{ id: string; name: string | null } | null>;
  showSettings: boolean;
  keysRef: React.MutableRefObject<{ [key: string]: boolean }>;
}

export function useChat({
  channelRef,
  channelSubscribedRef,
  currentUser,
  currentUserRef,
  showSettings,
  keysRef,
}: UseChatOptions): ChatHandle {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatVisibleRef = useRef<boolean>(false);
  const chatInputFocusedRef = useRef<boolean>(false);

  // Handle chat visibility and Enter key
  useEffect(() => {
    const handleChatKey = (event: KeyboardEvent) => {
      if (showSettings) return;
      if (event.target === chatInputRef.current) return;

      if (event.key === 'Enter') {
        event.preventDefault();

        if (!chatVisible) {
          setChatVisible(true);
          setTimeout(() => chatInputRef.current?.focus(), 50);
        } else if (chatInput.trim() === '') {
          setChatVisible(false);
        } else {
          sendChatMessage(chatInput.trim());
          setChatInput('');
        }
      } else if (event.key === 'Escape' && chatVisible) {
        event.preventDefault();
        setChatVisible(false);
        setChatInput('');
      }
    };

    window.addEventListener('keydown', handleChatKey);
    return () => window.removeEventListener('keydown', handleChatKey);
  }, [chatVisible, chatInput, showSettings]);

  // Focus chat input when chat becomes visible
  useEffect(() => {
    if (chatVisible && chatInputRef.current) {
      chatInputRef.current.focus();
    }
  }, [chatVisible]);

  // Auto-scroll message list to bottom when new messages arrive
  useEffect(() => {
    if (chatVisible && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, chatVisible]);

  // Sync chatVisible ref and clear navigation keys when chat opens
  useEffect(() => {
    chatVisibleRef.current = chatVisible;

    if (chatVisible) {
      const keys = keysRef.current;
      keys['w'] = false;
      keys['a'] = false;
      keys['s'] = false;
      keys['d'] = false;
      keys['arrowup'] = false;
      keys['arrowdown'] = false;
      keys['arrowleft'] = false;
      keys['arrowright'] = false;
    }
  }, [chatVisible]);

  // Auto-hide chat after inactivity (paused while input is focused)
  useEffect(() => {
    if (chatVisible && chatInput === '' && !chatInputFocusedRef.current) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setChatVisible(false), 10000);
    }

    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [chatVisible, chatInput]);

  const onChatInputFocus = useCallback(() => {
    chatInputFocusedRef.current = true;
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setChatVisible(true);
  }, []);

  const onChatInputBlur = useCallback(() => {
    chatInputFocusedRef.current = false;
    if (chatVisibleRef.current && !chatInputRef.current?.value) {
      hideTimerRef.current = setTimeout(() => setChatVisible(false), 10000);
    }
  }, []);

  const sendChatMessage = useCallback((message: string) => {
    const user = currentUserRef.current;
    if (!user) return;

    const chatMessage: ChatMessage = {
      id: `${Date.now()}-${user.id}`,
      userId: user.id,
      userName: user.name || 'User',
      message,
      timestamp: Date.now(),
    };

    // Always show own message locally immediately
    setChatMessages((prev) => [...prev.slice(-49), chatMessage]);

    // Broadcast to others when channel is ready
    if (channelRef.current && channelSubscribedRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'chat',
        payload: { message: chatMessage },
      }).then((result: string) => {
        if (result !== 'ok') console.error('[Chat] Broadcast failed:', result);
      });
    }
  }, []);

  const registerChatListener = useCallback((channel: RealtimeChannel) => {
    channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
      const { message } = payload as { message: ChatMessage };
      if (message.userId !== currentUserRef.current?.id) {
        setChatMessages((prev) => [...prev.slice(-49), message]);
      }
    });
  }, []);

  return {
    chatMessages,
    chatVisible,
    setChatVisible,
    chatInput,
    setChatInput,
    chatInputRef,
    chatScrollRef,
    chatVisibleRef,
    sendChatMessage,
    onChatInputFocus,
    onChatInputBlur,
    registerChatListener,
  };
}
