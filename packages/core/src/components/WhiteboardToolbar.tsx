import { WB_COLORS, WB_WIDTHS, WhiteboardTool } from '@/hooks/useWhiteboard';

interface WhiteboardToolbarProps {
  active: boolean;
  onToggle: () => void;
  tool: WhiteboardTool;
  onToolChange: (tool: WhiteboardTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  onUndo: () => void;
  onClear: () => void;
  strokeCount: number;
}

const btnBase: React.CSSProperties = {
  border: 'none', borderRadius: '6px', cursor: 'pointer',
  color: 'white', fontSize: '13px', padding: '5px 10px',
  transition: 'background 0.15s',
};

export default function WhiteboardToolbar({
  active,
  onToggle,
  tool,
  onToolChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  onUndo,
  onClear,
  strokeCount,
}: WhiteboardToolbarProps) {
  return (
    <div style={{
      position: 'absolute', top: '70px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 160, display: 'flex', alignItems: 'center', gap: '8px',
      fontFamily: 'monospace',
    }}>
      {/* Toggle button — always visible */}
      <button
        onClick={onToggle}
        title="Toggle whiteboard (B)"
        style={{
          ...btnBase,
          background: active ? 'rgba(99,102,241,0.8)' : 'rgba(0,0,0,0.55)',
          border: active ? '2px solid rgba(165,180,252,0.6)' : '1px solid rgba(255,255,255,0.15)',
          padding: '6px 12px', fontSize: '14px',
        }}
      >
        {active ? '✏️ Board ON' : '✏️ Board'}
      </button>

      {/* Tools — only when active */}
      {active && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'rgba(0,0,0,0.65)', borderRadius: '10px',
          padding: '6px 12px', border: '1px solid rgba(255,255,255,0.12)',
        }}>
          {/* Pen / Eraser toggle */}
          <button
            onClick={() => onToolChange('pen')}
            title="Pen"
            style={{
              ...btnBase,
              background: tool === 'pen' ? 'rgba(59,130,246,0.7)' : 'rgba(255,255,255,0.1)',
              fontSize: '16px', padding: '4px 8px',
            }}
          >
            ✏️
          </button>
          <button
            onClick={() => onToolChange('eraser')}
            title="Eraser"
            style={{
              ...btnBase,
              background: tool === 'eraser' ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.1)',
              fontSize: '16px', padding: '4px 8px',
            }}
          >
            🧹
          </button>

          {/* Separator */}
          <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.2)' }} />

          {/* Color palette */}
          {tool === 'pen' && (
            <div style={{ display: 'flex', gap: '3px' }}>
              {WB_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => onColorChange(c)}
                  title={c}
                  style={{
                    width: '20px', height: '20px', borderRadius: '50%',
                    background: c, border: color === c ? '2px solid #60a5fa' : '2px solid rgba(255,255,255,0.3)',
                    cursor: 'pointer', padding: 0,
                  }}
                />
              ))}
            </div>
          )}

          {/* Separator */}
          <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.2)' }} />

          {/* Stroke width */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {WB_WIDTHS.map(w => (
              <button
                key={w}
                onClick={() => onStrokeWidthChange(w)}
                title={`Width: ${w}`}
                style={{
                  width: `${12 + w}px`, height: `${12 + w}px`, borderRadius: '50%',
                  background: strokeWidth === w ? 'rgba(99,102,241,0.8)' : 'rgba(255,255,255,0.25)',
                  border: 'none', cursor: 'pointer', padding: 0,
                }}
              />
            ))}
          </div>

          {/* Separator */}
          <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.2)' }} />

          {/* Undo */}
          <button
            onClick={onUndo}
            title="Undo last stroke (Ctrl+Z)"
            style={{ ...btnBase, background: 'rgba(255,255,255,0.1)' }}
          >
            ↩
          </button>

          {/* Clear all */}
          <button
            onClick={onClear}
            title="Clear all strokes"
            style={{ ...btnBase, background: strokeCount > 0 ? 'rgba(220,38,38,0.6)' : 'rgba(255,255,255,0.05)', color: strokeCount > 0 ? 'white' : 'rgba(255,255,255,0.4)' }}
            disabled={strokeCount === 0}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
