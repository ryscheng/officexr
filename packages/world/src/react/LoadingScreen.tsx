/**
 * The web HUD's liquid-glass tokens (packages/web/src/index.css), read as CSS variables because
 * this package ships no stylesheet: the loading screen follows the web app's light or dark
 * appearance, and falls back to the light values where no theme is defined (the studio).
 */
const LIGHT_WALLPAPER =
  'radial-gradient(at 15% 8%, #c7dbff 0, transparent 45%), radial-gradient(at 88% 4%, #f1d6ff 0, transparent 42%), ' +
  'radial-gradient(at 78% 92%, #ffe0c8 0, transparent 45%), radial-gradient(at 8% 88%, #c9efe4 0, transparent 42%), #eef1f6';
const HUD = {
  wallpaper: `var(--hud-wallpaper, ${LIGHT_WALLPAPER})`,
  track: 'var(--color-hud-track, rgba(0, 0, 0, 0.1))',
  text: 'var(--color-hud-text, #1d1d1f)',
  text2: 'var(--color-hud-text-2, rgba(60, 60, 67, 0.64))',
  accent: 'var(--color-hud-accent, #007aff)',
  onAccent: 'var(--color-hud-on-accent, #ffffff)',
  accentShadow: 'var(--color-hud-accent-shadow, rgba(0, 122, 255, 0.32))',
  rose: 'var(--color-hud-rose, rgba(255, 59, 48, 0.12))',
  roseText: 'var(--color-hud-rose-text, #d1281e)',
  body: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif',
  title: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", system-ui, sans-serif',
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
        background: HUD.wallpaper,
        color: HUD.text2,
        font: `500 14px ${HUD.body}`,
      }}
    >
      <style>{'@keyframes officexr-spin{to{transform:rotate(360deg)}}'}</style>
      {title && <div style={{ font: `600 28px ${HUD.title}`, letterSpacing: '-0.02em', color: HUD.text }}>{title}</div>}
      {!error && (
        <div
          aria-hidden
          style={{
            width: 28,
            height: 28,
            border: `2.5px solid ${HUD.track}`,
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
            background: HUD.track,
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
            border: '1px solid rgba(209, 40, 30, 0.2)',
            color: HUD.roseText,
            borderRadius: 14,
            font: `500 13px ${HUD.body}`,
            maxWidth: 'min(420px, 90vw)',
          }}
        >
          {error}
        </div>
      )}
      {!error && slow && <div style={{ font: `500 12px ${HUD.body}` }}>This is taking longer than usual.</div>}
      {(error || slow) && (
        <button
          type="button"
          onClick={reload}
          style={{
            padding: '8px 18px',
            font: `600 14px ${HUD.body}`,
            color: HUD.onAccent,
            background: HUD.accent,
            border: 'none',
            borderRadius: 12,
            boxShadow: `0 1px 3px ${HUD.accentShadow}`,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      )}
    </div>
  );
}
