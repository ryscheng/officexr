import type { NetworkStats, PeerStats, ConnectionQuality } from '@/hooks/useNetworkStats';

// ─── SVG Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ values, width = 80, height = 24, maxValue }: {
  values: number[];
  width?: number;
  height?: number;
  maxValue?: number;
}) {
  if (values.length < 2) {
    return <svg width={width} height={height} />;
  }
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
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Quality Badge ──────────────────────────────────────────────────────────────

function QualityBadge({ quality }: { quality: ConnectionQuality }) {
  const config = {
    good: { label: 'Good', bg: 'rgba(74,222,128,0.2)', color: '#4ade80' },
    fair: { label: 'Fair', bg: 'rgba(251,191,36,0.2)', color: '#fbbf24' },
    poor: { label: 'Poor', bg: 'rgba(248,113,113,0.2)', color: '#f87171' },
  }[quality];

  return (
    <span style={{
      padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 600,
      background: config.bg, color: config.color,
    }}>
      {config.label}
    </span>
  );
}

// ─── Signal Strength Icon (exported for user list) ──────────────────────────────

export function SignalIcon({ quality, size = 14 }: { quality: ConnectionQuality; size?: number }) {
  if (quality === 'good') return null;
  const color = quality === 'fair' ? '#fbbf24' : '#f87171';
  const bars = quality === 'fair' ? 2 : 1;
  const w = size;
  const h = size;
  const barW = w / 5;
  const gap = barW * 0.4;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ flexShrink: 0 }}>
      {[0, 1, 2].map(i => {
        const barH = ((i + 1) / 3) * (h * 0.85);
        const x = i * (barW + gap) + gap;
        const y = h - barH;
        const filled = i < bars;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx={1}
            fill={filled ? color : 'rgba(255,255,255,0.15)'}
          />
        );
      })}
    </svg>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────────────────────

interface NetworkDebugPanelProps {
  stats: NetworkStats;
  onClose: () => void;
}

export default function NetworkDebugPanel({ stats, onClose }: NetworkDebugPanelProps) {
  const peers = [...stats.peers.values()];

  return (
    <div style={{
      height: '220px', background: '#111827', borderTop: '1px solid rgba(255,255,255,0.1)',
      color: 'white', fontFamily: 'monospace', fontSize: '12px',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <span style={{ fontWeight: 600, fontSize: '13px' }}>Network Diagnostics</span>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: '#9ca3af',
            cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '2px 4px',
          }}
        >
          x
        </button>
      </div>

      {/* Content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Your Connection */}
        <div style={{
          width: '240px', padding: '10px 16px',
          borderRight: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ color: '#9ca3af', fontSize: '10px', textTransform: 'uppercase', marginBottom: '6px' }}>
            Your Connection
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <span style={{ fontSize: '22px', fontWeight: 700 }}>
              {stats.localPingMs > 0 ? `${stats.localPingMs}ms` : '--'}
            </span>
            <QualityBadge quality={stats.localQuality} />
          </div>
          <div style={{ marginBottom: '4px', color: '#9ca3af', fontSize: '10px' }}>Ping over time</div>
          <Sparkline values={stats.localPingHistory} width={200} height={40} maxValue={500} />
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6b7280', fontSize: '9px', marginTop: '2px' }}>
            <span>0ms</span>
            <span>500ms</span>
          </div>
          {stats.localPingMs > 200 && (
            <div style={{
              marginTop: '8px', padding: '4px 8px', borderRadius: '4px',
              background: 'rgba(248,113,113,0.1)', color: '#fca5a5', fontSize: '10px',
            }}>
              High latency detected — your connection may be slow
            </div>
          )}
        </div>

        {/* Peers */}
        <div style={{ flex: 1, padding: '10px 16px', overflow: 'auto' }}>
          <div style={{ color: '#9ca3af', fontSize: '10px', textTransform: 'uppercase', marginBottom: '6px' }}>
            Connected Peers
          </div>
          {peers.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: '11px' }}>No other users connected</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#6b7280', fontSize: '10px', textAlign: 'left' }}>
                  <th style={{ padding: '2px 8px 4px 0', fontWeight: 500 }}>User</th>
                  <th style={{ padding: '2px 8px 4px 0', fontWeight: 500 }}>Ping</th>
                  <th style={{ padding: '2px 8px 4px 0', fontWeight: 500 }}>Trend</th>
                  <th style={{ padding: '2px 8px 4px 0', fontWeight: 500 }}>Updates/s</th>
                  <th style={{ padding: '2px 8px 4px 0', fontWeight: 500 }}>Quality</th>
                </tr>
              </thead>
              <tbody>
                {peers.map(peer => (
                  <PeerRow key={peer.peerId} peer={peer} localPingMs={stats.localPingMs} />
                ))}
              </tbody>
            </table>
          )}

          {/* Blame hint */}
          {peers.length > 0 && (() => {
            const poorPeers = peers.filter(p => p.quality === 'poor');
            const localIsPoor = stats.localQuality === 'poor';
            if (localIsPoor && poorPeers.length === 0) {
              return (
                <div style={{
                  marginTop: '10px', padding: '4px 8px', borderRadius: '4px',
                  background: 'rgba(248,113,113,0.1)', color: '#fca5a5', fontSize: '10px',
                }}>
                  Lag is likely on your end — peers have good connections
                </div>
              );
            }
            if (!localIsPoor && poorPeers.length > 0) {
              return (
                <div style={{
                  marginTop: '10px', padding: '4px 8px', borderRadius: '4px',
                  background: 'rgba(251,191,36,0.1)', color: '#fde68a', fontSize: '10px',
                }}>
                  {poorPeers.map(p => p.peerName).join(', ')} may have connection issues
                </div>
              );
            }
            return null;
          })()}
        </div>
      </div>
    </div>
  );
}

function PeerRow({ peer, localPingMs }: { peer: PeerStats; localPingMs: number }) {
  const pingColor = peer.avgPingMs === 0 ? '#6b7280'
    : peer.avgPingMs < 150 ? '#4ade80'
    : peer.avgPingMs < 300 ? '#fbbf24'
    : '#f87171';

  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <td style={{ padding: '4px 8px 4px 0', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {peer.peerName}
      </td>
      <td style={{ padding: '4px 8px 4px 0', color: pingColor }}>
        {peer.avgPingMs > 0 ? `${peer.avgPingMs}ms` : '--'}
      </td>
      <td style={{ padding: '4px 8px 4px 0' }}>
        <Sparkline values={peer.pingHistory} width={60} height={18} maxValue={500} />
      </td>
      <td style={{ padding: '4px 8px 4px 0', color: peer.updateRate > 12 ? '#d1d5db' : peer.updateRate > 8 ? '#fbbf24' : '#f87171' }}>
        {peer.updateRate.toFixed(1)}
      </td>
      <td style={{ padding: '4px 8px 4px 0' }}>
        <QualityBadge quality={peer.quality} />
      </td>
    </tr>
  );
}
