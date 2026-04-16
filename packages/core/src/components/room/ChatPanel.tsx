import { ChatMessage } from '@/types/room';

interface ChatPanelProps {
  visible: boolean;
  messages: ChatMessage[];
  input: string;
  onInputChange: (v: string) => void;
  onSend: (msg: string) => void;
  onClose: () => void;
  onInputFocus: () => void;
  onInputBlur: () => void;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  chatInputRef: React.RefObject<HTMLInputElement | null>;
}

export default function ChatPanel({
  visible,
  messages,
  input,
  onInputChange,
  onSend,
  onClose,
  onInputFocus,
  onInputBlur,
  chatScrollRef,
  chatInputRef,
}: ChatPanelProps) {
  const hasMessages = messages.length > 0;
  const hasAbove = visible || hasMessages;

  return (
    <div
      style={{
        position: 'absolute', bottom: '20px', left: '50%',
        transform: 'translateX(-50%)', width: '500px', maxWidth: '90vw',
        zIndex: 200,
      }}
    >
      {/* Full scrollable history */}
      {visible && (
        <div
          style={{
            background: 'rgba(0,0,0,0.75)', borderRadius: '8px 8px 0 0',
            padding: '10px 10px 6px',
          }}
        >
          <div
            ref={chatScrollRef}
            style={{ maxHeight: '50vh', overflowY: 'auto' }}
          >
            {messages.map((msg) => (
              <div key={msg.id} style={{ color: 'white', fontSize: '14px', marginBottom: '4px' }}>
                <span style={{ color: '#6b7280', fontSize: '11px', marginRight: '6px' }}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{msg.userName}: </span>
                {msg.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compact log: last 2 messages when history is hidden */}
      {!visible && hasMessages && (
        <div
          style={{
            background: 'rgba(0,0,0,0.5)', borderRadius: '8px 8px 0 0',
            padding: '8px 12px 6px', pointerEvents: 'none',
          }}
        >
          {messages.slice(-2).map((msg) => (
            <div key={msg.id} style={{ color: 'white', fontSize: '13px', marginBottom: '2px' }}>
              <span style={{ color: '#6b7280', fontSize: '11px', marginRight: '6px' }}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{msg.userName}: </span>
              {msg.message}
            </div>
          ))}
        </div>
      )}

      {/* Always-visible chat input bar */}
      <input
        ref={chatInputRef}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onFocus={onInputFocus}
        onBlur={onInputBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && input.trim()) {
            e.stopPropagation();
            onSend(input.trim());
          } else if (e.key === 'Escape') {
            onClose();
          }
        }}
        placeholder="Type a message..."
        style={{
          width: '100%', padding: '8px', boxSizing: 'border-box',
          border: 'none', outline: 'none',
          borderRadius: hasAbove ? '0 0 8px 8px' : '8px',
          background: 'rgba(0,0,0,0.75)',
          color: 'white', fontSize: '14px',
        }}
      />
    </div>
  );
}
