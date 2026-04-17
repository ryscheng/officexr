import React, { useEffect, useState } from 'react';
import { ZombieGamePhase } from './types';

interface Props {
  phase: ZombieGamePhase;
  wave: number;
  totalKills: number;
}

export default function ZombieOverlay({ phase, wave, totalKills }: Props) {
  const [visible, setVisible] = useState(false);

  // Fade in when phase becomes 'wave-intro'
  useEffect(() => {
    if (phase === 'wave-intro' || phase === 'game-over') {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [phase]);

  if (phase === 'inactive' || phase === 'playing') return null;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 500,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', userSelect: 'none',
      background: 'rgba(0,0,0,0.55)',
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.4s ease',
    }}>
      {phase === 'wave-intro' && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          animation: 'zombieWaveIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}>
          <div style={{
            fontFamily: 'monospace', fontSize: 22, color: '#ff6060',
            textShadow: '0 0 20px #ff0000', letterSpacing: 4, fontWeight: 'bold',
          }}>
            ⚠ INCOMING ⚠
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: 72, fontWeight: 'bold',
            color: '#ff2222', textShadow: '0 0 40px #ff0000, 0 0 80px #aa0000',
            letterSpacing: 8,
          }}>
            WAVE {wave}
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: 16, color: '#ff9900',
            textShadow: '0 0 10px #ff6600',
          }}>
            SURVIVE OR DIE
          </div>

          <style>{`
            @keyframes zombieWaveIn {
              from { transform: scale(0.5); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {phase === 'game-over' && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
          animation: 'zombieWaveIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}>
          <div style={{
            fontFamily: 'monospace', fontSize: 80, fontWeight: 'bold',
            color: '#880000', textShadow: '0 0 60px #ff0000',
            letterSpacing: 6,
          }}>
            GAME OVER
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: 32, color: '#ff6060',
            textShadow: '0 0 20px #ff2200',
          }}>
            👻 ALL FALLEN 👻
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: 20, color: '#ffaa00',
            textShadow: '0 0 12px #ff6600',
          }}>
            TOTAL KILLS: {totalKills}
          </div>
          <div style={{
            fontFamily: 'monospace', fontSize: 14, color: 'rgba(255,100,100,0.6)',
            marginTop: 8,
          }}>
            Returning to normal room…
          </div>

          <style>{`
            @keyframes zombieWaveIn {
              from { transform: scale(0.5); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
