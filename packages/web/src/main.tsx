import './assetBase';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { capturePreviewToken } from '@officexr/server/preview-token';
import { appearanceController } from './theme/appearance';

// Before the first API call, so it carries a token the sign-in just handed back.
capturePreviewToken();
// Before the first paint, so a dark-mode user never sees a light flash.
appearanceController();

// Dev servers only: a production build drops this branch, and the preview module with it.
const HudPreview =
  import.meta.env.DEV && window.location.pathname === '/hud-preview'
    ? lazy(() => import('./hud-preview/HudPreview').then((m) => ({ default: m.HudPreview })))
    : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {HudPreview ? (
      <Suspense fallback={null}>
        <HudPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
