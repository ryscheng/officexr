import { AuthUser } from '@/hooks/useAuth';
import { NetworkStats } from '@/hooks/useNetworkStats';
import { SignalIcon } from '../NetworkDebugPanel';
import { CameraMode } from '@/types/room';

interface OnlineUser {
  id: string;
  name: string;
  email: string | null;
  status: 'active' | 'inactive' | 'offline';
}

interface UserPanelProps {
  currentUser: { id: string; name: string | null } | null;
  user: AuthUser | null;
  officeId: string;
  onlineUsers: OnlineUser[];
  followingUserId: string | null;
  networkStats: NetworkStats;
  cameraMode: CameraMode;
  micLevel: number;
  micError: string | null;
  micMuted: boolean;
  jitsiRoom: string | null;
  isSharing: boolean;
  onFollowUser: (userId: string) => void;
  onUnfollow: () => void;
  onWaveAt: (userId: string, userName: string) => void;
  onMuteToggle: () => void;
  onStartMic: () => void;
  onStartShare: () => void;
  onStopShare: () => void;
  onShowSettings: () => void;
  onShowOfficeSelector?: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
}

export default function UserPanel({
  currentUser,
  user,
  officeId,
  onlineUsers,
  followingUserId,
  networkStats,
  cameraMode,
  micLevel,
  micError,
  micMuted,
  jitsiRoom,
  isSharing,
  onFollowUser,
  onUnfollow,
  onWaveAt,
  onMuteToggle,
  onStartMic,
  onStartShare,
  onStopShare,
  onShowSettings,
  onShowOfficeSelector,
  onSignIn,
  onSignOut,
}: UserPanelProps) {
  const nameCounts: Record<string, number> = {};
  onlineUsers.forEach(u => { nameCounts[u.name] = (nameCounts[u.name] || 0) + 1; });

  return (
    <div
      style={{
        position: 'absolute', top: '20px', right: '20px',
        color: 'white', background: 'rgba(0, 0, 0, 0.72)',
        padding: '14px', borderRadius: '8px', fontFamily: 'monospace', zIndex: 100,
        width: '240px',
      }}
    >
      {/* Header */}
      <p style={{ margin: '0 0 6px 0', fontWeight: 'bold', fontSize: '14px' }}>
        {currentUser?.name}
        {!user && <span style={{ color: '#9ca3af', fontSize: '11px', fontWeight: 'normal' }}> (Guest)</span>}
      </p>
      <p style={{ margin: '0 0 4px 0', fontSize: '13px' }}>Users online: {onlineUsers.length}</p>

      {/* Camera mode */}
      {cameraMode !== 'first-person' && (
        <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#9ca3af' }}>
          {cameraMode === 'third-person-behind' ? '3rd Person (Front)' : '3rd Person (Behind)'}
          <span style={{ marginLeft: '6px' }}>· C to cycle</span>
        </p>
      )}

      {/* Online users list */}
      {onlineUsers.length > 0 && (
        <ul style={{ margin: '2px 0 4px 0', padding: '0 0 0 14px', fontSize: '12px', color: '#d1d5db', listStyle: 'none' }}>
          {onlineUsers.map(u => {
            const displayName = u.name + (nameCounts[u.name] > 1 && u.email ? ` (${u.email})` : '');
            const isSelf = u.id === currentUser?.id;
            const dotColor = u.status === 'active' ? '#4ade80' : u.status === 'inactive' ? '#fbbf24' : '#f87171';
            const dotTitle = u.status === 'active' ? 'Active' : u.status === 'inactive' ? 'Inactive' : 'Offline';
            const canInteract = !isSelf && u.status !== 'offline';
            return (
              <li key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                <span
                  title={dotTitle}
                  style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: dotColor, flexShrink: 0, display: 'inline-block',
                  }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                  {displayName}
                </span>
                {!isSelf && (() => {
                  const peerStats = networkStats.peers.get(u.id);
                  if (peerStats && peerStats.quality !== 'good') {
                    return <SignalIcon quality={peerStats.quality} />;
                  }
                  return null;
                })()}
                {canInteract && (
                  <button
                    title={followingUserId === u.id ? `Stop following ${u.name}` : `Follow ${u.name}`}
                    onClick={() => followingUserId === u.id ? onUnfollow() : onFollowUser(u.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '0 2px', fontSize: '13px', lineHeight: 1,
                      opacity: followingUserId === u.id ? 1 : 0.7, flexShrink: 0,
                      filter: followingUserId === u.id ? 'brightness(1.8)' : 'none',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = followingUserId === u.id ? '1' : '0.7'; }}
                  >
                    {followingUserId === u.id ? '⊙' : '⤴'}
                  </button>
                )}
                {canInteract && (
                  <button
                    title={`Wave at ${u.name}`}
                    onClick={() => onWaveAt(u.id, u.name)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '0 2px', fontSize: '13px', lineHeight: 1,
                      opacity: 0.7, flexShrink: 0,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; }}
                  >
                    👋
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Microphone controls */}
      <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '18px' }}
            title={micLevel < 0 ? (micError ?? 'Microphone unavailable') : micMuted ? 'Muted' : 'Microphone active'}
          >
            {[0.08, 0.22, 0.40, 0.62, 0.85].map((thresh, i) => (
              <div key={i} style={{
                width: '4px',
                height: `${6 + i * 3}px`,
                borderRadius: '2px',
                background: micMuted || micLevel < 0
                  ? 'rgba(255,255,255,0.2)'
                  : micLevel >= thresh
                    ? (thresh > 0.55 ? '#f87171' : thresh > 0.3 ? '#fbbf24' : '#4ade80')
                    : 'rgba(255,255,255,0.2)',
                transition: 'background 0.08s',
              }} />
            ))}
          </div>

          {micLevel < 0 ? (
            <button
              onClick={onStartMic}
              title="Tap to request microphone access"
              style={{
                background: 'rgba(220,38,38,0.8)', border: 'none', borderRadius: '4px',
                cursor: 'pointer', color: 'white', fontSize: '12px', padding: '3px 8px',
              }}
            >
              🎤 Tap to enable
            </button>
          ) : (
            <>
              <button
                onClick={onMuteToggle}
                title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
                style={{
                  background: micMuted ? 'rgba(220,38,38,0.8)' : 'rgba(255,255,255,0.15)',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                  color: 'white', fontSize: '13px', padding: '3px 8px',
                  transition: 'background 0.2s',
                }}
              >
                {micMuted ? '🔇' : '🎤'}
              </button>
              <span style={{ fontSize: '11px', color: '#aaa' }}>
                {micMuted ? 'Muted' : 'Live'}
              </span>
              {jitsiRoom && (
                <button
                  onClick={isSharing ? onStopShare : onStartShare}
                  title={isSharing ? 'Stop sharing screen' : 'Share your screen'}
                  style={{
                    marginLeft: 'auto',
                    background: isSharing ? 'rgba(220,38,38,0.8)' : 'rgba(255,255,255,0.15)',
                    border: 'none', borderRadius: '4px', cursor: 'pointer',
                    color: 'white', fontSize: '13px', padding: '3px 8px',
                    transition: 'background 0.2s',
                  }}
                >
                  {isSharing ? '⏹' : '🖥'}
                </button>
              )}
            </>
          )}
        </div>

        {micLevel < 0 && micError && (
          <div style={{ fontSize: '10px', color: '#f87171', marginTop: '4px', maxWidth: '160px', wordBreak: 'break-word' }}>
            {micError}
          </div>
        )}
      </div>

      <p style={{ margin: '0 0 6px 0', fontSize: '11px', color: '#9ca3af' }}>
        Office: {officeId === 'global' ? 'Global' : 'Private'}
      </p>

      {user && (
        <button
          onClick={onShowSettings}
          style={{
            marginTop: '6px', padding: '6px', fontSize: '12px',
            background: '#3498db', color: 'white',
            border: 'none', borderRadius: '4px', cursor: 'pointer',
            width: '100%',
          }}
        >
          ⚙️ Settings
        </button>
      )}

      {user ? (
        <>
          {onShowOfficeSelector && (
            <button
              onClick={onShowOfficeSelector}
              style={{
                marginTop: '5px', padding: '6px', fontSize: '12px',
                background: '#8b5cf6', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
                width: '100%',
              }}
            >
              🏠 Back to Lobby
            </button>
          )}
          <button
            onClick={onSignOut}
            style={{
              marginTop: '5px', padding: '6px', fontSize: '12px',
              background: '#dc2626', color: 'white',
              border: 'none', borderRadius: '4px', cursor: 'pointer',
              width: '100%',
            }}
          >
            Sign Out
          </button>
        </>
      ) : (
        <button
          onClick={onSignIn}
          style={{
            marginTop: '5px', padding: '6px', fontSize: '12px',
            background: '#22c55e', color: 'white',
            border: 'none', borderRadius: '4px', cursor: 'pointer',
            width: '100%',
          }}
        >
          Sign In
        </button>
      )}
    </div>
  );
}
