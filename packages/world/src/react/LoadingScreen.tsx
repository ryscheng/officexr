import type { ReactNode } from 'react';

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
  amber: 'var(--color-hud-amber, rgb(255 159 10 / 0.16))',
  amberText: 'var(--color-hud-amber-text, #a85a00)',
  accentFill: 'var(--color-hud-accent-fill, #0066d6)',
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
  /** Shown above the title. */
  brand?: ReactNode;
  /** Secondary line under the step, e.g. what comes next. */
  hint?: string;
  /** A way out shown with the slow notice, in place of Reload. */
  back?: { label: string; href: string };
}

export function WorldLoadingScreen({ title, step, progress, error, slow, onReload, brand, hint, back }: WorldLoadingScreenProps) {
  const reload = onReload ?? (() => window.location.reload());
  const pct = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));
  const showSlow = !error && slow;
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
        padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
        overflowY: 'auto',
        textAlign: 'center',
        background: HUD.wallpaper,
        color: HUD.text2,
        font: `400 16px/24px ${HUD.body}`,
      }}
    >
      <style>{'@keyframes officexr-spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%', maxWidth: 360 }}>
        {brand}
        {title && (
          <div
            style={{
              font: `600 clamp(24px, 8vw, 28px)/1.15 ${HUD.title}`,
              letterSpacing: '-0.02em',
              color: HUD.text,
              overflowWrap: 'anywhere',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </div>
        )}
        {!error && pct === undefined && (
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
        {pct !== undefined && (
          <div
            role="progressbar"
            aria-label="Progress"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ width: '100%', height: 8, borderRadius: 4, background: HUD.track, overflow: 'hidden' }}
          >
            <div style={{ width: `${pct}%`, height: '100%', background: HUD.accentFill, borderRadius: 4, transition: 'width 200ms ease-out' }} />
          </div>
        )}
        <div role="status">{step}</div>
        {hint && <div style={{ font: `400 14px/20px ${HUD.body}` }}>{hint}</div>}
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
        {showSlow && back && (
          <div role="alert" style={{ padding: '12px 16px', background: HUD.amber, color: HUD.amberText, borderRadius: 14, font: `400 14px/20px ${HUD.body}` }}>
            <strong>This is taking longer than usual.</strong> You can keep waiting or go back.
          </div>
        )}
        {showSlow && !back && <div style={{ font: `500 12px ${HUD.body}` }}>This is taking longer than usual.</div>}
        {showSlow && back && (
          <a
            href={back.href}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 48,
              padding: '0 20px',
              font: `600 16px ${HUD.body}`,
              color: HUD.accentFill,
              textDecoration: 'none',
            }}
          >
            {back.label}
          </a>
        )}
        {(error || (slow && !back)) && (
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
    </div>
  );
}
