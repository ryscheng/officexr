import React, { useRef, useState } from 'react';
import { soundNameFromFile } from './soundName.ts';
import { useSoundLibrary } from './useSoundLibrary.ts';

const errorStyle = { color: '#f87171' };
const buttonStyle = { padding: '4px 10px', cursor: 'pointer' };

export function SoundsApp() {
  const library = useSoundLibrary();
  const [nameError, setNameError] = useState<{ error: string; suggestion: string; file: File } | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const uploadFile = async (file: File, name: string) => {
    if (library.sounds.some((s) => s.name === name) && !window.confirm(`Overwrite "${name}"?`)) {
      return;
    }
    setNameError(null);
    await library.upload(name, new Uint8Array(await file.arrayBuffer()));
  };

  const onPick = (file: File | undefined) => {
    if (!file) {
      return;
    }
    const check = soundNameFromFile(file.name);
    if (check.type === 'ok') {
      void uploadFile(file, check.name);
    } else {
      setNameError({ error: check.error, suggestion: check.suggestion, file });
    }
  };

  const play = (name: string) => {
    audio.current?.pause();
    const el = new Audio(library.url(name));
    el.onended = () => setPlaying(null);
    audio.current = el;
    setPlaying(name);
    void el.play().catch(() => setPlaying(null));
  };

  return (
    <div style={{ flex: 1, padding: 16, overflow: 'auto', font: '13px system-ui, sans-serif' }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Sounds</h2>
      <label>
        Upload MP3{' '}
        <input
          type="file"
          accept=".mp3,audio/mpeg"
          aria-label="Upload MP3"
          disabled={library.busy}
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {library.busy && <span> Working...</span>}
      {nameError && (
        <p role="alert" style={errorStyle}>
          {nameError.error}{' '}
          {nameError.suggestion && (
            <button type="button" onClick={() => void uploadFile(nameError.file, nameError.suggestion)}>
              Upload as "{nameError.suggestion}"
            </button>
          )}
        </p>
      )}
      {library.error && (
        <p role="alert" style={errorStyle}>
          {library.error}
        </p>
      )}
      {!library.loading && library.sounds.length === 0 && <p>No sounds yet. Upload an MP3 to get started.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {library.sounds.map((s) => (
          <li key={s.name} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
            <button type="button" style={buttonStyle} onClick={() => play(s.name)} aria-label={`Play ${s.name}`}>
              {playing === s.name ? 'Playing' : 'Play'}
            </button>
            <span style={{ flex: 1 }}>{s.name}</span>
            <span style={{ opacity: 0.6 }}>{(s.size / 1024).toFixed(1)} KB</span>
            <button
              type="button"
              style={buttonStyle}
              aria-label={`Delete ${s.name}`}
              disabled={library.busy}
              onClick={() => {
                if (window.confirm(`Delete "${s.name}"?`)) {
                  void library.remove(s.name);
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
