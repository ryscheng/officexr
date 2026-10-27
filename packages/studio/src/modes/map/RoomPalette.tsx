import React, { useState } from 'react';

interface RoomPaletteProps {
  allRoomNames: readonly string[];
  onAddRoom: (roomName: string) => void;
  onRefresh: () => void;
}

/**
 * Left-panel palette of saved rooms. Clicking a row drops a new
 * `RoomInstance` of that room onto the map at the camera's focus
 * point (`onAddRoom` decides where). A "Refresh" button re-fetches
 * the `/api/rooms` listing in case the user just authored a new room
 * in another tab.
 *
 * Note that this list is the set of rooms AVAILABLE — `RoomInstanceList`
 * shows the set already PLACED on the current map.
 */
export function RoomPalette({ allRoomNames, onAddRoom, onRefresh }: RoomPaletteProps) {
  const [filter, setFilter] = useState('');
  const filtered = filter.trim()
    ? allRoomNames.filter((n) =>
        n.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : allRoomNames;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        font: '12px system-ui, sans-serif',
        color: '#cbd5e1',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #262626',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
          }}
        >
          <span
            style={{
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontSize: 10,
              color: '#94a3b8',
              fontWeight: 600,
            }}
          >
            Rooms ({allRoomNames.length})
          </span>
          <button
            type="button"
            onClick={onRefresh}
            title="Reload the saved-rooms list from /api/rooms"
            style={{
              fontSize: 10,
              padding: '2px 6px',
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#cbd5e1',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          style={{
            width: '100%',
            padding: '4px 6px',
            fontSize: 12,
            background: '#0a0a0a',
            border: '1px solid #404040',
            borderRadius: 3,
            color: '#fafafa',
          }}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 12, color: '#64748b' }}>
            {allRoomNames.length === 0
              ? 'No rooms saved yet. Author one in the Room editor first.'
              : 'No rooms match this filter.'}
          </div>
        ) : (
          filtered.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onAddRoom(name)}
              title={`Drop a new instance of "${name}" on the map`}
              style={{
                width: '100%',
                padding: '6px 12px',
                textAlign: 'left',
                background: 'transparent',
                border: 0,
                borderBottom: '1px solid #1e293b',
                color: '#fafafa',
                font: 'inherit',
                cursor: 'pointer',
              }}
            >
              {name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
