import React, { useEffect, useState } from 'react';
import { isValidSceneName } from '@officexr/world';

interface RoomPickerProps {
  /** Currently-open room name. */
  current: string;
  /** Async fetcher for the list of saved rooms. */
  listRooms: () => Promise<string[]>;
  /** Switch to an existing room. */
  loadRoom: (name: string) => Promise<void>;
  /** Create a brand-new empty room and switch to it. */
  newRoom: (name: string) => void;
}

/**
 * Compact left-panel widget: select an existing room from a dropdown
 * or create a new one. The current room name (which is also the
 * filename slug) shows as the dropdown's value; auto-save targets
 * that name — switching to a different name loads a different room.
 *
 * The "Create new…" option pops a tiny inline input where the user
 * types the slug. Names go through `isValidSceneName` so they
 * survive both the filesystem and the URL path.
 */
export function RoomPicker({
  current,
  listRooms,
  loadRoom,
  newRoom,
}: RoomPickerProps) {
  const [rooms, setRooms] = useState<string[]>([current]);
  const [creating, setCreating] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Refresh the list on mount + whenever the current room changes
  // (so a save-then-rename flow keeps the dropdown in sync).
  useEffect(() => {
    let cancelled = false;
    listRooms()
      .then((names) => {
        if (cancelled) return;
        const set = new Set([...names, current]);
        setRooms(Array.from(set).sort());
      })
      .catch(() => {
        if (!cancelled) setRooms([current]);
      });
    return () => {
      cancelled = true;
    };
  }, [listRooms, current]);

  const submitNew = () => {
    const name = draft.trim();
    if (!isValidSceneName(name)) {
      setError(
        'Use letters / digits / `._-` only (max 64 chars). Avoid `.` and `..`.',
      );
      return;
    }
    setError(null);
    newRoom(name);
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
        Room
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
            placeholder="new-room-name"
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
              void loadRoom(e.target.value);
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
            {rooms.map((name) => (
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
            + New room…
          </button>
        </div>
      )}
    </div>
  );
}
