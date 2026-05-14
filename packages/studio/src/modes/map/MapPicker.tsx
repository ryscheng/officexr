import React, { useEffect, useState } from 'react';

interface MapPickerProps {
  currentName: string;
  onLoad: (name: string) => void;
  onNew: (name: string) => void;
  listMaps: () => Promise<string[]>;
}

/**
 * Tiny header block in the Map editor's LeftPanel: a dropdown of all
 * `/api/maps`, a textbox to author a brand-new map, and a reload
 * button. Mirrors `RoomPicker` from the Room editor at
 * `room/RoomPicker.tsx` — keep the two in shape sync if either
 * grows.
 */
export function MapPicker({ currentName, onLoad, onNew, listMaps }: MapPickerProps) {
  const [maps, setMaps] = useState<string[]>([]);
  const [newName, setNewName] = useState('');

  const reload = async () => {
    setMaps(await listMaps());
  };
  useEffect(() => {
    void reload();
    // listMaps identity is stable per hook mount, so reloading once
    // per mount is enough — explicit Reload button covers manual cases.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trySubmitNew = () => {
    const slug = newName.trim();
    if (!slug) return;
    onNew(slug);
    setNewName('');
    void reload();
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
        Map
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <select
          value={currentName}
          onChange={(e) => onLoad(e.target.value)}
          style={{
            flex: 1,
            padding: '4px 6px',
            fontSize: 12,
            background: '#0a0a0a',
            border: '1px solid #404040',
            borderRadius: 3,
            color: '#fafafa',
          }}
        >
          {/* If the current map isn't on disk yet (just created via "New"),
              keep it in the dropdown so the user doesn't think it vanished. */}
          {!maps.includes(currentName) && <option value={currentName}>{currentName}</option>}
          {maps.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={reload}
          title="Reload map list"
          style={iconBtn}
        >
          ↻
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          placeholder="New map name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') trySubmitNew();
          }}
          style={{
            flex: 1,
            padding: '4px 6px',
            fontSize: 12,
            background: '#0a0a0a',
            border: '1px solid #404040',
            borderRadius: 3,
            color: '#fafafa',
          }}
        />
        <button
          type="button"
          onClick={trySubmitNew}
          disabled={!newName.trim()}
          style={{
            padding: '4px 8px',
            fontSize: 12,
            background: newName.trim() ? '#1d4ed8' : '#1e293b',
            border: '1px solid #334155',
            color: '#fafafa',
            borderRadius: 3,
            cursor: newName.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 28,
  background: '#1e293b',
  border: '1px solid #334155',
  color: '#cbd5e1',
  borderRadius: 3,
  cursor: 'pointer',
  font: '12px system-ui, sans-serif',
};
