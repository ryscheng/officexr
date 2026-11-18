/**
 * The web HUD's tokens (packages/web/src/index.css), inlined because this package ships no
 * stylesheet: the loading screen hands over to the HUD and must look like it. The studio has
 * neither font loaded, so both fall back to system faces there.
 */
const HUD = {
  inset: '#161b27',
  edge: '#34405a',
  text: '#e8edf7',
  text2: '#9aa6bd',
  accent: '#7fb2ff',
  onAccent: '#0f1420',
  accentShadow: '#2b4f96',
  rose: '#3a1c22',
  roseText: '#ff8a8a',
  body: 'Nunito, system-ui, sans-serif',
  title: 'Tiny5, system-ui, sans-serif',
} as const;

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
        gap: 14,
        padding: 16,
        textAlign: 'center',
        background: `radial-gradient(ellipse at top, rgba(127, 178, 255, 0.12), transparent 60%), ${HUD.inset}`,
        color: HUD.text2,
        font: `600 14px ${HUD.body}`,
      }}
    >
      <style>{'@keyframes officexr-spin{to{transform:rotate(360deg)}}'}</style>
      {title && <div style={{ font: `24px ${HUD.title}`, letterSpacing: '0.1em', textTransform: 'uppercase', color: HUD.text }}>{title}</div>}
      {!error && (
        <div
          aria-hidden
          style={{
            width: 28,
            height: 28,
            border: `3px solid ${HUD.edge}`,
            borderTopColor: HUD.accent,
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
            maxWidth: '80vw',
            height: 8,
            borderRadius: 4,
            background: HUD.edge,
            overflow: 'hidden',
          }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: HUD.accent, transition: 'width 200ms ease-out' }} />
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{
            padding: '8px 14px',
            background: HUD.rose,
            border: '2px solid rgba(255, 138, 138, 0.3)',
            color: HUD.roseText,
            borderRadius: 14,
            font: `600 13px ${HUD.body}`,
            maxWidth: 'min(420px, 90vw)',
          }}
        >
          {error}
        </div>
      )}
      {!error && slow && <div style={{ font: `600 12px ${HUD.body}` }}>This is taking longer than usual.</div>}
      {(error || slow) && (
        <button
          type="button"
          onClick={reload}
          style={{
            padding: '8px 18px',
            font: `700 14px ${HUD.body}`,
            color: HUD.onAccent,
            background: HUD.accent,
            border: 'none',
            borderRadius: 14,
            boxShadow: `0 3px 0 ${HUD.accentShadow}`,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      )}
    </div>
  );
}
