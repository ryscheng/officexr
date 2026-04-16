import { useEffect, useRef, useState } from 'react';
import type { NetworkStats, PeerStats, ConnectionQuality } from '@/hooks/useNetworkStats';
import type { ChannelLogEntry, UserLastSeen } from '@/hooks/useChannelLogger';

// ─── Sparkline ───────────────────────────────────────────────────────────────

function Sparkline({ values, width = 80, height = 24, maxValue }: {
  values: number[]; width?: number; height?: number; maxValue?: number;
}) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const max = maxValue ?? Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - (Math.min(v, max) / max) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const lastVal = values[values.length - 1];
  const color = lastVal < 150 ? '#4ade80' : lastVal < 300 ? '#fbbf24' : '#f87171';
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

// ─── Quality Badge ────────────────────────────────────────────────────────────

function QualityBadge({ quality }: { quality: ConnectionQuality }) {
  const config = {
    good: { label: 'Good', bg: 'rgba(74,222,128,0.2)', color: '#4ade80' },
    fair: { label: 'Fair', bg: 'rgba(251,191,36,0.2)', color: '#fbbf24' },
    poor: { label: 'Poor', bg: 'rgba(248,113,113,0.2)', color: '#f87171' },
  }[quality];
  return (
    <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 600, background: config.bg, color: config.color }}>
      {config.label}
    </span>
  );
}

// ─── Signal Icon (exported) ───────────────────────────────────────────────────

export function SignalIcon({ quality, size = 14 }: { quality: ConnectionQuality; size?: number }) {
  if (quality === 'good') return null;
  const color = quality === 'fair' ? '#fbbf24' : '#f87171';
  const bars = quality === 'fair' ? 2 : 1;
  const barW = size / 5;
  const gap = barW * 0.4;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {[0, 1, 2].map(i => {
        const barH = ((i + 1) / 3) * (size * 0.85);
        return (
          <rect key={i} x={i * (barW + gap) + gap} y={size - barH}
            width={barW} height={barH} rx={1}
            fill={i < bars ? color : 'rgba(255,255,255,0.15)'} />
        );
      })}
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

const EVENT_COLOR: Record<string, string> = {
  'chat':           '#818cf8',
  'wave':           '#34d399',
  'confetti':       '#34d399',
  'presence:join':  '#4ade80',
  'presence:leave': '#f87171',
  'whiteboard-stroke': '#fbbf24',
  'whiteboard-undo':   '#fbbf24',
  'whiteboard-clear':  '#fbbf24',
  'screen-offer':   '#67e8f9',
  'screen-answer':  '#67e8f9',
  'screen-ice':     '#67e8f9',
  'screen-stop':    '#67e8f9',
  'environment-change': '#c084fc',
  'avatar-update':  '#c084fc',
  'bubble-prefs':   '#c084fc',
};

function eventColor(event: string): string {
  return EVENT_COLOR[event] ?? '#9ca3af';
}

const SECTION = { color: '#9ca3af', fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '6px' };
const COL_L = { width: '220px', minWidth: '220px', padding: '10px 14px', borderRight: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto' as const };
const COL_R = { flex: 1, padding: '10px 14px', overflowY: 'auto' as const };

// ─── Realtime Tab ─────────────────────────────────────────────────────────────

function RealtimeTab({ stats, realtimeRetryAt, lastSeenByUser, channelLog }: {
  stats: NetworkStats;
  realtimeRetryAt: number | null;
  lastSeenByUser: Map<string, UserLastSeen>;
  channelLog: ChannelLogEntry[];
}) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ block: 'end' });
    }
  }, [channelLog, autoScroll]);

  const peers = [...stats.peers.values()];
  const realtimeOk = realtimeRetryAt === null;

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left: your connection */}
      <div style={COL_L}>
        <div style={SECTION}>Supabase Realtime</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
            background: realtimeOk ? '#4ade80' : '#f97316',
            boxShadow: `0 0 5px ${realtimeOk ? '#4ade80' : '#f97316'}`,
          }} />
          <span style={{ color: realtimeOk ? '#4ade80' : '#fb923c', fontSize: '11px' }}>
            {realtimeOk ? 'Connected' : 'Reconnecting…'}
          </span>
        </div>

        <div style={SECTION}>Ping over time</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{ fontSize: '20px', fontWeight: 700 }}>
            {stats.localPingMs > 0 ? `${stats.localPingMs}ms` : '--'}
          </span>
          <QualityBadge quality={stats.localQuality} />
        </div>
        <Sparkline values={stats.localPingHistory} width={188} height={36} maxValue={500} />
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: '9px', marginTop: '2px' }}>
          <span>0ms</span><span>500ms</span>
        </div>
        {stats.localPingMs > 200 && (
          <div style={{ marginTop: '8px', padding: '4px 8px', borderRadius: '4px', background: 'rgba(248,113,113,0.1)', color: '#fca5a5', fontSize: '10px' }}>
            High latency — your connection may be slow
          </div>
        )}
      </div>

      {/* Middle: peers */}
      <div style={{ width: '280px', minWidth: '280px', padding: '10px 14px', borderRight: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto' }}>
        <div style={SECTION}>Peer Status</div>
        {peers.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: '11px' }}>No other users connected</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#6b7280', fontSize: '10px', textAlign: 'left' }}>
                <th style={{ padding: '2px 6px 4px 0', fontWeight: 500 }}>User</th>
                <th style={{ padding: '2px 6px 4px 0', fontWeight: 500 }}>Ping</th>
                <th style={{ padding: '2px 6px 4px 0', fontWeight: 500 }}>Trend</th>
                <th style={{ padding: '2px 4px 4px 0', fontWeight: 500 }}>Last msg</th>
                <th style={{ padding: '2px 0 4px 0', fontWeight: 500 }}>Quality</th>
              </tr>
            </thead>
            <tbody>
              {peers.map(peer => {
                const lastSeen = lastSeenByUser.get(peer.peerId);
                const pingColor = peer.avgPingMs === 0 ? '#6b7280' : peer.avgPingMs < 150 ? '#4ade80' : peer.avgPingMs < 300 ? '#fbbf24' : '#f87171';
                return (
                  <tr key={peer.peerId} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '3px 6px 3px 0', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {peer.peerName}
                    </td>
                    <td style={{ padding: '3px 6px 3px 0', color: pingColor }}>
                      {peer.avgPingMs > 0 ? `${peer.avgPingMs}ms` : '--'}
                    </td>
                    <td style={{ padding: '3px 6px 3px 0' }}>
                      <Sparkline values={peer.pingHistory} width={48} height={16} maxValue={500} />
                    </td>
                    <td style={{ padding: '3px 4px 3px 0', fontSize: '10px' }}>
                      {lastSeen ? (
                        <span title={`${lastSeen.event} · ${fmtTime(lastSeen.timestamp)}`}>
                          <span style={{ color: eventColor(lastSeen.event) }}>{lastSeen.event}</span>
                          {' '}
                          <span style={{ color: '#6b7280' }}>{fmtAgo(lastSeen.timestamp)}</span>
                        </span>
                      ) : (
                        <span style={{ color: '#6b7280' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '3px 0' }}>
                      <QualityBadge quality={peer.quality} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Blame hint */}
        {peers.length > 0 && (() => {
          const poorPeers = peers.filter(p => p.quality === 'poor');
          const localIsPoor = stats.localQuality === 'poor';
          if (localIsPoor && poorPeers.length === 0) return (
            <div style={{ marginTop: '8px', padding: '4px 8px', borderRadius: '4px', background: 'rgba(248,113,113,0.1)', color: '#fca5a5', fontSize: '10px' }}>
              Lag likely on your end — peers have good connections
            </div>
          );
          if (!localIsPoor && poorPeers.length > 0) return (
            <div style={{ marginTop: '8px', padding: '4px 8px', borderRadius: '4px', background: 'rgba(251,191,36,0.1)', color: '#fde68a', fontSize: '10px' }}>
              {poorPeers.map(p => p.peerName).join(', ')} may have connection issues
            </div>
          );
          return null;
        })()}
      </div>

      {/* Right: message log */}
      <div style={{ ...COL_R, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={SECTION}>Channel log ({channelLog.length})</span>
          <button
            onClick={() => setAutoScroll(v => !v)}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: autoScroll ? '#4ade80' : '#6b7280', borderRadius: '3px', fontSize: '9px', padding: '1px 6px', cursor: 'pointer' }}
          >
            {autoScroll ? 'Auto ↓' : 'Paused'}
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '10px' }}>
          {channelLog.length === 0 ? (
            <span style={{ color: '#6b7280' }}>No events yet</span>
          ) : channelLog.map(entry => (
            <div key={entry.id} style={{ display: 'flex', gap: '6px', marginBottom: '2px', alignItems: 'baseline' }}>
              <span style={{ color: '#6b7280', flexShrink: 0 }}>{fmtTime(entry.timestamp)}</span>
              <span style={{ color: eventColor(entry.event), flexShrink: 0 }}>{entry.event}</span>
              {entry.senderName && (
                <span style={{ color: '#9ca3af', flexShrink: 0 }}>{entry.senderName}</span>
              )}
              {entry.summary && (
                <span style={{ color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.summary}
                </span>
              )}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

// ─── Jitsi Tab ────────────────────────────────────────────────────────────────

function AudioBars({ level, count = 5 }: { level: number; count?: number }) {
  const thresholds = Array.from({ length: count }, (_, i) => (i + 1) / count);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '16px' }}>
      {thresholds.map((t, i) => (
        <div key={i} style={{
          width: '4px', height: `${6 + i * 2}px`, borderRadius: '2px',
          background: level >= t
            ? (t > 0.7 ? '#f87171' : t > 0.45 ? '#fbbf24' : '#4ade80')
            : 'rgba(255,255,255,0.18)',
          transition: 'background 0.1s',
        }} />
      ))}
    </div>
  );
}

function JitsiTab({ stats, jitsiRoom, jitsiConnected, jitsiParticipantCount, jitsiError,
  remoteAudioLevel, micMuted, micLevel, micError, jitsiUsers }: {
  stats: NetworkStats;
  jitsiRoom: string | null;
  jitsiConnected: boolean;
  jitsiParticipantCount: number;
  jitsiError: string | null;
  remoteAudioLevel: number;
  micMuted: boolean;
  micLevel: number;
  micError: string | null;
  jitsiUsers: Array<{ id: string; name: string; jitsiRoom: string | null }>;
}) {
  let statusColor = '#6b7280';
  let statusLabel = 'Not in call';
  if (jitsiError) { statusColor = '#f87171'; statusLabel = 'Error'; }
  else if (!jitsiRoom) { statusColor = '#6b7280'; statusLabel = 'No nearby users'; }
  else if (jitsiConnected) { statusColor = '#4ade80'; statusLabel = 'Connected'; }
  else { statusColor = '#fbbf24'; statusLabel = 'Connecting…'; }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left: connection status + audio */}
      <div style={COL_L}>
        <div style={SECTION}>Voice Connection</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColor, boxShadow: `0 0 5px ${statusColor}`, flexShrink: 0 }} />
          <span style={{ color: statusColor, fontSize: '11px' }}>{statusLabel}</span>
        </div>
        {jitsiError && (
          <div style={{ padding: '4px 8px', borderRadius: '4px', background: 'rgba(248,113,113,0.1)', color: '#fca5a5', fontSize: '10px', marginBottom: '8px' }}>
            {jitsiError}
          </div>
        )}
        {jitsiRoom && (
          <div style={{ color: '#6b7280', fontSize: '10px', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={jitsiRoom}>
            Room: <span style={{ color: '#9ca3af' }}>{jitsiRoom.slice(-16)}</span>
          </div>
        )}
        {jitsiConnected && (
          <div style={{ color: '#6b7280', fontSize: '10px', marginBottom: '8px' }}>
            Participants: <span style={{ color: '#d1d5db' }}>{jitsiParticipantCount}</span>
          </div>
        )}

        <div style={{ ...SECTION, marginTop: '4px' }}>Microphone</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <AudioBars level={micLevel < 0 ? 0 : micLevel} />
          <span style={{ fontSize: '10px', color: micMuted ? '#f87171' : micLevel < 0 ? '#f87171' : '#4ade80' }}>
            {micLevel < 0 ? 'Unavailable' : micMuted ? 'Muted' : 'Live'}
          </span>
        </div>
        {micError && (
          <div style={{ color: '#f87171', fontSize: '10px', marginBottom: '8px' }}>{micError}</div>
        )}

        <div style={{ ...SECTION, marginTop: '4px' }}>Remote Audio</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <AudioBars level={remoteAudioLevel} count={8} />
          <span style={{ color: '#6b7280', fontSize: '10px' }}>{Math.round(remoteAudioLevel * 100)}%</span>
        </div>

        <div style={SECTION}>Network Quality (via Supabase)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontSize: '18px', fontWeight: 700 }}>
            {stats.localPingMs > 0 ? `${stats.localPingMs}ms` : '--'}
          </span>
          <QualityBadge quality={stats.localQuality} />
        </div>
        <Sparkline values={stats.localPingHistory} width={188} height={30} maxValue={500} />
        <div style={{ color: '#6b7280', fontSize: '9px', marginTop: '2px' }}>
          Supabase channel RTT — shared network path
        </div>
      </div>

      {/* Right: per-user Jitsi status */}
      <div style={COL_R}>
        <div style={SECTION}>Users in Room</div>
        {jitsiUsers.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: '11px' }}>No other users online</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#6b7280', fontSize: '10px', textAlign: 'left' }}>
                <th style={{ padding: '2px 8px 4px 0', fontWeight: 500 }}>User</th>
                <th style={{ padding: '2px 8px 4px 0', fontWeight: 500 }}>Voice status</th>
                <th style={{ padding: '2px 8px 4px 0', fontWeight: 500 }}>Channel ping</th>
                <th style={{ padding: '2px 0 4px 0', fontWeight: 500 }}>Quality</th>
              </tr>
            </thead>
            <tbody>
              {jitsiUsers.map(u => {
                const inSameRoom = jitsiRoom !== null && u.jitsiRoom === jitsiRoom;
                const inDiffRoom = u.jitsiRoom !== null && u.jitsiRoom !== jitsiRoom;
                const peerStats = stats.peers.get(u.id);
                const pingColor = !peerStats || peerStats.avgPingMs === 0 ? '#6b7280'
                  : peerStats.avgPingMs < 150 ? '#4ade80'
                  : peerStats.avgPingMs < 300 ? '#fbbf24' : '#f87171';
                return (
                  <tr key={u.id} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '4px 8px 4px 0', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.name}
                    </td>
                    <td style={{ padding: '4px 8px 4px 0' }}>
                      {inSameRoom ? (
                        <span style={{ color: '#4ade80', fontSize: '10px' }}>🟢 In call</span>
                      ) : inDiffRoom ? (
                        <span style={{ color: '#fbbf24', fontSize: '10px' }}>🟡 Other call</span>
                      ) : u.jitsiRoom === null ? (
                        <span style={{ color: '#6b7280', fontSize: '10px' }}>— Not in call</span>
                      ) : (
                        <span style={{ color: '#6b7280', fontSize: '10px' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '4px 8px 4px 0', color: pingColor, fontSize: '11px' }}>
                      {peerStats && peerStats.avgPingMs > 0 ? `${peerStats.avgPingMs}ms` : '--'}
                    </td>
                    <td style={{ padding: '4px 0' }}>
                      {peerStats ? <QualityBadge quality={peerStats.quality} /> : <span style={{ color: '#6b7280', fontSize: '10px' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export const PANEL_HEIGHT = 320;

interface NetworkDebugPanelProps {
  // Supabase Realtime
  stats: NetworkStats;
  realtimeRetryAt: number | null;
  channelLog: ChannelLogEntry[];
  lastSeenByUser: Map<string, UserLastSeen>;
  // Jitsi
  jitsiRoom: string | null;
  jitsiConnected: boolean;
  jitsiParticipantCount: number;
  jitsiError: string | null;
  remoteAudioLevel: number;
  micMuted: boolean;
  micLevel: number;
  micError: string | null;
  jitsiUsers: Array<{ id: string; name: string; jitsiRoom: string | null }>;
  onClose: () => void;
}

export default function NetworkDebugPanel({
  stats, realtimeRetryAt, channelLog, lastSeenByUser,
  jitsiRoom, jitsiConnected, jitsiParticipantCount, jitsiError,
  remoteAudioLevel, micMuted, micLevel, micError, jitsiUsers,
  onClose,
}: NetworkDebugPanelProps) {
  const [activeTab, setActiveTab] = useState<'realtime' | 'jitsi'>('realtime');

  const tabStyle = (tab: 'realtime' | 'jitsi') => ({
    padding: '4px 14px', cursor: 'pointer', fontSize: '11px', fontFamily: 'monospace',
    background: 'none', border: 'none',
    borderBottom: activeTab === tab ? '2px solid #60a5fa' : '2px solid transparent',
    color: activeTab === tab ? '#e5e7eb' : '#6b7280',
    transition: 'color 0.15s',
  });

  return (
    <div style={{
      height: `${PANEL_HEIGHT}px`, background: '#111827',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      color: 'white', fontFamily: 'monospace', fontSize: '12px',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
          <span style={{ fontWeight: 600, fontSize: '12px', color: '#9ca3af', paddingRight: '16px' }}>
            Network Diagnostics
          </span>
          <button style={tabStyle('realtime')} onClick={() => setActiveTab('realtime')}>
            Supabase Realtime
          </button>
          <button style={tabStyle('jitsi')} onClick={() => setActiveTab('jitsi')}>
            Jitsi Voice
          </button>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px 4px' }}
        >
          ×
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'realtime' ? (
        <RealtimeTab
          stats={stats}
          realtimeRetryAt={realtimeRetryAt}
          lastSeenByUser={lastSeenByUser}
          channelLog={channelLog}
        />
      ) : (
        <JitsiTab
          stats={stats}
          jitsiRoom={jitsiRoom}
          jitsiConnected={jitsiConnected}
          jitsiParticipantCount={jitsiParticipantCount}
          jitsiError={jitsiError}
          remoteAudioLevel={remoteAudioLevel}
          micMuted={micMuted}
          micLevel={micLevel}
          micError={micError}
          jitsiUsers={jitsiUsers}
        />
      )}
    </div>
  );
}
