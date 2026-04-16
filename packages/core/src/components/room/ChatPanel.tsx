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
  if (visible) {
    return (
      <div
        style={{
          position: 'absolute', bottom: '20px', left: '50%',
          transform: 'translateX(-50%)', width: '500px', maxWidth: '90vw',
          background: 'rgba(0,0,0,0.75)', borderRadius: '8px',
          padding: '10px', zIndex: 200,
        }}
      >
        <div
          ref={chatScrollRef}
          style={{ maxHeight: '50vh', overflowY: 'auto', marginBottom: '8px' }}
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
            width: '100%', padding: '8px', borderRadius: '4px',
            border: 'none', background: 'rgba(255,255,255,0.1)',
            color: 'white', fontSize: '14px', boxSizing: 'border-box',
          }}
        />
      </div>
    );
  }

  if (messages.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute', bottom: '20px', left: '50%',
        transform: 'translateX(-50%)', width: '400px', maxWidth: '80vw',
        background: 'rgba(0,0,0,0.5)', borderRadius: '8px',
        padding: '8px 12px', zIndex: 100, pointerEvents: 'none',
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
  );
}
