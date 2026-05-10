import React, { useState } from 'react';
import type { BotDriver } from './BotDriver.ts';

type BotMode = 'idle' | 'walk-to-local' | 'walk-away';

interface BotControlPanelProps {
  botDriver: BotDriver | null;
}

export function BotControlPanel({ botDriver }: BotControlPanelProps) {
  const [activeMode, setActiveMode] = useState<BotMode | null>(null);

  const handleMode = (mode: BotMode) => {
    botDriver?.setMode(mode);
    setActiveMode(mode);
  };

  const buttonStyle = (mode: BotMode): React.CSSProperties => ({
    padding: '4px 8px',
    cursor: 'pointer',
    background: activeMode === mode ? '#4488ff' : undefined,
    color: activeMode === mode ? 'white' : undefined,
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: 4,
  });

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      right: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      background: 'rgba(0,0,0,0.6)',
      padding: 12,
      borderRadius: 8,
      color: 'white',
      fontFamily: 'monospace',
      fontSize: 13,
    }}>
      <div style={{ marginBottom: 4, fontWeight: 'bold' }}>Bot Controls</div>
      <button style={buttonStyle('idle')} onClick={() => handleMode('idle')}>Stay</button>
      <button style={buttonStyle('walk-to-local')} onClick={() => handleMode('walk-to-local')}>Walk to me</button>
      <button style={buttonStyle('walk-away')} onClick={() => handleMode('walk-away')}>Walk away</button>
    </div>
  );
}
