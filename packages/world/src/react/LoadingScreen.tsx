const FONT = 'system-ui, sans-serif';

export interface WorldLoadingScreenProps {
  title?: string;
  step: string;
  /** 0–100; omitted hides the bar. */
  progress?: number;
  error?: string;
  slow?: boolean;
  onReload?: () => void;
}

export function WorldLoadingScreen({ title, step, progress, error, slow, onReload }: WorldLoadingScreenProps) {
  const reload = onReload ?? (() => window.location.reload());
  const pct = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));
  return (
    <div
      data-testid="world-loading"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: '#14161a',
        color: '#fff',
        font: `14px ${FONT}`,
      }}
    >
      <style>{'@keyframes officexr-spin{to{transform:rotate(360deg)}}'}</style>
      {title && <div style={{ font: `600 20px ${FONT}` }}>{title}</div>}
      {!error && (
        <div
          aria-hidden
          style={{
            width: 24,
            height: 24,
            border: '3px solid rgba(255,255,255,0.25)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'officexr-spin 0.8s linear infinite',
          }}
        />
      )}
      <div role="status">{step}</div>
      {pct !== undefined && (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            width: 240,
            height: 6,
            borderRadius: 3,
            background: 'rgba(255,255,255,0.2)',
            overflow: 'hidden',
          }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: '#fff' }} />
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            padding: '8px 14px',
            background: 'rgba(180, 50, 50, 0.92)',
            borderRadius: 6,
            font: `12px ${FONT}`,
            maxWidth: '90vw',
          }}
        >
          {error}
        </div>
      )}
      {!error && slow && <div style={{ font: `12px ${FONT}` }}>This is taking longer than usual.</div>}
      {(error || slow) && (
        <button
          type="button"
          onClick={reload}
          style={{
            padding: '6px 14px',
            font: `13px ${FONT}`,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      )}
    </div>
  );
}
