/**
 * `<LayoutPicker>` — left-panel widget for switching and creating layouts.
 * Mirrors `RoomPicker` for `LayoutDocument`.
 */
import React, { useEffect, useState } from 'react';
import { isValidSceneName } from '@officexr/world';

interface LayoutPickerProps {
  current: string;
  listLayouts: () => Promise<string[]>;
  loadLayout: (name: string) => Promise<void>;
  newLayout: (name: string) => void;
}

export function LayoutPicker({
  current,
  listLayouts,
  loadLayout,
  newLayout,
}: LayoutPickerProps) {
  const [layouts, setLayouts] = useState<string[]>([current]);
  const [creating, setCreating] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listLayouts()
      .then((names) => {
        if (cancelled) return;
        const set = new Set([...names, current]);
        setLayouts(Array.from(set).sort());
      })
      .catch(() => {
        if (!cancelled) setLayouts([current]);
      });
    return () => {
      cancelled = true;
    };
  }, [listLayouts, current]);

  const submitNew = () => {
    const name = draft.trim();
    if (!isValidSceneName(name)) {
      setError('Use letters / digits / `._-` only (max 64 chars).');
      return;
    }
    setError(null);
    newLayout(name);
    setCreating(false);
    setDraft('');
  };

  return (
    <div
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid #262626',
        font: '12px system-ui, sans-serif',
        color: '#cbd5e1',
      }}
    >
      <div
        style={{
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontSize: 10,
          color: '#94a3b8',
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        Layout
      </div>
      {creating ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNew();
              else if (e.key === 'Escape') {
                setCreating(false);
                setDraft('');
                setError(null);
              }
            }}
            placeholder="new-layout-name"
            style={{
              padding: '4px 6px',
              fontSize: 12,
              background: '#0a0a0a',
              border: '1px solid #404040',
              borderRadius: 3,
              color: '#fafafa',
            }}
          />
          {error && (
            <div style={{ fontSize: 10, color: '#fca5a5' }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={submitNew}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: 11,
                background: '#3b82f6',
                color: '#fff',
                border: 0,
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setDraft('');
                setError(null);
              }}
              style={{
                flex: 1,
                padding: '4px 6px',
                fontSize: 11,
                background: 'transparent',
                color: '#cbd5e1',
                border: '1px solid #404040',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <select
            value={current}
            onChange={(e) => {
              void loadLayout(e.target.value);
            }}
            style={{
              padding: '4px 6px',
              fontSize: 12,
              background: '#0a0a0a',
              border: '1px solid #404040',
              borderRadius: 3,
              color: '#fafafa',
              cursor: 'pointer',
            }}
          >
            {layouts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCreating(true)}
            style={{
              padding: '4px 6px',
              fontSize: 11,
              background: 'transparent',
              color: '#cbd5e1',
              border: '1px solid #404040',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            + New layout…
          </button>
        </div>
      )}
    </div>
  );
}
