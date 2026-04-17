import React from 'react';
import { PLAYER_MAX_HP } from './constants';

interface Props {
  wave: number;
  totalKills: number;
  playerHealths: Map<string, number>;
  deadPlayers: Set<string>;
  localUser: { id: string; name: string | null } | null;
  onlineUsers: Array<{ id: string; name: string }>;
}

export default function ZombieHUD({
  wave,
  totalKills,
  playerHealths,
  deadPlayers,
  localUser,
  onlineUsers,
}: Props) {
  const localUserId = localUser?.id ?? null;
  // Local user first, then remote players — only include those registered in the game
  const allPlayers: Array<{ id: string; name: string }> = [
    ...(localUser && playerHealths.has(localUser.id)
      ? [{ id: localUser.id, name: localUser.name ?? localUser.id }]
      : []),
    ...onlineUsers.filter(u => u.id !== localUserId && playerHealths.has(u.id)),
  ];

  return (
    <div style={{ pointerEvents: 'none', userSelect: 'none' }}>
      {/* Wave indicator + quit hint — bottom center */}
      <div style={{
        position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        zIndex: 200,
      }}>
        <div style={{
          background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,80,80,0.5)',
          borderRadius: 8, padding: '6px 20px', color: '#ff6060',
          fontFamily: 'monospace', fontSize: 18, fontWeight: 'bold',
          textShadow: '0 0 12px #ff0000',
        }}>
          WAVE {wave}
        </div>
        <div style={{ color: 'rgba(255,100,100,0.55)', fontFamily: 'monospace', fontSize: 11 }}>
          [Q] quit game
        </div>
      </div>

      {/* Kill counter — top right */}
      <div style={{
        position: 'absolute', top: 16, right: 20,
        background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,80,80,0.4)',
        borderRadius: 8, padding: '6px 14px', color: '#ff9900',
        fontFamily: 'monospace', fontSize: 14, fontWeight: 'bold',
        zIndex: 200,
      }}>
        ☠ {totalKills} KILLS
      </div>

      {/* Player health bars — top left */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        display: 'flex', flexDirection: 'column', gap: 6,
        zIndex: 200,
      }}>
        {allPlayers.map(u => {
          const hp = playerHealths.get(u.id) ?? 0;
          const pct = Math.max(0, Math.min(100, (hp / PLAYER_MAX_HP) * 100));
          const isDead = deadPlayers.has(u.id);
          const isLocal = u.id === localUserId;
          const barColor = isDead ? '#555' : hp > 60 ? '#44ff44' : hp > 30 ? '#ffaa00' : '#ff3333';

          return (
            <div key={u.id} style={{
              background: 'rgba(0,0,0,0.7)', border: `1px solid ${isDead ? 'rgba(100,100,100,0.4)' : 'rgba(255,80,80,0.4)'}`,
              borderRadius: 6, padding: '5px 10px', minWidth: 160,
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 4,
              }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: 12,
                  color: isDead ? '#888' : '#fff',
                  fontWeight: isLocal ? 'bold' : 'normal',
                }}>
                  {isDead ? '👻 ' : ''}{u.name}{isLocal ? ' (you)' : ''}
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: isDead ? '#555' : '#ccc' }}>
                  {isDead ? 'DEAD' : `${Math.ceil(hp)}`}
                </span>
              </div>
              <div style={{
                width: '100%', height: 6, background: '#1a1a1a',
                borderRadius: 3, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${pct}%`,
                  background: barColor,
                  transition: 'width 0.2s ease, background 0.3s ease',
                  borderRadius: 3,
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
