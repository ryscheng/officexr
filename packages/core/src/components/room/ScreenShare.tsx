import { ScreenShare as ScreenShareEntry } from '@/types/room';

// ── Full-screen overlay ───────────────────────────────────────────────────────

interface ScreenShareOverlayProps {
  activeShareId: string;
  screenShares: Map<string, ScreenShareEntry>;
  currentUserId: string | undefined;
  onClose: () => void;
  onSwitchShare: (id: string) => void;
  onStopShare: () => void;
}

export function ScreenShareOverlay({
  activeShareId,
  screenShares,
  currentUserId,
  onClose,
  onSwitchShare,
  onStopShare,
}: ScreenShareOverlayProps) {
  const share = screenShares.get(activeShareId);
  if (!share) return null;
  const isMine = activeShareId === currentUserId;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 450,
      background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 14px', background: 'rgba(0,0,0,0.6)',
        color: 'white', fontFamily: 'monospace', fontSize: '13px', flexShrink: 0,
      }}>
        <span>🖥 {isMine ? 'Your screen' : `${share.name}'s screen`}</span>
        {[...screenShares.entries()]
          .filter(([id]) => id !== activeShareId)
          .map(([id, s]) => (
            <button key={id} onClick={() => onSwitchShare(id)} style={{
              background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '4px',
              color: 'white', fontSize: '12px', padding: '2px 8px', cursor: 'pointer',
            }}>
              {s.name}
            </button>
          ))}
        <button
          onClick={onClose}
          title="Minimize"
          style={{
            marginLeft: 'auto', background: 'rgba(255,255,255,0.1)', border: 'none',
            borderRadius: '4px', color: 'white', fontSize: '13px',
            padding: '2px 10px', cursor: 'pointer',
          }}
        >
          ╌ Minimize
        </button>
        {isMine && (
          <button
            onClick={onStopShare}
            style={{
              background: 'rgba(220,38,38,0.8)', border: 'none', borderRadius: '4px',
              color: 'white', fontSize: '12px', padding: '2px 10px', cursor: 'pointer',
            }}
          >
            Stop sharing
          </button>
        )}
      </div>
      {/* Video */}
      <video
        ref={el => {
          if (!el) return;
          if (el.srcObject !== share.stream) {
            el.srcObject = share.stream;
            el.muted = true;
            el.play()
              .then(() => { el.muted = isMine; })
              .catch(() => {});
          }
        }}
        autoPlay playsInline
        style={{ flex: 1, width: '100%', objectFit: 'contain', background: 'black' }}
      />
    </div>
  );
}

// ── Minimized tiles (shown when overlay is closed) ────────────────────────────

interface ScreenShareTilesProps {
  screenShares: Map<string, ScreenShareEntry>;
  currentUserId: string | undefined;
  onSelect: (id: string) => void;
}

export function ScreenShareTiles({ screenShares, currentUserId, onSelect }: ScreenShareTilesProps) {
  const tiles = [...screenShares.entries()];
  return (
    <div style={{
      position: 'fixed', bottom: '12px', right: '12px',
      display: 'flex', flexDirection: 'column', gap: '8px',
      zIndex: 300, alignItems: 'flex-end',
    }}>
      {tiles.map(([id, share]) => {
        const isMine = id === currentUserId;
        return (
          <div key={id} style={{
            width: '240px', background: 'rgba(0,0,0,0.85)',
            borderRadius: '8px', overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            cursor: 'pointer',
          }} onClick={() => onSelect(id)}>
            <video
              ref={el => {
                if (!el) return;
                if (el.srcObject !== share.stream) {
                  el.srcObject = share.stream;
                  el.muted = true;
                  el.play()
                    .then(() => { el.muted = isMine; })
                    .catch(() => {});
                }
              }}
              autoPlay playsInline
              style={{ width: '100%', display: 'block', aspectRatio: '16/9', objectFit: 'contain', background: 'black' }}
            />
            <div style={{
              padding: '4px 8px', color: 'white', fontSize: '11px',
              fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between',
            }}>
              <span>🖥 {isMine ? 'Your screen' : share.name}</span>
              <span style={{ opacity: 0.6 }}>click to expand</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
